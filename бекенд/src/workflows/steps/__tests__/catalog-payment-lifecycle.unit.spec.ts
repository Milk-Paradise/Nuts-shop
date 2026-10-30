import { MedusaError } from "@medusajs/framework/utils"

import { prepareCatalogOnlinePayment } from "../prepare-catalog-online-payment"
import { prepareCatalogPaidOrder } from "../prepare-catalog-paid-order"
import {
  CATALOG_PAYMENT_EXPIRED_AT,
  expireCatalogPaymentCart,
} from "../expire-catalog-payment-cart"
import { resolveCatalogPaymentCart } from "../resolve-catalog-payment-cart"

const providerConfig = {
  retrieveRuntimePaymentProviderConfig: jest.fn(),
  isPaymentProviderAvailable: jest.fn(),
}

function containerWith(services: Record<string, unknown>) {
  return {
    resolve: jest.fn((key: string) => {
      if (key in services) return services[key]
      throw new Error(`Unexpected dependency: ${key}`)
    }),
  } as any
}

function onlineOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    customer_id: "cus-1",
    sales_channel_id: "sc-1",
    region_id: "region-1",
    email: "buyer@example.test",
    total: 1500,
    currency_code: "rub",
    metadata: null,
    shipping_address: { first_name: "Иван", phone: "+79990000000" },
    ...overrides,
  }
}

