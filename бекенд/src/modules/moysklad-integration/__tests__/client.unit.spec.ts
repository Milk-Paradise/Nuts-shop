import {
  DEFAULT_MOYSKLAD_BASE_URL,
  MoyskladClient,
  resolveMoyskladBaseUrl,
  resolveMoyskladRequestTimeoutMs,
  type MoyskladFetch,
  type MoyskladFetchResponse,
} from "../client"
import { encryptMoyskladCredentials } from "../credentials"

describe("MoyskladClient", () => {
  beforeEach(() => {
    process.env.MOYSKLAD_ENCRYPTION_KEY = "test-moysklad-encryption-key"
    delete process.env.MOYSKLAD_BASE_URL
  })

  it("checks a token through the employee context endpoint", async () => {
    const fetch = jest.fn<
      Promise<MoyskladFetchResponse>,
      Parameters<MoyskladFetch>
    >().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{}",
    })
    const client = new MoyskladClient(fetch)

    await expect(
      client.testConnection(
        encryptMoyskladCredentials({ type: "token", token: "access-token" })
      )
    ).resolves.toEqual({ success: true })

    expect(fetch).toHaveBeenCalledWith(
      "https://api.moysklad.ru/api/remap/1.2/context/employee",
      {
        method: "GET",
        headers: {
          Accept: "application/json;charset=utf-8",
          Authorization: "Bearer access-token",
        },
        signal: expect.any(AbortSignal),
      }
    )
  })

  it("uses the API-compatible Accept header for shared client requests", async () => {
    const fetch = jest.fn<
      Promise<MoyskladFetchResponse>,
      Parameters<MoyskladFetch>
    >().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ rows: [{ id: "org_1", meta: { href: "org" } }] }),
      json: async () => ({ rows: [{ id: "org_1", meta: { href: "org" } }] }),
    })
    const client = new MoyskladClient(fetch)

    await client.findDefaultOrganization(
      encryptMoyskladCredentials({ type: "token", token: "access-token" })
    )

    expect(fetch.mock.calls[0][1].headers.Accept).toBe(
      "application/json;charset=utf-8"
    )
  })

  it("rejects a successful HTTP status with an unreadable JSON body", async () => {
    const fetch = jest.fn<
      Promise<MoyskladFetchResponse>,
      Parameters<MoyskladFetch>
    >().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "not-json",
      json: async () => Promise.reject(new SyntaxError("Unexpected token")),
    })
    const client = new MoyskladClient(fetch, {
      throttle: jest.fn().mockResolvedValue(undefined),
    })

    await expect(
      client.findDefaultOrganization(
        encryptMoyskladCredentials({ type: "token", token: "access-token" })
      )
    ).rejects.toMatchObject({
      message: "МойСклад вернул успешный статус с некорректным JSON.",
      status: 200,
    })
  })

  it("checks login and password through a Basic authorization header", async () => {
    const fetch = jest.fn<
      Promise<MoyskladFetchResponse>,
      Parameters<MoyskladFetch>
    >().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{}",
    })
    const client = new MoyskladClient(fetch)

    await client.testConnection(
      encryptMoyskladCredentials({
        type: "basic",
        login: "manager@example.com",
        password: "password",
      })
    )

    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
      "Basic bWFuYWdlckBleGFtcGxlLmNvbTpwYXNzd29yZA=="
    )
  })

  it("rejects unreadable JSON while checking credentials despite a successful status", async () => {
    const fetch = jest.fn<
      Promise<MoyskladFetchResponse>,
      Parameters<MoyskladFetch>
    >().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "not-json",
      json: async () => Promise.reject(new SyntaxError("Unexpected token")),
    })
    const client = new MoyskladClient(fetch, {
      throttle: jest.fn().mockResolvedValue(undefined),
    })

    await expect(
      client.testCredentials({ type: "token", token: "access-token" })
    ).rejects.toMatchObject({
      message: "МойСклад вернул успешный статус с некорректным JSON.",
      status: 200,
    })
  })

  it("returns the raw API error text for non-successful responses", async () => {
    const fetch = jest.fn<
      Promise<MoyskladFetchResponse>,
      Parameters<MoyskladFetch>
    >().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Недействительный токен",
    })
    const client = new MoyskladClient(fetch)

    await expect(
      client.testConnection(
        encryptMoyskladCredentials({ type: "token", token: "access-token" })
      )
    ).rejects.toMatchObject({
      message: "Недействительный токен",
      status: 401,
    })
  })

  it("returns a generic message when an error response body cannot be read", async () => {
    const fetch = jest.fn<
      Promise<MoyskladFetchResponse>,
      Parameters<MoyskladFetch>
    >().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => Promise.reject(new Error("connection reset")),
    })
    const client = new MoyskladClient(fetch)

    await expect(
      client.testConnection(
        encryptMoyskladCredentials({ type: "token", token: "access-token" })
      )
    ).rejects.toMatchObject({
      message: "Не удалось проверить доступ к МойСклад.",
    })
  })

  it("returns a generic message when the request has no HTTP response", async () => {
    const fetch = jest.fn<
      Promise<MoyskladFetchResponse>,
      Parameters<MoyskladFetch>
    >().mockRejectedValue(new Error("socket hang up"))
    const client = new MoyskladClient(fetch)

    await expect(
      client.testConnection(
        encryptMoyskladCredentials({ type: "token", token: "access-token" })
      )
    ).rejects.toMatchObject({
      message: "Не удалось проверить доступ к МойСклад.",
    })
  })

  it("waits for x-lognex-retry-after milliseconds and retries a rate-limited request", async () => {
    const fetch = jest
      .fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: jest.fn().mockReturnValue("1250") },
        text: async () => "Лимит превышен",
      })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "{}" })
    const retrySleep = jest.fn().mockResolvedValue(undefined)
    const throttle = jest.fn().mockResolvedValue(undefined)
    const client = new MoyskladClient(fetch, { retrySleep, throttle })

    await expect(
      client.testCredentials({ type: "token", token: "access-token" })
    ).resolves.toEqual({ success: true })

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(retrySleep).toHaveBeenCalledWith(1250)
    expect(throttle.mock.calls).toEqual([[1], [1]])
  })

  it.each([undefined, "", "not-a-number", "-1"])(
    "uses the three-second retry fallback for an unreadable header: %s",
    async (headerValue) => {
      const fetch = jest
        .fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: {
            get: jest.fn().mockReturnValue(headerValue ?? null),
          },
          text: async () => "Лимит превышен",
        })
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "{}" })
      const retrySleep = jest.fn().mockResolvedValue(undefined)
      const client = new MoyskladClient(fetch, {
        retrySleep,
        throttle: jest.fn().mockResolvedValue(undefined),
      })

      await client.testCredentials({ type: "token", token: "access-token" })

      expect(retrySleep).toHaveBeenCalledWith(3_000)
    }
  )

  it("stops after three rate-limit retries and returns one failed operation", async () => {
    const fetch = jest
      .fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: jest.fn().mockReturnValue("10") },
        text: async () => "Лимит всё ещё превышен",
      })
    const retrySleep = jest.fn().mockResolvedValue(undefined)
    const client = new MoyskladClient(fetch, {
      retrySleep,
      throttle: jest.fn().mockResolvedValue(undefined),
    })

    await expect(
      client.testCredentials({ type: "token", token: "access-token" })
    ).rejects.toMatchObject({
      message: "Лимит всё ещё превышен",
      status: 429,
    })

    expect(fetch).toHaveBeenCalledTimes(4)
    expect(retrySleep).toHaveBeenCalledTimes(3)
  })

  it("uses a configurable request timeout with a 30-second default", () => {
    expect(resolveMoyskladRequestTimeoutMs({})).toBe(30_000)
    expect(
      resolveMoyskladRequestTimeoutMs({ MOYSKLAD_REQUEST_TIMEOUT_MS: "45000" })
    ).toBe(45_000)
    expect(
      resolveMoyskladRequestTimeoutMs({ MOYSKLAD_REQUEST_TIMEOUT_MS: "invalid" })
    ).toBe(30_000)
  })

  it("uses the production MoySklad URL by default and normalizes an override", () => {
    expect(resolveMoyskladBaseUrl({})).toBe(DEFAULT_MOYSKLAD_BASE_URL)
    expect(resolveMoyskladBaseUrl({ MOYSKLAD_BASE_URL: "" })).toBe(
      DEFAULT_MOYSKLAD_BASE_URL
    )
    expect(
      resolveMoyskladBaseUrl({
        MOYSKLAD_BASE_URL: "  http://127.0.0.1:12345/api/remap/1.2///  ",
      })
    ).toBe("http://127.0.0.1:12345/api/remap/1.2")
  })

  it("routes requests through the configured MoySklad base URL", async () => {
    process.env.MOYSKLAD_BASE_URL = "http://127.0.0.1:12345/api/remap/1.2/"
    const fetch = jest.fn<
      Promise<MoyskladFetchResponse>,
      Parameters<MoyskladFetch>
    >().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{}",
    })

    const client = new MoyskladClient(fetch)
    await client.testCredentials({ type: "token", token: "access-token" })

    expect(fetch.mock.calls[0][0]).toBe(
      "http://127.0.0.1:12345/api/remap/1.2/context/employee"
    )
  })

  it("aborts a request when its configured timeout expires", async () => {
    jest.useFakeTimers()
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>(
      async (_input, init) =>
        new Promise<MoyskladFetchResponse>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")))
        })
    )
    const client = new MoyskladClient(fetch, {
      requestTimeoutMs: 50,
      throttle: jest.fn().mockResolvedValue(undefined),
    })

    const result = expect(
      client.testCredentials({ type: "token", token: "access-token" })
    ).rejects.toThrow("МойСклад не ответил за 50 мс")

    await jest.advanceTimersByTimeAsync(50)
    await result
    jest.useRealTimers()
  })
})
