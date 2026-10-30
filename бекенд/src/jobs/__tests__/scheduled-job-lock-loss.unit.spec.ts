const mockWorkerInstances: Array<{
  options: Record<string, unknown>
  listeners: Record<string, (...args: unknown[]) => void>
}> = []

jest.mock("bullmq", () => ({
  Queue: class {
    close = jest.fn()
    add = jest.fn()
    getRepeatableJobs = jest.fn().mockResolvedValue([])
    removeRepeatableByKey = jest.fn()
  },
  Worker: class {
    listeners: Record<string, (...args: unknown[]) => void> = {}
    close = jest.fn()

    constructor(
      _name: string,
      _processor: (...args: unknown[]) => unknown,
      public readonly options: Record<string, unknown>
    ) {
      mockWorkerInstances.push(this)
    }

    on(event: string, listener: (...args: unknown[]) => void) {
      this.listeners[event] = listener
      return this
    }
  },
}))

import { RedisDistributedTransactionStorage } from "@medusajs/workflow-engine-redis/dist/utils/workflow-orchestrator-storage"

describe("scheduled job lock loss", () => {
  it("logs the lost occurrence and leaves retry to the next idempotent schedule", async () => {
    const logger = { debug: jest.fn(), error: jest.fn(), warn: jest.fn() }
    const connection = {
      status: "ready",
      connect: jest.fn(),
    }
    const storage = new RedisDistributedTransactionStorage({
      workflowExecutionService: {},
      redisConnection: connection,
      redisWorkerConnection: connection,
      redisQueueName: "workflows",
      redisJobQueueName: "scheduled",
      redisJobWorkerOptions: { maxStalledCount: 0 },
      logger,
      isWorkerMode: true,
    } as never)

    await storage.onApplicationStart()

    const scheduledWorker = mockWorkerInstances[1]
    expect(scheduledWorker.options).toMatchObject({ maxStalledCount: 0 })

    scheduledWorker.listeners.stalled("job-cms-snapshot-refresh")

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      "Scheduled job job-cms-snapshot-refresh lost its worker lock; this occurrence will not be re-executed and the work will run again on its next schedule."
    )
  })
})