describe("prepareCatalogOnlinePayment", () => {
  beforeEach(() => {
    providerConfig.retrieveRuntimePaymentProviderConfig.mockReset()
    providerConfig.isPaymentProviderAvailable.mockReset()
    providerConfig.isPaymentProviderAvailable.mockResolvedValue(true)
  })

  function setup(input: {
    order?: unknown
    paymentCollectionId?: unknown
    cartId?: unknown
    customer?: unknown
    sessions?: unknown[]
  } = {}) {
    const graph = jest.fn(async ({ entity }) => {
      switch (entity) {
        case "order":
          return { data: input.order === undefined ? [onlineOrder()] : input.order ? [input.order] : [] }
        case "order_payment_collection":
          return { data: input.paymentCollectionId === undefined ? [{ payment_collection_id: "paycol-1" }] : input.paymentCollectionId ? [{ payment_collection_id: input.paymentCollectionId }] : [] }
        case "order_cart":
          return { data: input.cartId === undefined ? [{ cart_id: "cart-1" }] : input.cartId ? [{ cart_id: input.cartId }] : [] }
        case "customer":
          return { data: input.customer === undefined ? [{ id: "cus-1", email: "buyer@example.test" }] : input.customer ? [input.customer] : [] }
        case "store":
          return { data: [{ id: "store-1", default_sales_channel_id: "sc-1" }] }
        default:
          throw new Error(`Unexpected entity: ${entity}`)
      }
    })
    const payment = { listPaymentSessions: jest.fn().mockResolvedValue(input.sessions ?? []) }
    const paymentOperation = {
      listPaymentOperations: jest.fn().mockResolvedValue([]),
      claimPaymentOperation: jest.fn().mockResolvedValue({
        operation: { id: "operation-1" },
        created: true,
      }),
    }
    return containerWith({
      query: { graph },
      payment,
      paymentProviderConfig: providerConfig,
      paymentOperation,
    })
  }

  it("rejects unknown providers before reading the order", async () => {
    await expect(
      prepareCatalogOnlinePayment(containerWith({}), {
        order_id: "order-1",
        provider_id: "unknown",
      })
    ).rejects.toThrow(MedusaError)
  })

  it("resolves the order payment collection, cart, and saved contacts", async () => {
    providerConfig.retrieveRuntimePaymentProviderConfig.mockResolvedValue({ is_enabled: true })
    await expect(prepareCatalogOnlinePayment(setup(), {
      order_id: "order-1",
      provider_id: "yookassa",
    })).resolves.toMatchObject({
      order_id: "order-1",
      payment_collection_id: "paycol-1",
      cart_id: "cart-1",
      payment_operation_id: "operation-1",
      contacts: {
        email: "buyer@example.test",
        shipping_address: { first_name: "Иван", phone: "+79990000000" },
      },
      existing_payment: null,
      e2e_fail_initiation: false,
    })
  })

  it("checks payment sessions before claiming a new order payment operation", async () => {
    providerConfig.retrieveRuntimePaymentProviderConfig.mockResolvedValue({ is_enabled: true })
    const container = setup()
    const operations = container.resolve("paymentOperation") as {
      claimPaymentOperation: jest.Mock
    }
    const payment = container.resolve("payment") as {
      listPaymentSessions: jest.Mock
    }

    await prepareCatalogOnlinePayment(container, {
      order_id: "order-1",
      provider_id: "yookassa",
    })

    expect(operations.claimPaymentOperation).toHaveBeenCalledWith({
      type: "payment",
      order_id: "order-1",
      cart_id: "cart-1",
      provider_id: "yookassa",
      amount: 1500,
      currency_code: "rub",
      idempotency_key: "payment:initiate:order-1:yookassa:0",
      action: "initiate",
    })
    expect(payment.listPaymentSessions.mock.invocationCallOrder[0]).toBeLessThan(
      operations.claimPaymentOperation.mock.invocationCallOrder[0]
    )
  })

  it("uses immutable order totals without retrieving the completed cart", async () => {
    providerConfig.retrieveRuntimePaymentProviderConfig.mockResolvedValue({ is_enabled: true })
    const container = setup({
      order: onlineOrder({ total: "4890", currency_code: "rub" }),
    })
    const operations = container.resolve("paymentOperation") as {
      claimPaymentOperation: jest.Mock
    }

    await prepareCatalogOnlinePayment(container, {
      order_id: "order-1",
      provider_id: "yookassa",
    })

    expect(operations.claimPaymentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: "order-1",
        cart_id: "cart-1",
        amount: 4890,
        currency_code: "rub",
      })
    )
    expect(
      container.resolve("query").graph.mock.calls.map(([query]: [{ entity: string }]) => query.entity)
    ).not.toContain("cart")
  })

  it("rejects a missing or invalid order total", async () => {
    providerConfig.retrieveRuntimePaymentProviderConfig.mockResolvedValue({ is_enabled: true })

    await expect(
      prepareCatalogOnlinePayment(
        setup({ order: onlineOrder({ total: "not-a-number" }) }),
        { order_id: "order-1", provider_id: "yookassa" }
      )
    ).rejects.toThrow("В заказе недостаточно данных для оплаты")
  })

  it("claims a new operation after a declined payment with the next stable key", async () => {
    providerConfig.retrieveRuntimePaymentProviderConfig.mockResolvedValue({ is_enabled: true })
    const container = setup()
    const operations = container.resolve("paymentOperation") as {
      listPaymentOperations: jest.Mock
      claimPaymentOperation: jest.Mock
    }
    const declinedOperation = {
      id: "operation-declined",
      state: "declined_final",
      idempotency_key: "payment:initiate:order-1:yookassa:0",
    }
    const nextOperation = { id: "operation-new", state: "processing" }
    operations.listPaymentOperations.mockResolvedValue([declinedOperation])
    operations.claimPaymentOperation.mockImplementation(async ({ idempotency_key }) => ({
      operation:
        idempotency_key === declinedOperation.idempotency_key
          ? declinedOperation
          : nextOperation,
      created: idempotency_key !== declinedOperation.idempotency_key,
    }))

    await expect(
      prepareCatalogOnlinePayment(container, {
        order_id: "order-1",
        provider_id: "yookassa",
      })
    ).resolves.toMatchObject({
      status: "created",
      payment_operation_id: "operation-new",
    })
    expect(operations.claimPaymentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotency_key: "payment:initiate:order-1:yookassa:1",
      })
    )
  })

  it("allows an authenticated customer to use the account order access rules", async () => {
    providerConfig.retrieveRuntimePaymentProviderConfig.mockResolvedValue({ is_enabled: true })

    await expect(prepareCatalogOnlinePayment(setup({
      order: onlineOrder({ customer_id: null }),
    }), {
      order_id: "order-1",
      provider_id: "yookassa",
      customer_id: "cus-1",
    })).resolves.toMatchObject({ order_id: "order-1" })
  })

  it("hides an authenticated customer's foreign order before reading payment services", async () => {
    const container = setup({
      order: onlineOrder({
        customer_id: "cus-other",
        email: "other@example.test",
      }),
    })

    await expect(prepareCatalogOnlinePayment(container, {
      order_id: "order-1",
      provider_id: "yookassa",
      customer_id: "cus-1",
    })).rejects.toThrow("Заказ не найден")
    expect(container.resolve("payment").listPaymentSessions).not.toHaveBeenCalled()
  })

  it("rejects a missing order before reading payment services", async () => {
    const container = setup({ order: null })

    await expect(prepareCatalogOnlinePayment(container, {
      order_id: "missing",
      provider_id: "yookassa",
    })).rejects.toThrow("Заказ не найден")
    expect(container.resolve("payment").listPaymentSessions).not.toHaveBeenCalled()
  })

  it.each([
    [{ paymentCollectionId: null }, "Платёжная коллекция заказа не найдена"],
    [{ cartId: null }, "Исходная корзина заказа не найдена"],
  ])("rejects a missing order link: %s", async (input, message) => {
    const container = setup(input)

    await expect(prepareCatalogOnlinePayment(container, {
      order_id: "order-1",
      provider_id: "yookassa",
    })).rejects.toThrow(message)
    expect(container.resolve("payment").listPaymentSessions).not.toHaveBeenCalled()
  })

  it.each(["processing", "retry_pending"])("returns an active %s operation without another claim", async (state) => {
    providerConfig.retrieveRuntimePaymentProviderConfig.mockResolvedValue({ is_enabled: false })
    const sessions = [
      { id: "system", provider_id: "pp_system_default", status: "pending", created_at: "2026-01-03", data: { confirmation: { confirmation_url: "https://pay/system" } } },
      { id: "old", provider_id: "pp_yookassa_yookassa", status: "pending", created_at: "2026-01-01", data: { confirmation: { confirmation_url: "https://pay/old" } } },
      { id: "failed", status: "error", created_at: "2026-01-03", data: { confirmation: { confirmation_url: "https://pay/failed" } } },
      { id: "new", provider_id: "pp_yookassa_yookassa", status: "authorized", created_at: "2026-01-02", data: { payment_operation_id: "operation-active", confirmation: { confirmation_url: "https://pay/new" } } },
    ]
    const container = setup({ sessions })
    const operations = container.resolve("paymentOperation") as { listPaymentOperations: jest.Mock; claimPaymentOperation: jest.Mock }
    operations.listPaymentOperations.mockResolvedValue([{ id: "operation-active", state }])

    await expect(
      prepareCatalogOnlinePayment(container, {
        order_id: "order-1",
        provider_id: "yookassa",
      })
    ).resolves.toMatchObject({
      existing_payment: { payment_session_id: "new", redirect_url: "https://pay/new" },
      status: "active",
    })
    expect(operations.claimPaymentOperation).not.toHaveBeenCalled()
    expect(providerConfig.isPaymentProviderAvailable).not.toHaveBeenCalled()
  })

  it("returns already_paid without claiming an operation or reading YooKassa sessions", async () => {
    const container = setup({
      order: onlineOrder({
        payment_collections: [{
          captured_amount: 1500,
          refunded_amount: 0,
          payments: [{ provider_id: "pp_yookassa_yookassa", amount: 1500 }],
        }],
      }),
    })
    const operations = container.resolve("paymentOperation") as { claimPaymentOperation: jest.Mock }
    const payment = container.resolve("payment") as { listPaymentSessions: jest.Mock }

    await expect(prepareCatalogOnlinePayment(container, {
      order_id: "order-1",
      provider_id: "yookassa",
    })).resolves.toMatchObject({ status: "already_paid" })
    expect(operations.claimPaymentOperation).not.toHaveBeenCalled()
    expect(payment.listPaymentSessions).not.toHaveBeenCalled()
  })

  it("claims a legacy session by its session id and returns it without creating another attempt", async () => {
    providerConfig.retrieveRuntimePaymentProviderConfig.mockResolvedValue({ is_enabled: true })
    const sessions = [{
      id: "legacy-session",
      provider_id: "pp_yookassa_yookassa",
      status: "pending",
      amount: 1500,
      currency_code: "rub",
      created_at: "2026-01-01",
      data: { id: "yookassa-payment", confirmation: { confirmation_url: "https://pay/legacy" } },
    }]
    const container = setup({ sessions })
    const operations = container.resolve("paymentOperation") as { claimPaymentOperation: jest.Mock }

    await expect(prepareCatalogOnlinePayment(container, {
      order_id: "order-1",
      provider_id: "yookassa",
    })).resolves.toMatchObject({
      status: "active",
      existing_payment: { payment_session_id: "legacy-session" },
    })
    expect(operations.claimPaymentOperation).toHaveBeenCalledWith(expect.objectContaining({
      idempotency_key: "payment:legacy-session",
      provider_id: "pp_yookassa_yookassa",
      order_id: null,
      cart_id: "cart-1",
      amount: "1500",
      currency_code: "rub",
      provider_operation_id: "yookassa-payment",
    }))
    expect(operations.claimPaymentOperation).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["processing", false],
    ["processing", true],
    ["retry_pending", false],
    ["retry_pending", true],
  ])("blocks %s without a usable session (session present: %s)", async (state, hasSession) => {
    const container = setup({ sessions: hasSession ? [{
      id: "session-no-confirmation", provider_id: "pp_yookassa_yookassa",
      status: "pending", created_at: "2026-01-01",
      data: { payment_operation_id: "active-operation" },
    }] : [] })
    const operations = container.resolve("paymentOperation")
    operations.listPaymentOperations.mockResolvedValue([{ id: "active-operation", state }])

    await expect(prepareCatalogOnlinePayment(container, {
      order_id: "order-1", provider_id: "yookassa",
    })).resolves.toMatchObject({
      status: "pending_reconciliation",
      payment_operation_id: "active-operation",
      existing_payment: null,
    })
    expect(operations.claimPaymentOperation).not.toHaveBeenCalled()
  })

  it("does not expose a legacy session when its claim has an unknown result", async () => {
    providerConfig.retrieveRuntimePaymentProviderConfig.mockResolvedValue({ is_enabled: true })
    const container = setup({ sessions: [{
      id: "legacy-session", provider_id: "pp_yookassa_yookassa",
      status: "pending", amount: 1500, currency_code: "rub",
      created_at: "2026-01-01",
      data: { confirmation: { confirmation_url: "https://pay/legacy" } },
    }] })
    const operations = container.resolve("paymentOperation")
    operations.claimPaymentOperation.mockResolvedValue({
      operation: { id: "legacy-operation", state: "result_unknown" }, created: false,
    })

    await expect(prepareCatalogOnlinePayment(container, {
      order_id: "order-1", provider_id: "yookassa",
    })).resolves.toMatchObject({
      status: "pending_reconciliation",
      payment_operation_id: "legacy-operation",
      existing_payment: null,
    })
    expect(operations.claimPaymentOperation).toHaveBeenCalledTimes(1)
    expect(operations.claimPaymentOperation).toHaveBeenCalledWith(
      expect.objectContaining({ idempotency_key: "payment:legacy-session" })
    )
  })

  it("does not treat an uncaptured online payment as already paid", async () => {
    providerConfig.retrieveRuntimePaymentProviderConfig.mockResolvedValue({ is_enabled: true })
    const container = setup({
      order: onlineOrder({
        payment_collections: [{
          captured_amount: 0,
          payments: [{ provider_id: "pp_yookassa_yookassa", amount: 1500, captured_at: null }],
        }],
      }),
    })
    await expect(prepareCatalogOnlinePayment(container, {
      order_id: "order-1", provider_id: "yookassa",
    })).resolves.toMatchObject({ status: "created" })
    expect(container.resolve("paymentOperation").claimPaymentOperation).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])("blocks an unknown result before claim, session present: %s", async (hasSession) => {
    const container = setup({ sessions: hasSession ? [{
      id: "unknown-session", provider_id: "pp_yookassa_yookassa", status: "pending",
      created_at: "2026-01-01",
      data: { payment_operation_id: "unknown-operation", confirmation: { confirmation_url: "https://pay/unknown" } },
    }] : [] })
    const operations = container.resolve("paymentOperation")
    operations.listPaymentOperations.mockResolvedValue([{ id: "unknown-operation", state: "result_unknown" }])
    await expect(prepareCatalogOnlinePayment(container, {
      order_id: "order-1", provider_id: "yookassa",
    })).resolves.toMatchObject({
      status: "pending_reconciliation", existing_payment: null,
    })
    expect(operations.claimPaymentOperation).not.toHaveBeenCalled()
  })

  it("preserves the E2E initiation failure flag copied to the completed order", async () => {
    const previousE2ERun = process.env.E2E_RUN
    process.env.E2E_RUN = "true"
    providerConfig.retrieveRuntimePaymentProviderConfig.mockResolvedValue({ is_enabled: true })

    try {
      await expect(
        prepareCatalogOnlinePayment(
          setup({
            order: onlineOrder({
              metadata: { e2e_payment_fail_initiation: true },
            }),
          }),
          { order_id: "order-1", provider_id: "yookassa" }
        )
      ).resolves.toMatchObject({ e2e_fail_initiation: true })
    } finally {
      if (previousE2ERun === undefined) {
        delete process.env.E2E_RUN
      } else {
        process.env.E2E_RUN = previousE2ERun
      }
    }
  })

  it("requires enabled runtime configuration when no session is reusable", async () => {
    providerConfig.retrieveRuntimePaymentProviderConfig.mockResolvedValue(null)
    await expect(
      prepareCatalogOnlinePayment(setup(), {
        order_id: "order-1",
        provider_id: "yookassa",
      })
    ).rejects.toThrow(MedusaError)
  })

  it("rejects a new payment outside the provider store and region scope", async () => {
    providerConfig.retrieveRuntimePaymentProviderConfig.mockResolvedValue({
      is_enabled: true,
    })
    providerConfig.isPaymentProviderAvailable.mockResolvedValue(false)

    await expect(
      prepareCatalogOnlinePayment(setup(), {
        order_id: "order-1",
        provider_id: "yookassa",
      })
    ).rejects.toThrow(MedusaError)
    expect(providerConfig.isPaymentProviderAvailable).toHaveBeenCalledWith(
      "yookassa",
      { store_id: "store-1", region_id: "region-1" }
    )
  })

})

