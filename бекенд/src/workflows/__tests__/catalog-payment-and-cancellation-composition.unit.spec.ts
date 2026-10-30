import type { PreparedCatalogOnlinePayment } from "../steps/prepare-catalog-online-payment"

const scenario = {
  paymentPreparation: {
    status: "created",
    order_id: "order_1",
    cart_id: "cart_1",
    payment_operation_id: "operation_1",
    payment_collection_id: "paycol_existing",
    medusa_provider_id: "yookassa_yookassa",
    contacts: {
      email: "buyer@test.com" as string | null,
      shipping_address: {
        first_name: "Иван" as string | null,
        phone: "+79990000000" as string | null,
      },
    },
    existing_payment: null as {
      payment_collection_id: string
      payment_session_id: string
      redirect_url: string
    } | null,
    e2e_fail_initiation: false,
  } as PreparedCatalogOnlinePayment,
  checkoutValidation: { valid: true },
  shippingOptions: { options: [] as Array<Record<string, unknown>> },
  existingPaymentCollection: { id: "paycol_existing" as string | null },
  reservationCart: {
    id: "cart_1",
    sales_channel_id: "sc_1" as string | null,
    items: [
      {
        id: "line_1",
        variant_id: "variant_1",
        quantity: 2,
        variant: { id: "variant_1", manage_inventory: true },
      },
    ] as any[],
  },
  createdCollection: { id: "paycol_created" } as { id?: string } | undefined,
  paymentSession: {
    id: "payses_1",
    data: { confirmation: { confirmation_url: "https://pay.test/redirect" } },
  } as any,
  resolvedCart: { cart_id: "cart_1" },
  paidPreparation: {
    cart_id: "cart_1",
    order_id: null as string | null,
    payment_session_id: "payses_1",
    payment_collection_id: "paycol_1",
    order_input: { email: "buyer@test.com", items: [] },
    expected_reservations: [],
    promotion_ids: ["promo_1"],
    promotion_usage: [{ code: "SALE" }],
  },
  checkedPayment: {
    status: "succeeded",
    operation_id: "op_payment",
    payment: {
      currency_code: "rub",
      captures: [{ id: "capture_1", amount: 1200 }],
    },
  } as any,
  createdOrders: [{ id: "order_1", items: [] }] as any[],
  completedCart: { id: "order_manual" },
  cancellationPreparation: {
    order_id: "order_1",
    already_canceled: false,
    requires_return_request: false,
    is_online: false,
    active_cdek_fulfillment_ids: [] as string[],
    previous_delivery_status: null as string | null,
    line_item_ids: ["line_1"],
    uncaptured_payment_ids: ["payment_1"],
    uncaptured_payments: [{
      payment_id: "payment_1", provider_id: "provider_1", amount: 1200,
      currency_code: "rub",
    }],
    payment_collection_ids: ["paycol_1"],
    has_outstanding_online_refund: false,
  },
  returnRequest: {
    created: true,
    request: { id: "return_1" },
  },
}

const calls = {
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
  emitEvent: jest.fn((input) => input),
  transferCustomer: jest.fn((..._args: unknown[]) => ({ id: "cart_1" })),
  updateCart: jest.fn((..._args: unknown[]) => ({ id: "cart_1" })),
  addShipping: jest.fn((..._args: unknown[]) => ({ id: "cart_1" })),
  confirmInventory: jest.fn((input) => input),
  reserveInventory: jest.fn((..._args: unknown[]) => [{ id: "reservation_1" }]),
  createCollection: jest.fn((..._args: unknown[]) => scenario.createdCollection),
  refreshCollection: jest.fn((..._args: unknown[]) => ({ id: "paycol_1" })),
  createPaymentSession: jest.fn((..._args: unknown[]) => scenario.paymentSession),
  completeCart: jest.fn((..._args: unknown[]) => scenario.completedCart),
  createOrders: jest.fn((..._args: unknown[]) => scenario.createdOrders),
  createLinks: jest.fn((input) => input),
  updateCarts: jest.fn((input) => input),
  updateCartByVersion: jest.fn((id, expectedVersion, data) => ({
    cart: { id, ...data },
    version: expectedVersion + 1,
  })),
  addTransactions: jest.fn((input) => input),
  cancelOrder: jest.fn((..._args: unknown[]) => ({ id: "order_1" })),
  cancelOrders: jest.fn((..._args: unknown[]) => [{ id: "order_1" }]),
  cancelPayments: jest.fn((input) => input),
  deleteReservations: jest.fn((input) => input),
  updateCollections: jest.fn((input) => input),
}

