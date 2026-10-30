import { MedusaError } from "@medusajs/framework/utils"
import type { EntityManager } from "@medusajs/deps/mikro-orm/postgresql"

import CartService, { ConflictError, type CartRecord } from "../service"

type Execute = jest.Mock<Promise<unknown[]>, [string, unknown[]]>

function serviceWith(execute: Execute) {
  const manager = {
    getConnection: () => ({ execute }),
    transactional: (work: (tx: EntityManager) => Promise<unknown>) => work(manager),
  } as unknown as EntityManager
  const service = new CartService({ baseRepository: {} } as never)

  return {
    service,
    context: { manager },
  }
}

function cart(version: number, extra: Record<string, unknown> = {}): CartRecord {
  return {
    id: "cart_01",
    version,
    customer_id: "cus_01",
    currency_code: "rub",
    email: "buyer@example.test",
    ...extra,
  }
}

describe("CartService.updateCartByVersion", () => {
  it("does not publish a duplicate core cart query alias", () => {
    const service = new CartService({ baseRepository: {} } as never)

    expect(service.__joinerConfig()).toEqual({
      serviceName: "cartVersioning",
      primaryKeys: [],
      linkableKeys: {},
    })
  })

  it("exposes a typed conflict with the current cart", () => {
    const current = cart(2)
    const error = new ConflictError(current)

    expect(error).toBeInstanceOf(MedusaError)
    expect(error).toMatchObject({
      name: "ConflictError",
      message: "Cart cart_01 was updated by another request",
      statusCode: 409,
      details: current,
    })
  })

  it("updates only the expected version and increments it exactly once", async () => {
    const updated = cart(4, { email: "new@example.test" })
    const execute: Execute = jest.fn().mockResolvedValueOnce([updated])
    const { service, context } = serviceWith(execute)

    await expect(
      service.updateCartByVersion(
        "cart_01",
        3,
        { email: "new@example.test" },
        context
      )
    ).resolves.toEqual({ cart: updated, version: 4 })

    expect(execute).toHaveBeenCalledWith(
      'update "cart" set "email" = ?, "version" = "version" + 1 where "id" = ? and "version" = ? returning *',
      ["new@example.test", "cart_01", 3]
    )
  })

  it("increments the version even when there are no other cart fields", async () => {
    const updated = cart(1)
    const execute: Execute = jest.fn().mockResolvedValueOnce([updated])
    const { service, context } = serviceWith(execute)

    await expect(
      service.updateCartByVersion("cart_01", 0, {}, context)
    ).resolves.toEqual({ cart: updated, version: 1 })
    expect(execute.mock.calls[0][0]).toContain(
      'set "version" = "version" + 1'
    )
  })

  it("uses an existing workflow transaction manager", async () => {
    const updated = cart(7)
    const execute: Execute = jest.fn().mockResolvedValueOnce([updated])
    const transactionManager = {
      getConnection: () => ({ execute }),
    } as unknown as EntityManager
    const manager = {
      getConnection: () => ({
        execute: jest.fn().mockRejectedValue(new Error("wrong manager")),
      }),
    } as unknown as EntityManager
    const service = new CartService({ baseRepository: {} } as never)

    await expect(
      service.updateCartByVersion("cart_01", 6, {}, {
        manager,
        transactionManager,
      })
    ).resolves.toEqual({ cart: updated, version: 7 })
  })

  it("throws a 409 ConflictError containing the full current cart", async () => {
    const current = cart(5, { metadata: { source: "store" } })
    const execute: Execute = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([current])
    const { service, context } = serviceWith(execute)

    const promise = service.updateCartByVersion(
      "cart_01",
      4,
      { email: "stale@example.test" },
      context
    )

    await expect(promise).rejects.toMatchObject({
      name: "ConflictError",
      type: MedusaError.Types.CONFLICT,
      statusCode: 409,
      details: current,
    })
    expect(execute).toHaveBeenNthCalledWith(
      2,
      'select * from "cart" where "id" = ? limit 1',
      ["cart_01"]
    )
  })

  it("allows only one winner when two requests race on the same version", async () => {
    let current = cart(8, { email: "before@example.test" })
    const execute: Execute = jest.fn(async (query, values) => {
      if (query.startsWith("update")) {
        const expectedVersion = values.at(-1)
        if (current.version !== expectedVersion) return []

        current = cart(current.version + 1, { email: values[0] })
        return [current]
      }

      return [current]
    })
    const { service, context } = serviceWith(execute)

    const results = await Promise.allSettled([
      service.updateCartByVersion(
        "cart_01",
        8,
        { email: "first@example.test" },
        context
      ),
      service.updateCartByVersion(
        "cart_01",
        8,
        { email: "second@example.test" },
        context
      ),
    ])

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    const rejected = results.find(({ status }) => status === "rejected")
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({
        name: "ConflictError",
        details: expect.objectContaining({ version: 9 }),
      }),
    })
    expect(current.version).toBe(9)
  })

  it("propagates a timeout and permits a safe caller retry", async () => {
    const timeout = Object.assign(new Error("statement timeout"), {
      code: "57014",
    })
    const updated = cart(3)
    const execute: Execute = jest
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce([updated])
      .mockResolvedValueOnce([])
    const { service, context } = serviceWith(execute)

    await expect(
      service.updateCartByVersion("cart_01", 2, {}, context)
    ).rejects.toBe(timeout)
    await expect(
      service.updateCartByVersion("cart_01", 2, {}, context)
    ).resolves.toEqual({ cart: updated, version: 3 })
    // timed-out attempt + successful bump + its audit row
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it("returns not found when the cart does not exist", async () => {
    const execute: Execute = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const { service, context } = serviceWith(execute)

    await expect(
      service.updateCartByVersion("cart_missing", 0, {}, context)
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })
  })

  it.each([
    ["empty id", "", 0, {}, MedusaError.Types.INVALID_ARGUMENT],
    ["negative version", "cart_01", -1, {}, MedusaError.Types.INVALID_ARGUMENT],
    ["fractional version", "cart_01", 1.5, {}, MedusaError.Types.INVALID_ARGUMENT],
    ["immutable column", "cart_01", 1, { version: 99 }, MedusaError.Types.INVALID_ARGUMENT],
    ["unsafe column", "cart_01", 1, { 'email" = null --': "x" }, MedusaError.Types.INVALID_ARGUMENT],
  ])("rejects %s", async (_case, id, version, data, type) => {
    const execute: Execute = jest.fn()
    const { service, context } = serviceWith(execute)

    await expect(
      service.updateCartByVersion(id, version, data as never, context)
    ).rejects.toMatchObject({ type })
    expect(execute).not.toHaveBeenCalled()
  })
})