function paidCart(overrides: Record<string, unknown> = {}) {
  return {
    id: "cart-1",
    email: "buyer@example.test",
    currency_code: "rub",
    total: 1500,
    region: { id: "reg-1" },
    customer: { id: "cus-1" },
    metadata: { channel: "web" },
    shipping_address: { id: "addr-1", city: "Москва", created_at: "old" },
    billing_address: null,
    items: [
      {
        id: "line-1",
        quantity: 2,
        title: "Краска",
        unit_price: 700,
        metadata: { keep: true },
        adjustments: [{ code: "SALE", amount: 100 }],
        tax_lines: [{ code: "VAT", rate: 20 }],
        variant: {
          id: "variant-1",
          title: "1 л",
          manage_inventory: true,
          calculated_price: {
            original_amount: 800,
            calculated_amount: 700,
            calculated_price: { price_list_type: "sale" },
          },
          product: { id: "prod-1", title: "Краска", shipping_profile: { id: "sp-1" } },
          inventory_items: [
            { inventory_item_id: "inventory-1", required_quantity: 2, inventory: { requires_shipping: true } },
          ],
        },
      },
    ],
    shipping_methods: [
      { name: "Курьер", amount: 100, adjustments: [{ code: "SHIP", amount: 10 }] },
    ],
    promotions: [{ id: "promo-1" }, { id: null }],
    credit_lines: [{ amount: 5, reference: "credit" }],
    payment_collection: {
      id: "paycol-1",
      payment_sessions: [
        { id: "session-old", provider_id: "pp_yookassa_yookassa", amount: 1500, currency_code: "rub", created_at: "2026-01-01" },
        { id: "session-new", provider_id: "pp_yookassa_yookassa", amount: 1500, currency_code: "rub", created_at: "2026-01-02" },
      ],
    },
    ...overrides,
  }
}