jest.mock("@medusajs/framework/workflows-sdk", () => {
  // createStep/StepResponse нужны потому, что в граф импорта воркфлоу входит
  // catalog-online-payment-runtime, объявляющий шаг на уровне модуля: без них
  // сьют падает ещё на загрузке, до единого теста.
  class StepResponse<T> {
    constructor(readonly output: T) {}
  }

  return {
    createWorkflow: (_name: unknown, builder: (input: any) => any) => {
      const workflow: any = () => workflow
      workflow.run = async ({ input }: { input: unknown }) => {
        const response = builder(input)
        return { result: response.result }
      }
      workflow.runAsStep = ({ input }: { input: unknown }) => builder(input).result
      return workflow
    },
    createStep: (_name: unknown, invoke: (input: any, context: any) => any) => (input: any) => {
      const response = invoke(input, {
        container: {
          resolve: () => ({
            updateCartByVersion: (
              id: string,
              expectedVersion: number,
              data: Record<string, unknown>
            ) => calls.updateCartByVersion(id, expectedVersion, data),
          }),
        },
        context: {},
      })
      return response instanceof StepResponse ? response.output : response
    },
    StepResponse,
    transform: (data: any, mapper: (data: any) => any) => mapper(data),
    when: (_name: string, data: any, predicate: (data: any) => boolean) => ({
      then: (callback: () => any) => predicate(data) ? callback() : undefined,
    }),
    WorkflowResponse: class WorkflowResponse<T> {
      constructor(readonly result: T) {}
    },
  }
})

jest.mock("@medusajs/medusa/core-flows", () => ({
  acquireLockStep: (input: unknown) => calls.acquireLock(input),
  releaseLockStep: (input: unknown) => calls.releaseLock(input),
  emitEventStep: (input: unknown) => {
    const value = calls.emitEvent(input) as Record<string, unknown>
    return { ...value, config() { return this } }
  },
  transferCartCustomerWorkflow: { runAsStep: ({ input }: any) => calls.transferCustomer(input) },
  updateCartWorkflow: { runAsStep: ({ input }: any) => calls.updateCart(input) },
  addShippingMethodToCartWorkflow: { runAsStep: ({ input }: any) => calls.addShipping(input) },
  confirmVariantInventoryWorkflow: { runAsStep: ({ input }: any) => calls.confirmInventory(input) },
  reserveInventoryStep: (input: unknown) => calls.reserveInventory(input),
  createPaymentCollectionForCartWorkflow: { runAsStep: ({ input }: any) => calls.createCollection(input) },
  refreshPaymentCollectionForCartWorkflow: { runAsStep: ({ input }: any) => calls.refreshCollection(input) },
  createPaymentSessionsWorkflow: { runAsStep: ({ input }: any) => calls.createPaymentSession(input) },
  completeCartWorkflow: { runAsStep: ({ input }: any) => calls.completeCart(input) },
  useQueryGraphStep: () => ({
    data: scenario.reservationCart,
    config() { return this },
  }),
  createOrdersStep: (input: unknown) => calls.createOrders(input),
  createRemoteLinkStep: (input: unknown) => calls.createLinks(input),
  updateCartsStep: (input: unknown) => calls.updateCarts(input),
  addOrderTransactionStep: (input: unknown) => {
    calls.addTransactions(input)
    return { config() { return this } }
  },
  cancelOrderWorkflow: { runAsStep: ({ input }: any) => calls.cancelOrder(input) },
  cancelOrdersStep: (input: unknown) => calls.cancelOrders(input),
  cancelPaymentStep: (input: unknown) => calls.cancelPayments(input),
  deleteReservationsByLineItemsStep: (input: unknown) => calls.deleteReservations(input),
  updatePaymentCollectionStep: (input: unknown) => calls.updateCollections(input),
}))