describe("CartService.updateCartByVersion audit", () => {
  it("writes exactly one audit row with the versions before and after the bump", async () => {
    const updated = cart(4)
    const execute: Execute = jest
      .fn()
      .mockResolvedValueOnce([updated])
      .mockResolvedValueOnce([])
    const { service, context } = serviceWith(execute)

    await service.updateCartByVersion("cart_01", 3, {}, context)

    expect(execute).toHaveBeenCalledTimes(2)
    const [sql, params] = execute.mock.calls[1]
    expect(sql).toContain('insert into "audit_log"')
    expect(params).toEqual([expect.any(String), "cart_01", 3, 4])
  })

  it("does not write an audit row on conflict", async () => {
    const execute: Execute = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cart(5)])
    const { service, context } = serviceWith(execute)

    await expect(service.updateCartByVersion("cart_01", 3, {}, context)).rejects.toBeInstanceOf(ConflictError)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls.some(([sql]) => sql.includes('"audit_log"'))).toBe(false)
  })

  it("propagates an audit failure so the caller rolls back the version bump", async () => {
    const execute: Execute = jest
      .fn()
      .mockResolvedValueOnce([cart(4)])
      .mockRejectedValueOnce(new Error("audit insert failed"))
    const { service, context } = serviceWith(execute)

    await expect(service.updateCartByVersion("cart_01", 3, {}, context)).rejects.toThrow("audit insert failed")
  })

  it("runs a standalone bump inside its own transaction", async () => {
    const execute: Execute = jest
      .fn()
      .mockResolvedValueOnce([cart(4)])
      .mockResolvedValueOnce([])
    const transactional = jest.fn((work: (tx: EntityManager) => Promise<unknown>) => work(manager))
    const manager = {
      getConnection: () => ({ execute }),
      transactional,
    } as unknown as EntityManager
    const service = new CartService({ baseRepository: {} } as never)

    await service.updateCartByVersion("cart_01", 3, {}, { manager })

    expect(transactional).toHaveBeenCalledTimes(1)
  })
})

describe("CartService.getVersion", () => {
  it("reads version by raw SQL, not ORM metadata", async () => {
    const execute: Execute = jest.fn().mockResolvedValueOnce([{ version: 5 }])
    const { service, context } = serviceWith(execute)

    const version = await service.getVersion("cart_01", context)

    expect(version).toBe(5)
    expect(execute).toHaveBeenCalledWith(
      'select "version" from "cart" where "id" = ? limit 1',
      ["cart_01"]
    )
  })

  it("returns null for a cart that does not exist", async () => {
    const execute: Execute = jest.fn().mockResolvedValueOnce([])
    const { service, context } = serviceWith(execute)

    expect(await service.getVersion("missing", context)).toBeNull()
  })
})