describe("prepareCatalogPaidOrder", () => {
  function setup(cart: unknown, orderId?: unknown) {
    const graph = jest.fn(async ({ entity }) =>
      entity === "order_cart"
        ? { data: orderId === undefined ? [] : [{ order_id: orderId }] }
        : { data: cart === undefined ? [] : [cart] }
    )
    return containerWith({
      query: { graph },
      cartVersioning: { getVersion: jest.fn().mockResolvedValue(1) },
    })
  }

  it("is idempotent when the cart already has an order", async () => {
    await expect(
      prepareCatalogPaidOrder(
        setup(paidCart({ completed_at: "2026-01-02" }), "order-1"),
        { cart_id: "cart-1" }
      )
    ).resolves.toMatchObject({
      order_id: "order-1",
      order_input: null,
      payment_collection_id: "paycol-1",
      payment_session_id: "session-new",
    })
  })

  it("does not reconcile an unregistered session for an existing order", async () => {
    const cart = paidCart({
      completed_at: "2026-01-02",
      payment_collection: {
        id: "paycol-1",
        payment_sessions: [
          { id: "session-system", provider_id: "pp_system_default", amount: 1500, currency_code: "rub", created_at: "2026-01-03" },
        ],
      },
    })

    await expect(
      prepareCatalogPaidOrder(setup(cart, "order-1"), {
        cart_id: "cart-1",
        payment_session_id: "session-system",
      })
    ).rejects.toThrow("Платёжная сессия заказа не найдена")
  })

  it.each([
    [undefined, "missing cart"],
    [paidCart({ completed_at: "2026-01-01" }), "completed cart"],
    [paidCart({ items: [] }), "empty cart"],
    [paidCart({ payment_collection: null }), "missing payment collection"],
    [paidCart({ total: 1499 }), "amount mismatch"],
    [paidCart({ currency_code: "usd" }), "currency mismatch"],
  ])("rejects %s", async (cart, _label: string) => {
    await expect(
      prepareCatalogPaidOrder(setup(cart), { cart_id: "cart-1" })
    ).rejects.toThrow(MedusaError)
  })

  it("selects the newest provider session and builds immutable order input", async () => {
    const result = await prepareCatalogPaidOrder(setup(paidCart()), {
      cart_id: "cart-1",
    })

    expect(result).toMatchObject({
      payment_session_id: "session-new",
      expected_reservations: [
        { cart_line_id: "line-1", inventory_item_id: "inventory-1", quantity: 4 },
      ],
      promotion_ids: ["promo-1"],
      order_input: {
        shipping_address: { city: "Москва" },
        billing_address: undefined,
        promo_codes: ["SALE", "SHIP"],
        items: [
          expect.objectContaining({
            compare_at_unit_price: 800,
            requires_shipping: true,
            metadata: { keep: true, catalog_cart_line_id: "line-1" },
          }),
        ],
      },
    })
    expect(result.order_input?.shipping_address).not.toHaveProperty("id")
  })

  it("honors an explicitly requested session and skips unmanaged inventory", async () => {
    const cart = paidCart({
      items: [{ id: "line-2", quantity: 1, unit_price: 100, requires_shipping: false, variant: { manage_inventory: false, product: {} } }],
      shipping_methods: null,
      promotions: null,
      credit_lines: null,
    })
    const result = await prepareCatalogPaidOrder(setup(cart), {
      cart_id: "cart-1",
      payment_session_id: "session-old",
    })
    expect(result.payment_session_id).toBe("session-old")
    expect(result.expected_reservations).toEqual([])
    expect(result.order_input?.items?.[0]).toEqual(
      expect.objectContaining({ requires_shipping: false, compare_at_unit_price: undefined })
    )
  })
})