const prepareCatalogOnlinePaymentStep = jest.fn((..._args: unknown[]) => scenario.paymentPreparation)
const validateCatalogCheckoutCartStep = jest.fn((..._args: unknown[]) => scenario.checkoutValidation)
const prepareCatalogCheckoutCartUpdateStep = jest.fn((input) => input)
const prepareCatalogCheckoutShippingOptionsStep = jest.fn((..._args: unknown[]) => scenario.shippingOptions)
const checkCatalogCheckoutShippingProviderVisibilityStep = jest.fn((..._args: unknown[]) => ({ checked: true }))
const retrieveCatalogCartPaymentCollectionStep = jest.fn((..._args: unknown[]) => scenario.existingPaymentCollection)
const prepareCatalogOrderFixationStep = jest.fn((_input: unknown) => ({
  fixation_id: "fixation_1",
  order_id: null as string | null,
}))
const claimCatalogOrderFixationStep = jest.fn((_input: unknown) => ({
  fixation_id: "fixation_1",
}))
const completeCatalogOrderFixationStep = jest.fn((input) => input)
jest.mock("../steps/catalog-order-fixation", () => ({
  prepareCatalogOrderFixationStep: (input: unknown) => prepareCatalogOrderFixationStep(input),
  claimCatalogOrderFixationStep: (input: unknown) => claimCatalogOrderFixationStep(input),
  completeCatalogOrderFixationStep: (input: unknown) => completeCatalogOrderFixationStep(input),
}))
jest.mock("../steps/prepare-catalog-online-payment", () => ({
  prepareCatalogOnlinePaymentStep: (input: unknown) => prepareCatalogOnlinePaymentStep(input),
}))
jest.mock("../steps/catalog-checkout", () => ({
  validateCatalogCheckoutCartStep: (input: unknown) => validateCatalogCheckoutCartStep(input),
  prepareCatalogCheckoutCartUpdateStep: (input: unknown) => prepareCatalogCheckoutCartUpdateStep(input),
  prepareCatalogCheckoutShippingOptionsStep: (input: unknown) => prepareCatalogCheckoutShippingOptionsStep(input),
  checkCatalogCheckoutShippingProviderVisibilityStep: (input: unknown) => checkCatalogCheckoutShippingProviderVisibilityStep(input),
  retrieveCatalogCartPaymentCollectionStep: (input: unknown) => retrieveCatalogCartPaymentCollectionStep(input),
  // Шаг делегирует чистой функции, поэтому подключаем настоящую: иначе тест
  // «падает, если у созданной коллекции нет id» проверял бы копию логики,
  // а не сам бросок из resolveCatalogPaymentCollectionId.
  resolveCatalogPaymentCollectionIdStep: (input: unknown) =>
    jest.requireActual("../steps/catalog-checkout").resolveCatalogPaymentCollectionId(input),
}))

