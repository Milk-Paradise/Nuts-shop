import { EventEmitter } from "node:events"

const mockRedisInstances: MockRedis[] = []

class MockRedis extends EventEmitter {
  connect = jest.fn().mockResolvedValue(undefined)
  manuallyClosing = false

  constructor(
    public readonly url: string,
    public readonly options: Record<string, unknown>
  ) {
    super()
    mockRedisInstances.push(this)
  }
}

jest.mock("ioredis", () => ({
  __esModule: true,
  default: MockRedis,
}))

describe("Redis module connection resilience", () => {
  beforeEach(() => {
    mockRedisInstances.length = 0
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  it("handles an unavailable cache without emitting or logging every error", async () => {
    const loader = require("@medusajs/cache-redis/dist/loaders").default
    const logger = { error: jest.fn(), info: jest.fn() }
    const register = jest.fn()

    await loader({
      container: { register },
      logger,
      options: { redisUrl: "redis://stub" },
    })

    const connection = mockRedisInstances[0]
    expect(connection.listenerCount("error")).toBe(1)

    for (let attempt = 0; attempt < 20; attempt += 1) {
      connection.emit("error", new Error("ECONNREFUSED"))
    }

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("cache connection unavailable")
    )
  })

  it("logs one recovery and starts a fresh bounded reconnect cycle", async () => {
    jest.useFakeTimers()
    process.env.REDIS_RECONNECT_COOLDOWN_MS = "25"
    const loader = require("@medusajs/cache-redis/dist/loaders").default
    const logger = { error: jest.fn(), info: jest.fn() }

    await loader({
      container: { register: jest.fn() },
      logger,
      options: { redisUrl: "redis://stub" },
    })

    const connection = mockRedisInstances[0]
    connection.emit("error", new Error("ETIMEDOUT"))
    connection.emit("end")

    await jest.advanceTimersByTimeAsync(25)
    expect(connection.connect).toHaveBeenCalledTimes(2)

    connection.emit("ready")
    connection.emit("ready")
    expect(logger.info).toHaveBeenCalledTimes(2)
    expect(logger.info).toHaveBeenLastCalledWith(
      "[Redis] cache connection restored"
    )
    expect(logger.error).toHaveBeenCalledTimes(1)

    delete process.env.REDIS_RECONNECT_COOLDOWN_MS
  })
})
