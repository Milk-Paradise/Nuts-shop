const mockSend = jest.fn()

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  GetObjectCommand: class { constructor(public input: any) {} },
  PutObjectCommand: class { constructor(public input: any) {} },
  CopyObjectCommand: class { constructor(public input: any) {} },
  DeleteObjectCommand: class { constructor(public input: any) {} },
}))

import {
  loadOrRebuildPickupPointSnapshot,
  pickupPointSnapshotKey,
  pickupPointSnapshotRequest,
  PICKUP_POINT_SNAPSHOT_SCHEMA_VERSION,
  type PickupPointSnapshotResult,
} from "../pickup-point-snapshot-cache"

const request = pickupPointSnapshotRequest(" Москва ", "cdek", "Тверская", ["cdek_cdek"])

const result: PickupPointSnapshotResult = {
  points: [{
    id: "cdek_cdek:1", provider_key: "cdek_cdek", external_id: "1", name: "ПВЗ", address: "Тверская",
    lat: 55.7, lng: 37.6, schedule: null, provider: "cdek", carrier: "cdek",
  }],
  map_points: [{
    id: "cdek_cdek:1", provider_key: "cdek_cdek", external_id: "1", name: "ПВЗ", address: "Тверская",
    lat: 55.7, lng: 37.6, schedule: null, provider: "cdek", carrier: "cdek",
  }],
  sources: [{ provider_key: "cdek_cdek", status: "available" }],
}

function containerWithoutLock() {
  return { resolve: jest.fn(() => { throw new Error("Module not registered") }) } as any
}

function containerWithLock(execute: jest.Mock) {
  return { resolve: jest.fn(() => ({ execute })) } as any
}

function response(payload: unknown) {
  return { Body: { transformToString: jest.fn().mockResolvedValue(JSON.stringify(payload)) } }
}

function snapshot(payloadResult = result, expiresAt = Date.now() + 60_000) {
  return {
    schema_version: PICKUP_POINT_SNAPSHOT_SCHEMA_VERSION,
    key: pickupPointSnapshotKey(request),
    created_at: new Date().toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
    request,
    result: payloadResult,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.PVZ_SNAPSHOT_S3_BUCKET = "pvz-cache"
  process.env.PVZ_SNAPSHOT_S3_PREFIX = "test-pvz"
  process.env.PVZ_SNAPSHOT_CACHE_TTL_MS = "60000"
  process.env.PVZ_SNAPSHOT_LOCK_WAIT_MS = "1000"
  process.env.PVZ_SNAPSHOT_LOCK_BACKOFF_MS = "1"
})

afterEach(() => {
  delete process.env.PVZ_SNAPSHOT_S3_BUCKET
  delete process.env.PVZ_SNAPSHOT_S3_PREFIX
  delete process.env.PVZ_SNAPSHOT_CACHE_TTL_MS
  delete process.env.PVZ_SNAPSHOT_LOCK_WAIT_MS
  delete process.env.PVZ_SNAPSHOT_LOCK_BACKOFF_MS
})