const resolveCatalogPaymentCartStep = jest.fn((..._args: unknown[]) => scenario.resolvedCart)
const prepareCatalogPaidOrderStep = jest.fn((..._args: unknown[]) => scenario.paidPreparation)
const checkCatalogPaymentStatusStep = jest.fn((..._args: unknown[]) => scenario.checkedPayment)
const registerCatalogPromotionUsageStep = jest.fn((input) => input)
const transferCatalogCartReservationsStep = jest.fn((input) => input)
jest.mock("../steps/resolve-catalog-payment-cart", () => ({
  resolveCatalogPaymentCartStep: (input: unknown) => resolveCatalogPaymentCartStep(input),
}))
jest.mock("../steps/prepare-catalog-paid-order", () => ({
  prepareCatalogPaidOrderStep: (input: unknown) => prepareCatalogPaidOrderStep(input),
}))
jest.mock("../steps/check-catalog-payment-status", () => ({
  checkCatalogPaymentStatusStep: (input: unknown) => checkCatalogPaymentStatusStep(input),
}))
jest.mock("../steps/register-catalog-promotion-usage", () => ({
  registerCatalogPromotionUsageStep: (input: unknown) => registerCatalogPromotionUsageStep(input),
}))
jest.mock("../steps/transfer-catalog-cart-reservations", () => ({
  transferCatalogCartReservationsStep: (input: unknown) => transferCatalogCartReservationsStep(input),
}))

const prepareCatalogOrderCancellationStep = jest.fn((..._args: unknown[]) => scenario.cancellationPreparation)
const cancelOrderCdekFulfillmentsStep = jest.fn((input) => input)
const createCatalogShippingReturnRequestStep = jest.fn((..._args: unknown[]) => scenario.returnRequest)
const executeCatalogPaymentCancellationsStep = jest.fn((_input: unknown) => ({
  operation_ids: ["op_cancel"],
}))
const reflectCatalogPaymentOperationStep = jest.fn((input) => input)
const reflectCompletedCatalogPaymentOperationForOrderStep = jest.fn((input) => input)
const reflectCatalogPaymentOperationsStep = jest.fn((input) => input)
jest.mock("../steps/prepare-catalog-order-cancellation", () => ({
  prepareCatalogOrderCancellationStep: (input: unknown) => prepareCatalogOrderCancellationStep(input),
}))
jest.mock("../steps/cancel-order-delivery-fulfillments", () => ({
  cancelOrderCdekFulfillmentsStep: (input: unknown) => cancelOrderCdekFulfillmentsStep(input),
}))
jest.mock("../steps/create-catalog-shipping-return-request", () => ({
  createCatalogShippingReturnRequestStep: (input: unknown) => createCatalogShippingReturnRequestStep(input),
}))
jest.mock("../steps/execute-catalog-payment-cancellations", () => ({
  executeCatalogPaymentCancellationsStep: (input: unknown) => executeCatalogPaymentCancellationsStep(input),
}))
jest.mock("../steps/reflect-catalog-payment-operation", () => ({
  reflectCatalogPaymentOperationStep: (input: unknown) => reflectCatalogPaymentOperationStep(input),
  reflectCompletedCatalogPaymentOperationForOrderStep: (input: unknown) =>
    reflectCompletedCatalogPaymentOperationForOrderStep(input),
  reflectCatalogPaymentOperationsStep: (input: unknown) => reflectCatalogPaymentOperationsStep(input),
}))

import { initiateCatalogOnlinePaymentWorkflow } from "../initiate-catalog-online-payment"
import { finalizeCatalogOnlinePaymentWorkflow } from "../finalize-catalog-online-payment"
import { placeCatalogOrderWorkflow } from "../place-catalog-order"
import {
  CATALOG_CUSTOMER_ORDER_CANCELED,
  CATALOG_ORDER_REFUND_REQUESTED,
  CATALOG_SHIPPING_RETURN_REQUESTED,
  cancelCatalogCustomerOrderWorkflow,
} from "../cancel-catalog-customer-order"

