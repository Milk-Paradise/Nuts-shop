import { createMoyskladCustomerOrder } from "../create-moysklad-customer-order"
import type { MoyskladClient } from "../../../modules/moysklad-integration/client"
import { MedusaError } from "@medusajs/framework/utils"
import { MoyskladApiError } from "../../../modules/moysklad-integration/client"

const order = {
  id: "order_1",
  email: "buyer@example.com",
  items: [{ variant_sku: "SKU-1", title: "Краска", quantity: 2, unit_price: 500 }],
  shipping_address: {
    first_name: "Иван",
    last_name: "Иванов",
    phone: "+70000000000"
  }
}

function buildContainer(
  overrides: Partial<{
    moyskladService: Record<string, jest.Mock>
    query: { graph: jest.Mock }
  }> = {}
) {
  const moyskladService = {
    getOrderSyncStatus: jest.fn().mockResolvedValue(null),
    getConnectionConfig: jest.fn().mockResolvedValue({
      encrypted_credentials: "v1.encrypted",
      is_active: true
    }),
    recordOrderSyncAttempt: jest.fn().mockResolvedValue(undefined),
    ...overrides.moyskladService
  }
  const query = overrides.query ?? {
    graph: jest.fn().mockResolvedValue({ data: [order] })
  }
  const logger = { error: jest.fn() }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === "query") return query
      if (key === "logger") return logger
      return moyskladService
    })
  }

  return { container, moyskladService, query, logger }
}

function buildClient(overrides: Partial<Record<keyof MoyskladClient, jest.Mock>> = {}) {
  return {
    findDefaultOrganization: jest.fn().mockResolvedValue({
      id: "org_1",
      meta: { href: "https://api.moysklad.ru/organization/org_1" }
    }),
    findCounterpartyByEmail: jest.fn().mockResolvedValue(null),
    createCounterparty: jest.fn().mockResolvedValue({
      id: "cp_1",
      meta: { href: "https://api.moysklad.ru/counterparty/cp_1" }
    }),
    findProductsBySku: jest.fn().mockResolvedValue([
      {
        id: "prod_1",
        meta: { href: "https://api.moysklad.ru/product/prod_1" }
      }
    ]),
    createCustomerOrder: jest.fn().mockResolvedValue({
      id: "ms_order_1",
      meta: { href: "https://api.moysklad.ru/customerorder/ms_order_1" }
    }),
    ...overrides
  } as unknown as MoyskladClient
}