describe("pickup point S3 snapshot cache", () => {
  it("serves a valid hit without rebuilding provider sources", async () => {
    mockSend.mockResolvedValue(response(snapshot()))
    const rebuild = jest.fn().mockResolvedValue(result)

    await expect(loadOrRebuildPickupPointSnapshot(containerWithoutLock(), request, rebuild)).resolves.toEqual(result)

    expect(rebuild).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it("publishes a miss atomically and coalesces concurrent rebuilds without a lock module", async () => {
    const objects = new Map<string, string>()
    mockSend.mockImplementation(async (command: any) => {
      const { input } = command
      if (command.constructor.name === "GetObjectCommand") {
        const body = objects.get(input.Key)
        if (!body) throw new Error("NoSuchKey")
        return { Body: { transformToString: async () => body } }
      }
      if (command.constructor.name === "PutObjectCommand") objects.set(input.Key, input.Body)
      if (command.constructor.name === "CopyObjectCommand") {
        const temporary = decodeURIComponent(input.CopySource).replace("pvz-cache/", "")
        objects.set(input.Key, objects.get(temporary)!)
      }
      if (command.constructor.name === "DeleteObjectCommand") objects.delete(input.Key)
      return {}
    })
    const rebuild = jest.fn(async () => result)

    const values = await Promise.all([
      loadOrRebuildPickupPointSnapshot(containerWithoutLock(), request, rebuild),
      loadOrRebuildPickupPointSnapshot(containerWithoutLock(), request, rebuild),
    ])

    expect(values).toEqual([result, result])
    expect(rebuild).toHaveBeenCalledTimes(1)
    expect(mockSend.mock.calls.some(([command]) => command.constructor.name === "CopyObjectCommand")).toBe(true)
  })

  it.each(["stale", "corrupt"])("rebuilds a %s snapshot", async (kind) => {
    mockSend.mockImplementation(async (command: any) => {
      if (command.constructor.name !== "GetObjectCommand") return {}
      if (kind === "corrupt") return { Body: { transformToString: async () => "not json" } }
      return response(snapshot(result, Date.now() - 1))
    })
    const rebuild = jest.fn().mockResolvedValue(result)

    await expect(loadOrRebuildPickupPointSnapshot(containerWithoutLock(), request, rebuild)).resolves.toEqual(result)

    expect(rebuild).toHaveBeenCalledTimes(1)
  })

  it("persists a partial source status but not an all-error response", async () => {
    const partialRequest = pickupPointSnapshotRequest("Москва", undefined, undefined, ["cdek_cdek", "ozon_ozon"])
    const partial: PickupPointSnapshotResult = {
      ...result,
      sources: [
        { provider_key: "cdek_cdek", status: "available" },
        { provider_key: "ozon_ozon", status: "partial" },
      ],
    }
    mockSend.mockImplementation(async (command: any) => {
      if (command.constructor.name === "GetObjectCommand") throw new Error("NoSuchKey")
      return {}
    })

    await loadOrRebuildPickupPointSnapshot(containerWithoutLock(), partialRequest, jest.fn().mockResolvedValue(partial))

    const put = mockSend.mock.calls.map(([command]) => command).find(
      (command) => command.constructor.name === "PutObjectCommand"
    )
    expect(JSON.parse(put.input.Body).result.sources).toEqual(partial.sources)
  })

  it.each([
    ["an empty successful response", { ...result, points: [], map_points: [] }],
    ["an all-error response", { ...result, points: [], map_points: [], sources: [{ provider_key: "cdek_cdek", status: "partial" }] }],
  ])("does not publish %s", async (_description, emptyResult) => {
    mockSend.mockImplementation(async (command: any) => {
      if (command.constructor.name === "GetObjectCommand") throw new Error("NoSuchKey")
      return {}
    })

    await expect(loadOrRebuildPickupPointSnapshot(
      containerWithoutLock(), request, jest.fn().mockResolvedValue(emptyResult)
    )).resolves.toEqual(emptyResult)

    expect(mockSend.mock.calls.some(([command]) => command.constructor.name === "PutObjectCommand")).toBe(false)
  })

  it("does not rebuild when an occupied distributed lock publishes while polling", async () => {
    const execute = jest.fn().mockRejectedValue(new Error("lock timeout"))
    let getAttempts = 0
    mockSend.mockImplementation(async (command: any) => {
      if (command.constructor.name !== "GetObjectCommand") return {}
      getAttempts += 1
      if (getAttempts < 3) throw new Error("NoSuchKey")
      return response(snapshot())
    })
    const rebuild = jest.fn().mockResolvedValue(result)

    await expect(loadOrRebuildPickupPointSnapshot(containerWithLock(execute), request, rebuild)).resolves.toEqual(result)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(rebuild).not.toHaveBeenCalled()
  })

  it("uses the explicit database fallback after bounded lock polling", async () => {
    const execute = jest.fn().mockRejectedValue(new Error("lock timeout"))
    mockSend.mockImplementation(async (command: any) => {
      if (command.constructor.name === "GetObjectCommand") throw new Error("NoSuchKey")
      return {}
    })
    const rebuild = jest.fn().mockResolvedValue(result)
    const fallback = jest.fn().mockResolvedValue(result)

    await expect(loadOrRebuildPickupPointSnapshot(
      containerWithLock(execute), request, rebuild, fallback
    )).resolves.toEqual(result)

    expect(rebuild).not.toHaveBeenCalled()
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it("propagates a rebuild error instead of mistaking it for a lock timeout", async () => {
    const execute = jest.fn(async (_key, work) => work())
    mockSend.mockImplementation(async (command: any) => {
      if (command.constructor.name === "GetObjectCommand") throw new Error("NoSuchKey")
      return {}
    })
    const rebuildError = new Error("directory read failed")
    const rebuild = jest.fn().mockRejectedValue(rebuildError)

    await expect(loadOrRebuildPickupPointSnapshot(containerWithLock(execute), request, rebuild)).rejects.toBe(rebuildError)

    expect(rebuild).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["a point from an unrequested provider", { ...result, points: [{ ...result.points[0], provider_key: "other" }] }],
    ["a mismatched carrier", { ...result, points: [{ ...result.points[0], carrier: "ozon_ozon" }] }],
    ["a map point whose fields differ from its directory point", { ...result, map_points: [{ ...result.map_points[0], name: "Другое имя" }] }],
  ])("rejects a cached result with %s", async (_description, invalidResult) => {
    mockSend.mockResolvedValue(response(snapshot(invalidResult)))
    const rebuild = jest.fn().mockResolvedValue(result)

    await expect(loadOrRebuildPickupPointSnapshot(containerWithoutLock(), request, rebuild)).resolves.toEqual(result)

    expect(rebuild).toHaveBeenCalledTimes(1)
  })

  it("uses the database fallback when the bucket is disabled", async () => {
    delete process.env.PVZ_SNAPSHOT_S3_BUCKET
    const rebuild = jest.fn().mockResolvedValue(result)

    await expect(loadOrRebuildPickupPointSnapshot(containerWithoutLock(), request, rebuild)).resolves.toEqual(result)

    expect(rebuild).toHaveBeenCalledTimes(1)
    expect(mockSend).not.toHaveBeenCalled()
  })
})