function resetScenario() {
  scenario.paymentPreparation = {
    status: "created",
    order_id: "order_1",
    cart_id: "cart_1",
    payment_operation_id: "operation_1",
    payment_collection_id: "paycol_existing",
    medusa_provider_id: "yookassa_yookassa",
    contacts: {
      email: "buyer@test.com",
      shipping_address: { first_name: "Иван", phone: "+79990000000" },
    },
    existing_payment: null,
    e2e_fail_initiation: false,
  }
  scenario.shippingOptions = { options: [] }
  scenario.existingPaymentCollection = { id: "paycol_existing" }
  scenario.reservationCart = {
    id: "cart_1",
    sales_channel_id: "sc_1",
    items: [{
      id: "line_1",
      variant_id: "variant_1",
      quantity: 2,
      variant: { id: "variant_1", manage_inventory: true },
    }],
  }
  scenario.createdCollection = { id: "paycol_created" }
  scenario.paymentSession = {
    id: "payses_1",
    data: { confirmation: { confirmation_url: "https://pay.test/redirect" } },
  }
  scenario.paidPreparation = {
    cart_id: "cart_1",
    order_id: null,
    payment_session_id: "payses_1",
    payment_collection_id: "paycol_1",
    order_input: { email: "buyer@test.com", items: [] },
    expected_reservations: [],
    promotion_ids: ["promo_1"],
    promotion_usage: [{ code: "SALE" }],
  }
  scenario.checkedPayment = {
    status: "succeeded",
    operation_id: "op_payment",
    payment: { currency_code: "rub", captures: [{ id: "capture_1", amount: 1200 }] },
  }
  scenario.createdOrders = [{ id: "order_1", items: [] }]
  scenario.completedCart = { id: "order_manual" }
  prepareCatalogOrderFixationStep.mockReturnValue({
    fixation_id: "fixation_1",
    order_id: null,
  })
  scenario.cancellationPreparation = {
    order_id: "order_1",
    already_canceled: false,
    requires_return_request: false,
    is_online: false,
    active_cdek_fulfillment_ids: [],
    previous_delivery_status: null,
    line_item_ids: ["line_1"],
    uncaptured_payment_ids: ["payment_1"],
    uncaptured_payments: [{
      payment_id: "payment_1", provider_id: "provider_1", amount: 1200,
      currency_code: "rub",
    }],
    payment_collection_ids: ["paycol_1"],
    has_outstanding_online_refund: false,
  }
  jest.clearAllMocks()
}

beforeEach(resetScenario)