describe("expireCatalogPaymentCart", () => {
  function setup(cart: unknown) {
    const graph = jest.fn().mockResolvedValue({ data: cart ? [cart] : [] })
    const cartService = { updateCarts: jest.fn().mockResolvedValue({}) }
    const paymentService = { deletePaymentSession: jest.fn().mockResolvedValue(undefined) }
    const inventoryService = { deleteReservationItemsByLineItem: jest.fn().mockResolvedValue(undefined) }
    return {
      container: containerWith({
        query: { graph },
        cart: cartService,
        payment: paymentService,
        inventory: inventoryService,
      }),
      cartService,
      paymentService,
      inventoryService,
      graph,
    }
  }

  it.each([
    [undefined],
    [{ id: "cart-1", completed_at: new Date() }],
    [{ id: "cart-1", metadata: { [CATALOG_PAYMENT_EXPIRED_AT]: "already" } }],
  ])("does not mutate unavailable carts", async (cart) => {
    const { container, cartService } = setup(cart)
    await expect(expireCatalogPaymentCart(container, { cart_id: "cart-1", now: "2026-01-03" })).resolves.toEqual({ expired: false })
    expect(cartService.updateCarts).not.toHaveBeenCalled()
  })

  it("expires a stale provider session and preserves metadata", async () => {
    const { container, cartService } = setup({
      id: "cart-1",
      metadata: { keep: true },
      payment_collection: { payment_sessions: [
        { provider_id: "manual", updated_at: "2020-01-01" },
        { id: "session-1", provider_id: "pp_yookassa_yookassa", updated_at: "2026-01-01" },
      ] },
    })
    await expect(expireCatalogPaymentCart(container, { cart_id: "cart-1", now: "2026-01-03" })).resolves.toEqual({ expired: true })
    expect(cartService.updateCarts).toHaveBeenCalledWith("cart-1", {
      metadata: { keep: true, [CATALOG_PAYMENT_EXPIRED_AT]: "2026-01-03T00:00:00.000Z" },
    })
  })

  it("keeps a payment cart during the one-hour reservation window", async () => {
    const { container, cartService, paymentService, inventoryService } = setup({
      id: "cart-1",
      metadata: {},
      items: [{ id: "line-1" }],
      payment_collection: { payment_sessions: [
        {
          id: "session-1",
          provider_id: "pp_yookassa_yookassa",
          status: "pending",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ] },
    })

    await expect(
      expireCatalogPaymentCart(container, {
        cart_id: "cart-1",
        now: "2026-01-01T00:59:59Z",
      })
    ).resolves.toEqual({ expired: false })
    expect(paymentService.deletePaymentSession).not.toHaveBeenCalled()
    expect(inventoryService.deleteReservationItemsByLineItem).not.toHaveBeenCalled()
    expect(cartService.updateCarts).not.toHaveBeenCalled()
  })

  it("releases a pending payment cart after one hour", async () => {
    const { container, cartService, paymentService, inventoryService } = setup({
      id: "cart-1",
      metadata: {},
      items: [{ id: "line-1" }],
      payment_collection: { payment_sessions: [
        {
          id: "session-1",
          provider_id: "pp_yookassa_yookassa",
          status: "pending",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ] },
    })

    await expect(
      expireCatalogPaymentCart(container, {
        cart_id: "cart-1",
        now: "2026-01-01T01:00:00Z",
      })
    ).resolves.toEqual({ expired: true })
    expect(paymentService.deletePaymentSession).toHaveBeenCalledWith("session-1")
    expect(inventoryService.deleteReservationItemsByLineItem).toHaveBeenCalledWith(["line-1"])
    expect(cartService.updateCarts).toHaveBeenCalled()
  })

  it("keeps a registered customer's cart available after 24 hours", async () => {
    const { container, cartService, paymentService, inventoryService, graph } = setup({
      id: "cart-1",
      customer_id: "cus-1",
      metadata: {},
      items: [{ id: "line-1" }],
      payment_collection: { payment_sessions: [
        { id: "session-1", provider_id: "pp_yookassa_yookassa", status: "pending", updated_at: "2026-01-01" },
      ] },
    })

    await expect(
      expireCatalogPaymentCart(container, {
        cart_id: "cart-1",
        now: "2026-01-03",
      })
    ).resolves.toEqual({ expired: false })

    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.arrayContaining(["customer_id"]),
      })
    )
    expect(paymentService.deletePaymentSession).not.toHaveBeenCalled()
    expect(inventoryService.deleteReservationItemsByLineItem).not.toHaveBeenCalled()
    expect(cartService.updateCarts).not.toHaveBeenCalled()
  })

  it("releases the reserved stock and the provider session, not just the marker", async () => {
    const { container, paymentService, inventoryService } = setup({
      id: "cart-1",
      metadata: {},
      items: [{ id: "line-1" }, { id: "line-2" }],
      payment_collection: { payment_sessions: [
        { id: "session-manual", provider_id: "manual", updated_at: "2020-01-01" },
        { id: "session-1", provider_id: "pp_yookassa_yookassa", status: "pending", updated_at: "2026-01-01" },
      ] },
    })

    await expect(expireCatalogPaymentCart(container, { cart_id: "cart-1", now: "2026-01-03" })).resolves.toEqual({ expired: true })

    // Only the registered online session is cancelled: a manual session holds
    // nothing at a provider and is not ours to delete.
    expect(paymentService.deletePaymentSession).toHaveBeenCalledTimes(1)
    expect(paymentService.deletePaymentSession).toHaveBeenCalledWith("session-1")
    expect(inventoryService.deleteReservationItemsByLineItem).toHaveBeenCalledWith(["line-1", "line-2"])
  })

  it("cancels the session before freeing the stock", async () => {
    const order: string[] = []
    const { container, paymentService, inventoryService } = setup({
      id: "cart-1",
      metadata: {},
      items: [{ id: "line-1" }],
      payment_collection: { payment_sessions: [
        { id: "session-1", provider_id: "pp_yookassa_yookassa", status: "pending", updated_at: "2026-01-01" },
      ] },
    })
    paymentService.deletePaymentSession.mockImplementation(async () => { order.push("session") })
    inventoryService.deleteReservationItemsByLineItem.mockImplementation(async () => { order.push("stock") })

    await expireCatalogPaymentCart(container, { cart_id: "cart-1", now: "2026-01-03" })

    // Freeing stock while a payable session still lives would let a late capture
    // produce a paid order with nothing reserved behind it.
    expect(order).toEqual(["session", "stock"])
  })

  it("leaves the cart unmarked when the hold could not be released", async () => {
    const { container, cartService, paymentService } = setup({
      id: "cart-1",
      metadata: {},
      items: [{ id: "line-1" }],
      payment_collection: { payment_sessions: [
        { id: "session-1", provider_id: "pp_yookassa_yookassa", status: "pending", updated_at: "2026-01-01" },
      ] },
    })
    paymentService.deletePaymentSession.mockRejectedValue(new Error("провайдер недоступен"))

    await expect(expireCatalogPaymentCart(container, { cart_id: "cart-1", now: "2026-01-03" })).rejects.toThrow("провайдер недоступен")
    // Marking it handled here would strand the reservation forever: the next run
    // skips carts that already carry the marker.
    expect(cartService.updateCarts).not.toHaveBeenCalled()
  })

  it.each(["authorized", "captured"])("does not expire a cart whose session is %s", async (status) => {
    const { container, cartService, paymentService, inventoryService } = setup({
      id: "cart-1",
      metadata: {},
      items: [{ id: "line-1" }],
      payment_collection: { payment_sessions: [
        { id: "session-1", provider_id: "pp_yookassa_yookassa", status, updated_at: "2026-01-01" },
      ] },
    })

    await expect(expireCatalogPaymentCart(container, { cart_id: "cart-1", now: "2026-01-03" })).resolves.toEqual({ expired: false })
    expect(paymentService.deletePaymentSession).not.toHaveBeenCalled()
    expect(inventoryService.deleteReservationItemsByLineItem).not.toHaveBeenCalled()
    expect(cartService.updateCarts).not.toHaveBeenCalled()
  })

  it.each(["invalid-date", "2026-01-01T00:30:00Z"])("does not expire for invalid or recent activity at %s", async (now) => {
    const { container, cartService } = setup({
      id: "cart-1",
      payment_collection: { payment_sessions: [
        { provider_id: "pp_yookassa_yookassa", created_at: "2026-01-01T00:00:00Z" },
      ] },
    })
    await expect(expireCatalogPaymentCart(container, { cart_id: "cart-1", now })).resolves.toEqual({ expired: false })
    expect(cartService.updateCarts).not.toHaveBeenCalled()
  })
})

