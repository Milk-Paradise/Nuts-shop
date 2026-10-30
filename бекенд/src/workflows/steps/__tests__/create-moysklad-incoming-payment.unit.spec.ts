import { createMoyskladIncomingPayment, moyskladPaymentExternalCode } from "../create-moysklad-incoming-payment"

function setup(syncOverrides: Record<string, unknown> = {}) {
  let sync = { id: "sync_1", order_id: "order_1", status: "synced", moysklad_order_id: "ms_order_1", payment_status: "pending", payment_attempts: 0, payment_external_code: "medusa-payment-order_1", moysklad_payment_id: null as string | null | undefined, ...syncOverrides }
  const service = {
    getOrderSyncStatus: jest.fn(async () => sync),
    rememberPayment: jest.fn(),
    getConnectionConfig: jest.fn().mockResolvedValue({ encrypted_credentials: "encrypted" }),
    recordPaymentAttempt: jest.fn(async (input) => { sync = { ...sync, payment_status: input.status, moysklad_payment_id: input.moyskladPaymentId }; return sync })
  }
  const logger = { error: jest.fn() }
  const container = { resolve: jest.fn((key: string) => key === "logger" ? logger : service) }
  const client = {
    findIncomingPaymentByExternalCode: jest.fn().mockResolvedValue(null),
    createIncomingPayment: jest.fn().mockResolvedValue({ id: "ms_payment_1" })
  }
  return { container, service, client }
}

const input = { orderId: "order_1", amount: 125.5, currencyCode: "rub", paidAt: new Date("2026-09-10T10:30:00Z") }
const matchingRemote = { id: "created_despite_lost_response", sum: 12550, moment: "2026-09-10 13:30:00.000", rate: { currency: { isoCode: "RUB" } }, operations: [{ meta: { href: "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/ms_order_1" }, linkedSum: 12550 }] }

describe("createMoyskladIncomingPayment", () => {
  it("creates a linked payment with stable identity, actual amount, currency and capture time", async () => {
    const { container, client } = setup()
    await createMoyskladIncomingPayment(container as never, input, client as never)
    expect(moyskladPaymentExternalCode("order_1")).toBe("medusa-payment-order_1")
    expect(client.findIncomingPaymentByExternalCode).toHaveBeenCalledWith("encrypted", "medusa-payment-order_1")
    expect(client.createIncomingPayment).toHaveBeenCalledWith("encrypted", { externalCode: "medusa-payment-order_1", customerOrderId: "ms_order_1", amount: 125.5, currencyCode: "rub", paidAt: input.paidAt })
  })

  it("never creates an unlinked payment while the customer order is pending", async () => {
    const { container, client } = setup({ status: "pending", moysklad_order_id: null })
    await createMoyskladIncomingPayment(container as never, input, client as never)
    expect(client.findIncomingPaymentByExternalCode).not.toHaveBeenCalled()
    expect(client.createIncomingPayment).not.toHaveBeenCalled()
  })

  it("reconciles a payment after the create response was lost instead of creating a duplicate", async () => {
    const { container, client, service } = setup()
    client.findIncomingPaymentByExternalCode.mockResolvedValue(matchingRemote)
    await createMoyskladIncomingPayment(container as never, input, client as never)
    expect(client.createIncomingPayment).not.toHaveBeenCalled()
    expect(service.recordPaymentAttempt).toHaveBeenCalledWith(expect.objectContaining({ status: "synced", moyskladPaymentId: "created_despite_lost_response" }))
  })

  it("recovers from an actually lost create response on the next attempt", async () => {
    const { container, client } = setup()
    let remotePayment: typeof matchingRemote | null = null
    client.findIncomingPaymentByExternalCode.mockImplementation(async () => remotePayment)
    client.createIncomingPayment.mockImplementationOnce(async () => {
      remotePayment = { ...matchingRemote, id: "created_before_disconnect" }
      throw new Error("connection lost after write")
    })

    await expect(createMoyskladIncomingPayment(container as never, input, client as never)).rejects.toThrow("connection lost")
    await createMoyskladIncomingPayment(container as never, input, client as never)

    expect(client.createIncomingPayment).toHaveBeenCalledTimes(1)
    expect(client.findIncomingPaymentByExternalCode).toHaveBeenCalledTimes(2)
  })

  it("does not create again when local state is already synced", async () => {
    const { container, client } = setup({ payment_status: "synced", moysklad_payment_id: "ms_payment_1" })
    await createMoyskladIncomingPayment(container as never, input, client as never)
    expect(client.findIncomingPaymentByExternalCode).not.toHaveBeenCalled()
    expect(client.createIncomingPayment).not.toHaveBeenCalled()
  })

  it("rejects a conflicting remote document with the same external code", async () => {
    const { container, client, service } = setup()
    client.findIncomingPaymentByExternalCode.mockResolvedValue({ ...matchingRemote, sum: 1 })
    await expect(createMoyskladIncomingPayment(container as never, input, client as never)).rejects.toThrow("не совпадает")
    expect(client.createIncomingPayment).not.toHaveBeenCalled()
    expect(service.recordPaymentAttempt).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }))
  })
})