describe("online payment workflow composition", () => {
  it("returns pending reconciliation without creating or exposing a session", async () => {
    scenario.paymentPreparation.status = "pending_reconciliation"
    const { result } = await (initiateCatalogOnlinePaymentWorkflow as any).run({
      input: { order_id: "order_1", provider_id: "yookassa", return_url: "https://shop.test" },
    })
    expect(result).toEqual({ status: "pending_reconciliation" })
    expect(calls.createPaymentSession).not.toHaveBeenCalled()
  })

  it("creates a payment session in the order collection with order contacts", async () => {
    const { result } = await (initiateCatalogOnlinePaymentWorkflow as any).run({
      input: {
        order_id: "order_1",
        provider_id: "yookassa",
        return_url: "https://shop.test/result",
        customer_id: "cus_1",
      },
    })

    expect(result).toEqual({
      status: "created",
      payment_collection_id: "paycol_existing",
      payment_session_id: "payses_1",
      redirect_url: "https://pay.test/redirect",
    })
    expect(prepareCatalogOnlinePaymentStep).toHaveBeenCalledWith({
      order_id: "order_1",
      provider_id: "yookassa",
      customer_id: "cus_1",
    })
    expect(calls.createPaymentSession).toHaveBeenCalledWith({
      payment_collection_id: "paycol_existing",
      provider_id: "yookassa_yookassa",
      customer_id: "cus_1",
      data: {
        cart_id: "cart_1",
        payment_operation_id: "operation_1",
        e2e_fail_initiation: false,
        cart: {
          id: "cart_1",
          email: "buyer@test.com",
          shipping_address: { first_name: "Иван", phone: "+79990000000" },
        },
        confirmation: { type: "redirect", return_url: "https://shop.test/result" },
        description: "Оплата заказа order_1",
      },
    })
    expect(calls.transferCustomer).not.toHaveBeenCalled()
    expect(calls.updateCart).not.toHaveBeenCalled()
    expect(calls.addShipping).not.toHaveBeenCalled()
    expect(calls.confirmInventory).not.toHaveBeenCalled()
    expect(calls.reserveInventory).not.toHaveBeenCalled()
    expect(calls.createCollection).not.toHaveBeenCalled()
    expect(calls.refreshCollection).not.toHaveBeenCalled()
  })

  it("returns an existing YooKassa payment without creating another session", async () => {
    scenario.paymentPreparation.existing_payment = {
      payment_collection_id: "paycol_existing",
      payment_session_id: "payses_existing",
      redirect_url: "https://pay.test/existing",
    }
    scenario.paymentPreparation.status = "active"

    const { result } = await (initiateCatalogOnlinePaymentWorkflow as any).run({
      input: { order_id: "order_1", provider_id: "yookassa", return_url: "https://shop.test" },
    })

    expect(result).toEqual({ status: "active", ...scenario.paymentPreparation.existing_payment })
    expect(calls.createPaymentSession).not.toHaveBeenCalled()
  })

  it("forwards the source cart's E2E failure flag to the payment provider", async () => {
    scenario.paymentPreparation.e2e_fail_initiation = true

    await (initiateCatalogOnlinePaymentWorkflow as any).run({
      input: {
        order_id: "order_1",
        provider_id: "yookassa",
        return_url: "https://shop.test/result",
      },
    })

    expect(calls.createPaymentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ e2e_fail_initiation: true }),
      })
    )
  })

  it.each([
    "Заказ не найден",
    "Платёжная коллекция заказа не найдена",
    "Исходная корзина заказа не найдена",
  ])("does not create a payment session when order resolution fails: %s", async (message) => {
    prepareCatalogOnlinePaymentStep.mockImplementationOnce(() => {
      throw new Error(message)
    })

    await expect((initiateCatalogOnlinePaymentWorkflow as any).run({
      input: {
        order_id: "order_missing",
        provider_id: "yookassa",
        return_url: "https://shop.test/result",
        customer_id: "cus_1",
      },
    })).rejects.toThrow(message)
    expect(calls.createPaymentSession).not.toHaveBeenCalled()
  })
})