describe("resolveCatalogPaymentCart", () => {
  it("resolves and validates a direct cart id", async () => {
    const found = containerWith({ query: { graph: jest.fn().mockResolvedValue({ data: [{ id: "cart-1" }] }) } })
    await expect(resolveCatalogPaymentCart(found, { cart_id: "cart-1" })).resolves.toEqual({ cart_id: "cart-1" })

    const missing = containerWith({ query: { graph: jest.fn().mockResolvedValue({ data: [] }) } })
    await expect(resolveCatalogPaymentCart(missing, { cart_id: "missing" })).rejects.toThrow(MedusaError)
  })

  it("resolves the cart through a payment session", async () => {
    const container = containerWith({
      payment: { retrievePaymentSession: jest.fn().mockResolvedValue({ payment_collection_id: "paycol-1" }) },
      query: { graph: jest.fn().mockResolvedValue({ data: [{ cart_id: "cart-1" }] }) },
    })
    await expect(resolveCatalogPaymentCart(container, { payment_session_id: "session-1" })).resolves.toEqual({ cart_id: "cart-1" })
  })

  it("rejects missing input and orphaned sessions", async () => {
    await expect(resolveCatalogPaymentCart(containerWith({}), {})).rejects.toThrow(MedusaError)
    const container = containerWith({
      payment: { retrievePaymentSession: jest.fn().mockResolvedValue({ payment_collection_id: "paycol-1" }) },
      query: { graph: jest.fn().mockResolvedValue({ data: [{ cart_id: "" }] }) },
    })
    await expect(resolveCatalogPaymentCart(container, { payment_session_id: "session-1" })).rejects.toThrow(MedusaError)
  })
})
