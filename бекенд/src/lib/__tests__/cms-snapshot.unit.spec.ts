import {
  CMS_HOMEPAGE_SNAPSHOT_KEY,
  CMS_NOTIFICATION_TEMPLATES_SNAPSHOT_KEY,
  cmsWebhookSignature,
  persistCmsSnapshot,
  readCmsSnapshot,
  refreshCmsSnapshot,
  verifyCmsWebhook,
} from "../cms-snapshot"
import cmsSnapshotRefreshJob, { config as refreshJobConfig } from "../../jobs/cms-snapshot-refresh"

describe("CMS snapshot webhook", () => {
  it("polls once per minute as the publication-delivery safety net", () => {
    expect(refreshJobConfig.schedule).toBe("* * * * *")
  })
  it("accepts a fresh valid signature", () => {
    const now = 1_700_000_000_000
    const timestamp = String(now)
    const body = JSON.stringify({ event: "cms.published" })
    expect(verifyCmsWebhook(body, timestamp, cmsWebhookSignature(body, timestamp, "secret"), "secret", now)).toBe(true)
  })

  it("rejects tampering and stale replay", () => {
    const now = 1_700_000_000_000
    const timestamp = String(now - 6 * 60_000)
    const body = "{}"
    const signature = cmsWebhookSignature(body, timestamp, "secret")
    expect(verifyCmsWebhook(body, timestamp, signature, "secret", now)).toBe(false)
    expect(verifyCmsWebhook('{"changed":true}', String(now), signature, "secret", now)).toBe(false)
  })
})