describe("payment finalization workflow composition", () => {
  it("returns an existing order without creating a duplicate", async () => {
    scenario.paidPreparation.order_id = "order_existing"
    const { result } = await (finalizeCatalogOnlinePaymentWorkflow as any).run({
      input: { cart_id: "cart_1" },
    })
    expect(result).toEqual({ status: "succeeded", order_id: "order_existing" })
    expect(calls.createOrders).not.toHaveBeenCalled()
    expect(checkCatalogPaymentStatusStep).toHaveBeenCalledWith(expect.objectContaining({
      payment_session_id: "payses_1",
    }))
    expect(calls.addTransactions).toHaveBeenCalledWith([{
      order_id: "order_existing",
      amount: 1200,
      currency_code: "rub",
      reference: "capture",
      reference_id: "capture_1",
    }])
    expect(reflectCompletedCatalogPaymentOperationForOrderStep).toHaveBeenCalledWith({
      cart_id: "cart_1",
      order_id: "order_existing",
    })
  })

  it("does not report an existing order as paid while its provider session is pending", async () => {
    scenario.paidPreparation.order_id = "order_existing"
    scenario.checkedPayment = { status: "pending", payment: null }

    const { result } = await (finalizeCatalogOnlinePaymentWorkflow as any).run({
      input: { cart_id: "cart_1" },
    })

    expect(result).toEqual({ status: "pending", order_id: "order_existing" })
    expect(calls.addTransactions).not.toHaveBeenCalled()
    expect(reflectCompletedCatalogPaymentOperationForOrderStep).not.toHaveBeenCalled()
  })

  it("keeps pending/failed payments orderless", async () => {
    scenario.checkedPayment = { status: "failed" }
    const failed = await (finalizeCatalogOnlinePaymentWorkflow as any).run({
      input: { payment_session_id: "payses_1" },
    })
    expect(failed.result).toEqual({ status: "failed", order_id: null })

    scenario.checkedPayment = { status: "pending", payment: null } as any
    const pending = await (finalizeCatalogOnlinePaymentWorkflow as any).run({
      input: { cart_id: "cart_1" },
    })
    expect(pending.result).toEqual({ status: "pending", order_id: null })
  })

  it("creates one paid order, links promotions and records every capture", async () => {
    const { result } = await (finalizeCatalogOnlinePaymentWorkflow as any).run({
      input: { cart_id: "cart_1", payment_session_id: "payses_1" },
    })
    expect(result).toEqual({ status: "succeeded", order_id: "order_1" })
    expect(calls.createLinks).toHaveBeenCalledWith([
      { order: { order_id: "order_1" }, cart: { cart_id: "cart_1" } },
      { order: { order_id: "order_1" }, payment: { payment_collection_id: "paycol_1" } },
      { order: { order_id: "order_1" }, promotion: { promotion_id: "promo_1" } },
    ])
    expect(calls.addTransactions).toHaveBeenCalledWith([{
      order_id: "order_1",
      amount: 1200,
      currency_code: "rub",
      reference: "capture",
      reference_id: "capture_1",
    }])
    expect(reflectCompletedCatalogPaymentOperationForOrderStep).toHaveBeenCalledWith({
      cart_id: "cart_1",
      order_id: "order_1",
    })
  })
})

describe("manual checkout workflow composition", () => {
  const input = {
    cart_id: "cart_1",
    name: "Иван",
    phone: "+79990000000",
    email: "buyer@test.com",
    city: "Москва",
    comment: "",
  }

  it("uses the system provider with an existing payment collection", async () => {
    scenario.shippingOptions.options = [{ id: "shipping_1" }]
    const { result } = await (placeCatalogOrderWorkflow as any).run({
      input: { ...input, customer_id: "cus_1" },
    })
    expect(result).toEqual({ order_id: "order_manual" })
    expect(calls.transferCustomer).toHaveBeenCalledWith({ id: "cart_1", customer_id: "cus_1" })
    expect(calls.addShipping).toHaveBeenCalledWith({ cart_id: "cart_1", options: [{ id: "shipping_1" }] })
    expect(calls.createCollection).not.toHaveBeenCalled()
    expect(calls.createPaymentSession).toHaveBeenCalledWith({
      payment_collection_id: "paycol_existing",
      provider_id: "pp_system_default",
      data: {},
    })
    expect(calls.completeCart).toHaveBeenCalledWith({ id: "cart_1" })
    expect(calls.acquireLock).toHaveBeenCalledWith({
      key: "cart_1",
      timeout: 30,
      ttl: 120,
    })
    expect(calls.releaseLock).toHaveBeenCalledWith({ key: "cart_1" })
    expect(claimCatalogOrderFixationStep).toHaveBeenCalledWith(
      expect.objectContaining({ cart_id: "cart_1" })
    )
    expect(completeCatalogOrderFixationStep).toHaveBeenCalledWith({
      fixation_id: "fixation_1",
      order_id: "order_manual",
    })
  })

  it("returns the existing order without changing the cart again", async () => {
    prepareCatalogOrderFixationStep.mockReturnValue({
      fixation_id: "fixation_1",
      order_id: "order_existing",
    })

    const { result } = await (placeCatalogOrderWorkflow as any).run({
      input: {
        cart_id: "cart_1",
        name: "Иван",
        phone: "+79990000000",
        email: "buyer@test.com",
        city: "Москва",
        comment: "",
      },
    })

    expect(result).toEqual({ order_id: "order_existing" })
    expect(calls.completeCart).not.toHaveBeenCalled()
    expect(claimCatalogOrderFixationStep).not.toHaveBeenCalled()
    expect(calls.releaseLock).toHaveBeenCalledWith({ key: "cart_1" })
  })

  it("creates a collection for a guest cart and fails if creation has no id", async () => {
    scenario.existingPaymentCollection.id = null
    const created = await (placeCatalogOrderWorkflow as any).run({ input })
    expect(created.result.order_id).toBe("order_manual")
    expect(calls.createCollection).toHaveBeenCalledWith({ cart_id: "cart_1" })
    expect(calls.transferCustomer).not.toHaveBeenCalled()

    scenario.createdCollection = undefined
    await expect((placeCatalogOrderWorkflow as any).run({ input }))
      .rejects.toThrow("Payment collection was not created")
  })
})