describe("createMoyskladCustomerOrder", () => {
  it("returns the existing sync status without calling MoySklad again when already synced", async () => {
    const { container, moyskladService } = buildContainer({
      moyskladService: {
        getOrderSyncStatus: jest.fn().mockResolvedValue({ id: "mso_1", status: "synced" }),
        getConnectionConfig: jest.fn(),
        recordOrderSyncAttempt: jest.fn()
      }
    })
    const client = buildClient()

    const result = await createMoyskladCustomerOrder(container as never, { orderId: "order_1" }, client)

    expect(result).toEqual({ id: "mso_1", status: "synced" })
    expect(moyskladService.getConnectionConfig).not.toHaveBeenCalled()
    expect(client.createCustomerOrder).not.toHaveBeenCalled()
  })

  it("creates the order in MoySklad and records the synced status with the returned id", async () => {
    const { container, moyskladService } = buildContainer()
    const client = buildClient()

    await createMoyskladCustomerOrder(container as never, { orderId: "order_1" }, client)

    expect(client.createCustomerOrder).toHaveBeenCalledWith(
      "v1.encrypted",
      expect.objectContaining({
        organizationHref: "https://api.moysklad.ru/organization/org_1",
        agentHref: "https://api.moysklad.ru/counterparty/cp_1",
        positions: [
          {
            assortmentHref: "https://api.moysklad.ru/product/prod_1",
            quantity: 2,
            priceRubles: 500
          }
        ]
      })
    )
    expect(moyskladService.recordOrderSyncAttempt).toHaveBeenCalledWith({
      orderId: "order_1",
      status: "synced",
      moyskladOrderId: "ms_order_1"
    })
  })

  it("loads the line-item detail quantity before creating the MoySklad order", async () => {
    const graph = jest.fn().mockImplementation(
      ({ fields }: { fields: string[] }) =>
        Promise.resolve({
          data: [
            {
              ...order,
              items: order.items.map((item) => ({
                ...item,
                quantity: fields.includes("items.detail.quantity")
                  ? item.quantity
                  : undefined,
              })),
            },
          ],
        })
    )
    const { container } = buildContainer({ query: { graph } })
    const client = buildClient()

    await createMoyskladCustomerOrder(
      container as never,
      { orderId: "order_1" },
      client
    )

    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.arrayContaining(["items.detail.quantity"]),
      })
    )
    expect(client.createCustomerOrder).toHaveBeenCalledWith(
      "v1.encrypted",
      expect.objectContaining({
        positions: [
          expect.objectContaining({
            quantity: 2,
          }),
        ],
      })
    )
  })

  it.each([undefined, 0, -1])(
    "rejects invalid line-item quantity %s before calling MoySklad",
    async (quantity) => {
      const orderWithInvalidQuantity = {
        ...order,
        items: [{ ...order.items[0], quantity }],
      }
      const { container, moyskladService } = buildContainer({
        query: {
          graph: jest.fn().mockResolvedValue({
            data: [orderWithInvalidQuantity],
          }),
        },
      })
      const client = buildClient()

      await expect(
        createMoyskladCustomerOrder(
          container as never,
          { orderId: "order_1" },
          client
        )
      ).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
        message: expect.stringContaining(
          'Заказ order_1: позиция "Краска" (SKU "SKU-1")'
        ),
      })

      expect(client.findDefaultOrganization).not.toHaveBeenCalled()
      expect(client.findProductsBySku).not.toHaveBeenCalled()
      expect(client.findCounterpartyByEmail).not.toHaveBeenCalled()
      expect(client.createCounterparty).not.toHaveBeenCalled()
      expect(client.createCustomerOrder).not.toHaveBeenCalled()
      expect(moyskladService.recordOrderSyncAttempt).toHaveBeenCalledWith({
        orderId: "order_1",
        status: "error",
        retryable: false,
        lastError: expect.stringContaining(
          'Заказ order_1: позиция "Краска" (SKU "SKU-1")'
        ),
      })
    }
  )

  it("reuses an existing counterparty found by the buyer's email instead of creating a new one", async () => {
    const { container } = buildContainer()
    const client = buildClient({
      findCounterpartyByEmail: jest.fn().mockResolvedValue({
        id: "cp_existing",
        meta: { href: "https://api.moysklad.ru/counterparty/cp_existing" }
      })
    })

    await createMoyskladCustomerOrder(container as never, { orderId: "order_1" }, client)

    expect(client.createCounterparty).not.toHaveBeenCalled()
    expect(client.createCustomerOrder).toHaveBeenCalledWith(
      "v1.encrypted",
      expect.objectContaining({
        agentHref: "https://api.moysklad.ru/counterparty/cp_existing"
      })
    )
  })

  it("creates a counterparty using the email as the name when the order has no shipping address", async () => {
    const orderWithoutAddress = { ...order, shipping_address: null }
    const { container } = buildContainer({
      query: {
        graph: jest.fn().mockResolvedValue({ data: [orderWithoutAddress] })
      }
    })
    const client = buildClient()

    await createMoyskladCustomerOrder(container as never, { orderId: "order_1" }, client)

    expect(client.createCounterparty).toHaveBeenCalledWith("v1.encrypted", {
      name: "buyer@example.com",
      email: "buyer@example.com",
      phone: undefined
    })
  })

  it("creates a counterparty using the order id as the name when there is neither an address nor an email", async () => {
    const orderWithoutContact = {
      ...order,
      shipping_address: null,
      email: null
    }
    const { container } = buildContainer({
      query: {
        graph: jest.fn().mockResolvedValue({ data: [orderWithoutContact] })
      }
    })
    const client = buildClient()

    await createMoyskladCustomerOrder(container as never, { orderId: "order_1" }, client)

    expect(client.findCounterpartyByEmail).not.toHaveBeenCalled()
    expect(client.createCounterparty).toHaveBeenCalledWith("v1.encrypted", {
      name: "order_1",
      email: undefined,
      phone: undefined
    })
  })

  it("records a sync error and does not create an order when a SKU has no unambiguous MoySklad match", async () => {
    const { container, moyskladService } = buildContainer()
    const client = buildClient({
      findProductsBySku: jest.fn().mockResolvedValue([])
    })

    await expect(createMoyskladCustomerOrder(container as never, { orderId: "order_1" }, client)).rejects.toThrow(
      'Товар с SKU "SKU-1" не найден в МойСклад.'
    )

    expect(client.createCustomerOrder).not.toHaveBeenCalled()
    expect(client.createCounterparty).not.toHaveBeenCalled()
    expect(moyskladService.recordOrderSyncAttempt).toHaveBeenCalledWith({
      orderId: "order_1",
      status: "error",
      retryable: true,
      lastError: 'Товар с SKU "SKU-1" не найден в МойСклад.'
    })
  })

  it("records a sync error when a SKU matches more than one MoySklad product", async () => {
    const { container, moyskladService } = buildContainer()
    const client = buildClient({
      findProductsBySku: jest.fn().mockResolvedValue([
        { id: "prod_1", meta: { href: "a" } },
        { id: "prod_2", meta: { href: "b" } }
      ])
    })

    await expect(createMoyskladCustomerOrder(container as never, { orderId: "order_1" }, client)).rejects.toThrow(
      'SKU "SKU-1" соответствует нескольким товарам в МойСклад.'
    )

    expect(moyskladService.recordOrderSyncAttempt).toHaveBeenCalledWith({
      orderId: "order_1",
      status: "error",
      retryable: true,
      lastError: 'SKU "SKU-1" соответствует нескольким товарам в МойСклад.'
    })
    expect(client.createCounterparty).not.toHaveBeenCalled()
  })

  it("validates every position before the first write to MoySklad", async () => {
    const twoItemOrder = {
      ...order,
      items: [
        order.items[0],
        {
          variant_sku: "SKU-2",
          title: "Лак",
          quantity: 1,
          unit_price: 300,
        },
      ],
    }
    const { container } = buildContainer({
      query: {
        graph: jest.fn().mockResolvedValue({ data: [twoItemOrder] }),
      },
    })
    const client = buildClient({
      findProductsBySku: jest
        .fn()
        .mockResolvedValueOnce([
          { id: "prod_1", meta: { href: "https://api.moysklad.ru/product/prod_1" } },
        ])
        .mockResolvedValueOnce([]),
    })

    await expect(
      createMoyskladCustomerOrder(
        container as never,
        { orderId: "order_1" },
        client
      )
    ).rejects.toThrow('Товар с SKU "SKU-2" не найден в МойСклад.')

    expect(client.findProductsBySku).toHaveBeenCalledTimes(2)
    expect(client.createCounterparty).not.toHaveBeenCalled()
    expect(client.createCustomerOrder).not.toHaveBeenCalled()
  })

  it("records a sync error without creating an order when MoySklad is not configured", async () => {
    const { container, moyskladService } = buildContainer({
      moyskladService: {
        getOrderSyncStatus: jest.fn().mockResolvedValue(null),
        getConnectionConfig: jest.fn().mockResolvedValue(null),
        recordOrderSyncAttempt: jest.fn()
      }
    })
    const client = buildClient()

    await expect(createMoyskladCustomerOrder(container as never, { orderId: "order_1" }, client)).rejects.toThrow(
      "MoySklad connection is not configured."
    )

    expect(client.createCustomerOrder).not.toHaveBeenCalled()
    expect(moyskladService.recordOrderSyncAttempt).toHaveBeenCalledWith({
      orderId: "order_1",
      status: "error",
      retryable: true,
      lastError: "MoySklad connection is not configured."
    })
  })

  it("does not call MoySklad again when a prior attempt already created an order but failed to record it as synced", async () => {
    const { container, moyskladService } = buildContainer({
      moyskladService: {
        getOrderSyncStatus: jest.fn().mockResolvedValue({
          id: "mso_1",
          status: "error",
          moysklad_order_id: "ms_order_1"
        }),
        getConnectionConfig: jest.fn(),
        recordOrderSyncAttempt: jest.fn().mockResolvedValue(undefined)
      }
    })
    const client = buildClient()

    await createMoyskladCustomerOrder(container as never, { orderId: "order_1" }, client)

    expect(client.createCustomerOrder).not.toHaveBeenCalled()
    expect(moyskladService.getConnectionConfig).not.toHaveBeenCalled()
    expect(moyskladService.recordOrderSyncAttempt).toHaveBeenCalledWith({
      orderId: "order_1",
      status: "synced",
      moyskladOrderId: "ms_order_1"
    })
  })

  it("keeps the MoySklad order id when the order was created but recording the synced status fails", async () => {
    const { container, moyskladService } = buildContainer({
      moyskladService: {
        getOrderSyncStatus: jest.fn().mockResolvedValue(null),
        getConnectionConfig: jest.fn().mockResolvedValue({
          encrypted_credentials: "v1.encrypted",
          is_active: true
        }),
        recordOrderSyncAttempt: jest
          .fn()
          .mockRejectedValueOnce(new Error("db unavailable"))
          .mockResolvedValue(undefined)
      }
    })
    const client = buildClient()

    await expect(createMoyskladCustomerOrder(container as never, { orderId: "order_1" }, client)).rejects.toThrow(
      "db unavailable"
    )

    expect(client.createCustomerOrder).toHaveBeenCalledTimes(1)
    expect(moyskladService.recordOrderSyncAttempt).toHaveBeenNthCalledWith(2, {
      orderId: "order_1",
      status: "error",
      retryable: true,
      moyskladOrderId: "ms_order_1",
      lastError: "db unavailable"
    })
  })

  it("propagates the MoySklad API error and records it as the last sync error", async () => {
    const activeConfig = {
      encrypted_credentials: "v1.encrypted",
      is_active: true
    }
    const { container, moyskladService, logger } = buildContainer({
      moyskladService: {
        getOrderSyncStatus: jest.fn().mockResolvedValue(null),
        getConnectionConfig: jest.fn().mockResolvedValue(activeConfig),
        recordOrderSyncAttempt: jest.fn().mockResolvedValue(undefined)
      }
    })
    const client = buildClient({
      createCustomerOrder: jest.fn().mockRejectedValue(new Error("Недействительный токен"))
    })

    await expect(createMoyskladCustomerOrder(container as never, { orderId: "order_1" }, client)).rejects.toThrow(
      "Недействительный токен"
    )

    expect(moyskladService.recordOrderSyncAttempt).toHaveBeenCalledWith({
      orderId: "order_1",
      status: "error",
      retryable: true,
      lastError: "Недействительный токен"
    })
    expect(activeConfig.is_active).toBe(true)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Временная ошибка, автоматический повтор будет выполнен по расписанию"
      )
    )
  })

  it("does not mark an order synced when MoySklad returns no document id", async () => {
    const { container, moyskladService } = buildContainer({
      moyskladService: {
        getOrderSyncStatus: jest.fn().mockResolvedValue(null),
        getConnectionConfig: jest.fn().mockResolvedValue({
          encrypted_credentials: "v1.encrypted",
          is_active: true
        }),
        recordOrderSyncAttempt: jest.fn().mockResolvedValue(undefined)
      }
    })
    const client = buildClient({
      createCustomerOrder: jest.fn().mockResolvedValue({ meta: { href: "href-order" } })
    })

    await expect(
      createMoyskladCustomerOrder(container as never, { orderId: "order_1" }, client)
    ).rejects.toThrow("не вернул идентификатор созданного заказа")

    expect(moyskladService.recordOrderSyncAttempt).toHaveBeenCalledTimes(1)
    expect(moyskladService.recordOrderSyncAttempt).toHaveBeenCalledWith({
      orderId: "order_1",
      status: "error",
      retryable: true,
      lastError: "МойСклад не вернул идентификатор созданного заказа."
    })
    expect(moyskladService.recordOrderSyncAttempt).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "synced" })
    )
  })

  it("marks a MoySklad 400 response as non-retryable", async () => {
    const { container, moyskladService, logger } = buildContainer()
    const client = buildClient({
      findDefaultOrganization: jest.fn().mockRejectedValue(
        new MoyskladApiError('{"errors":[{"code":3000}]}', 400)
      ),
    })

    await expect(
      createMoyskladCustomerOrder(
        container as never,
        { orderId: "order_1" },
        client
      )
    ).rejects.toMatchObject({ status: 400 })

    expect(moyskladService.recordOrderSyncAttempt).toHaveBeenCalledWith({
      orderId: "order_1",
      status: "error",
      lastError: expect.stringContaining("3000"),
      retryable: false,
    })
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Требуется исправление данных, автоматические повторы остановлены"
      )
    )
  })
})