describe("CMS snapshot persistence", () => {
  const content = (revision: string, sourceUpdatedAt: string) => ({
    revision, sourceUpdatedAt, sections: [],
    settings: { documentId: "settings", updatedAt: sourceUpdatedAt, companyName: "Shop", contacts: [], reviewsUrl: null, socialLinks: [] },
  }) as any

  it("does not replace a newer winner with an older concurrent refresh", async () => {
    const current = { id: "snap", revision: "new", content_updated_at: new Date("2026-08-18") }
    const service = {
      listCmsSnapshots: jest.fn().mockResolvedValue([current]),
      updateCmsSnapshots: jest.fn(), createCmsSnapshots: jest.fn(),
    } as any
    await expect(
      persistCmsSnapshot(service, "key-a", content("old", "2026-08-17T00:00:00.000Z"))
    ).resolves.toBe(current)
    expect(service.listCmsSnapshots).toHaveBeenCalledWith({ key: "key-a" })
    expect(service.updateCmsSnapshots).not.toHaveBeenCalled()
  })

  it("recovers from a cold-create collision by reading the winning row", async () => {
    const winner = { id: "snap", revision: "same", content_updated_at: new Date("2026-08-17") }
    const service = {
      listCmsSnapshots: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([winner]),
      createCmsSnapshots: jest.fn().mockRejectedValue(new Error("unique")),
      updateCmsSnapshots: jest.fn(),
    } as any
    await expect(
      persistCmsSnapshot(service, "key-a", content("same", "2026-08-17T00:00:00.000Z"))
    ).resolves.toBe(winner)
  })

  it("uses revision as a deterministic tie-break for equal timestamps", async () => {
    const current = { id: "snap", revision: "revision-z", content_updated_at: new Date("2026-08-17") }
    const service = {
      listCmsSnapshots: jest.fn().mockResolvedValue([current]),
      updateCmsSnapshots: jest.fn(), createCmsSnapshots: jest.fn(),
    } as any
    await expect(
      persistCmsSnapshot(service, "key-a", content("revision-a", "2026-08-17T00:00:00.000Z"))
    ).resolves.toBe(current)
    expect(service.updateCmsSnapshots).not.toHaveBeenCalled()
  })

  it("reads the durable snapshot without contacting Strapi", async () => {
    const payload = content("last-known-good", "2026-08-17T00:00:00.000Z")
    const listCmsSnapshots = jest.fn().mockResolvedValue([{ payload }])
    const container = { resolve: jest.fn().mockReturnValue({ listCmsSnapshots }) } as any

    await expect(readCmsSnapshot(container, CMS_HOMEPAGE_SNAPSHOT_KEY)).resolves.toEqual(payload)
    expect(listCmsSnapshots).toHaveBeenCalledWith({ key: "homepage" })
  })

  it("returns an empty result on a cold start", async () => {
    const container = {
      resolve: jest.fn().mockReturnValue({ listCmsSnapshots: jest.fn().mockResolvedValue([]) }),
    } as any
    await expect(readCmsSnapshot(container, "key-b")).resolves.toBeNull()
  })

  it("writes another key without changing the existing key", async () => {
    const payloadA = content("revision-a", "2026-08-17T00:00:00.000Z")
    const payloadB = content("revision-b", "2026-08-18T00:00:00.000Z")
    const snapshots = new Map<string, any>([
      ["key-a", {
        id: "snap-a",
        key: "key-a",
        revision: payloadA.revision,
        payload: payloadA,
        content_updated_at: new Date(payloadA.sourceUpdatedAt),
      }],
    ])
    const service = {
      listCmsSnapshots: jest.fn(async ({ key }: { key: string }) => {
        const snapshot = snapshots.get(key)
        return snapshot ? [snapshot] : []
      }),
      createCmsSnapshots: jest.fn(async (snapshot: any) => {
        snapshots.set(snapshot.key, snapshot)
        return snapshot
      }),
      updateCmsSnapshots: jest.fn(),
    } as any

    await persistCmsSnapshot(service, "key-b", payloadB)

    expect(service.createCmsSnapshots).toHaveBeenCalledWith(expect.objectContaining({
      key: "key-b",
      revision: "revision-b",
    }))
    expect(snapshots.get("key-a")?.payload).toBe(payloadA)
  })

  it("does not touch the durable winner when Strapi is unavailable", async () => {
    const previousUrl = process.env.STRAPI_INTERNAL_URL
    const previousToken = process.env.STRAPI_READ_TOKEN
    process.env.STRAPI_INTERNAL_URL = "http://cms:1337"
    process.env.STRAPI_READ_TOKEN = "read-token"
    const fetchMock = jest.spyOn(global, "fetch").mockRejectedValue(new Error("Strapi unavailable"))
    const container = { resolve: jest.fn() } as any

    try {
      await expect(refreshCmsSnapshot(container, CMS_HOMEPAGE_SNAPSHOT_KEY)).rejects.toThrow("Strapi unavailable")
      expect(container.resolve).not.toHaveBeenCalled()
    } finally {
      fetchMock.mockRestore()
      if (previousUrl === undefined) delete process.env.STRAPI_INTERNAL_URL
      else process.env.STRAPI_INTERNAL_URL = previousUrl
      if (previousToken === undefined) delete process.env.STRAPI_READ_TOKEN
      else process.env.STRAPI_READ_TOKEN = previousToken
    }
  })

  it("does not touch the accepted template snapshot when Strapi is unavailable", async () => {
    const previousUrl = process.env.STRAPI_INTERNAL_URL
    process.env.STRAPI_INTERNAL_URL = "http://cms:1337"
    const fetchMock = jest.spyOn(global, "fetch").mockRejectedValue(new Error("Strapi unavailable"))
    const container = { resolve: jest.fn() } as any

    try {
      await expect(refreshCmsSnapshot(container, CMS_NOTIFICATION_TEMPLATES_SNAPSHOT_KEY)).rejects.toThrow("Strapi unavailable")
      expect(container.resolve).not.toHaveBeenCalled()
    } finally {
      fetchMock.mockRestore()
      if (previousUrl === undefined) delete process.env.STRAPI_INTERNAL_URL
      else process.env.STRAPI_INTERNAL_URL = previousUrl
    }
  })

  it("refreshes the template snapshot on every minute tick even when the homepage refresh fails", async () => {
    const previousUrl = process.env.STRAPI_INTERNAL_URL
    const previousE2e = process.env.E2E_RUN
    process.env.STRAPI_INTERNAL_URL = "http://cms:1337"
    delete process.env.E2E_RUN
    const fetchMock = jest.spyOn(global, "fetch").mockRejectedValue(new Error("Strapi unavailable"))
    const logger = { error: jest.fn() }
    const container = { resolve: jest.fn((name: string) => (name === "logger" ? logger : undefined)) } as any

    try {
      await cmsSnapshotRefreshJob(container)
      const failedKeys = logger.error.mock.calls.map(([message]) => String(message).match(/'([^']+)'/)?.[1])
      expect(failedKeys).toEqual([CMS_HOMEPAGE_SNAPSHOT_KEY, CMS_NOTIFICATION_TEMPLATES_SNAPSHOT_KEY])
    } finally {
      fetchMock.mockRestore()
      if (previousUrl === undefined) delete process.env.STRAPI_INTERNAL_URL
      else process.env.STRAPI_INTERNAL_URL = previousUrl
      if (previousE2e === undefined) delete process.env.E2E_RUN
      else process.env.E2E_RUN = previousE2e
    }
  })

  it("does not replace the accepted template snapshot when a fetched template is invalid", async () => {
    const previousUrl = process.env.STRAPI_INTERNAL_URL
    process.env.STRAPI_INTERNAL_URL = "http://cms:1337"
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [{
      documentId: "invalid", updatedAt: "2026-08-18T00:00:00.000Z",
      event: "order-confirmation", channel: "sms", recipient: "customer",
      subject: null, body: "{{unknown}}", language: "ru", enabled: true, mandatory: false,
    }] }), { status: 200 }))
    const service = {
      listCmsSnapshots: jest.fn(), updateCmsSnapshots: jest.fn(), createCmsSnapshots: jest.fn(),
    }
    const container = { resolve: jest.fn().mockReturnValue(service) } as any
    try {
      await expect(refreshCmsSnapshot(container, CMS_NOTIFICATION_TEMPLATES_SNAPSHOT_KEY))
        .rejects.toThrow(/unknown variable/)
      expect(container.resolve).not.toHaveBeenCalled()
      expect(service.updateCmsSnapshots).not.toHaveBeenCalled()
      expect(service.createCmsSnapshots).not.toHaveBeenCalled()
    } finally {
      fetchMock.mockRestore()
      if (previousUrl === undefined) delete process.env.STRAPI_INTERNAL_URL
      else process.env.STRAPI_INTERNAL_URL = previousUrl
    }
  })

  it("keeps the previous payload readable when a snapshot update fails", async () => {
    const previous = {
      id: "snap",
      revision: "published",
      payload: content("published", "2026-08-17T00:00:00.000Z"),
      content_updated_at: new Date("2026-08-17T00:00:00.000Z"),
    }
    const service = {
      listCmsSnapshots: jest.fn().mockResolvedValue([previous]),
      updateCmsSnapshots: jest.fn().mockRejectedValue(new Error("database unavailable")),
      createCmsSnapshots: jest.fn(),
    } as any

    await expect(persistCmsSnapshot(
      service,
      CMS_HOMEPAGE_SNAPSHOT_KEY,
      content("next", "2026-08-18T00:00:00.000Z")
    )).rejects.toThrow("database unavailable")
    const container = { resolve: jest.fn().mockReturnValue(service) } as any
    await expect(readCmsSnapshot(container, CMS_HOMEPAGE_SNAPSHOT_KEY)).resolves.toEqual(previous.payload)
    expect(service.createCmsSnapshots).not.toHaveBeenCalled()
  })
})