describe("customer cancellation workflow composition", () => {
  const input = {
    order_id: "order_1",
    customer_id: "cus_1",
    customer_email: "buyer@test.com",
  }

  it("uses the regular order cancellation path for an unpaid order", async () => {
    const { result } = await (cancelCatalogCustomerOrderWorkflow as any).run({ input })
    expect(result).toEqual({ order_id: "order_1", outcome: "canceled", return_request_id: null })
    expect(calls.cancelOrder).toHaveBeenCalledWith({ order_id: "order_1", canceled_by: "cus_1" })
    expect(calls.emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: CATALOG_CUSTOMER_ORDER_CANCELED,
    }))
  })

  it("cancels online payment state and requests an outstanding refund", async () => {
    Object.assign(scenario.cancellationPreparation, {
      is_online: true,
      has_outstanding_online_refund: true,
      active_cdek_fulfillment_ids: ["ful_cdek"],
    })
    await (cancelCatalogCustomerOrderWorkflow as any).run({ input })
    expect(cancelOrderCdekFulfillmentsStep).toHaveBeenCalledTimes(1)
    expect(cancelOrderCdekFulfillmentsStep).toHaveBeenCalledWith({
      order_id: "order_1",
      fulfillment_ids: ["ful_cdek"],
    })
    expect(calls.deleteReservations).toHaveBeenCalledWith(["line_1"])
    expect(executeCatalogPaymentCancellationsStep).toHaveBeenCalledWith({
      order_id: "order_1",
      payments: scenario.cancellationPreparation.uncaptured_payments,
    })
    expect(reflectCatalogPaymentOperationsStep).toHaveBeenCalledWith({
      operation_ids: ["op_cancel"],
      order_id: "order_1",
    })
    expect(calls.emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: CATALOG_ORDER_REFUND_REQUESTED,
    }))
  })

  it("creates a return request instead of canceling shipment/order state", async () => {
    Object.assign(scenario.cancellationPreparation, {
      requires_return_request: true,
      previous_delivery_status: "in_transit",
      active_cdek_fulfillment_ids: ["ful_cdek"],
    })
    const { result } = await (cancelCatalogCustomerOrderWorkflow as any).run({ input })
    expect(result).toEqual({
      order_id: "order_1",
      outcome: "return_requested",
      return_request_id: "return_1",
    })
    expect(cancelOrderCdekFulfillmentsStep).not.toHaveBeenCalled()
    expect(calls.cancelOrder).not.toHaveBeenCalled()
    expect(calls.emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: CATALOG_SHIPPING_RETURN_REQUESTED,
    }))
  })

  it("is idempotent for an already canceled order", async () => {
    scenario.cancellationPreparation.already_canceled = true
    await (cancelCatalogCustomerOrderWorkflow as any).run({ input })
    expect(calls.cancelOrder).not.toHaveBeenCalled()
    expect(calls.cancelOrders).not.toHaveBeenCalled()
    expect(calls.emitEvent).not.toHaveBeenCalled()
    expect(calls.releaseLock).toHaveBeenCalledWith({ key: "order_1" })
  })
})
