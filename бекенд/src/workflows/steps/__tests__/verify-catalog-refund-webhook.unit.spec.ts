jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (_name: string, invoke: unknown) => invoke,
  StepResponse: class StepResponse<T> {
    constructor(readonly result: T) {}
  },
}))

import { PaymentActions } from "@medusajs/framework/utils"

import { verifyCatalogRefundWebhookStep } from "../verify-catalog-refund-webhook"

const invoke = verifyCatalogRefundWebhookStep as any
const input = {
  provider: "yookassa_yookassa",
  refund_id: "refund-1",
  body: { event: "refund.succeeded", object: { id: "refund-1" } },
  raw_data_base64: Buffer.from("raw bytes").toString("base64"),
  headers: { "content-type": "application/json" },
}

function containerWith(paymentService: Record<string, jest.Mock>) {
  return {
    resolve: jest.fn(() => paymentService),
  }
}

describe("verifyCatalogRefundWebhookStep", () => {
  it("passes through only authenticated refund and parent payment data", async () => {
    const verifiedData = {
      refund_id: "refund-1",
      payment_id: "payment-1",
      amount: "100.00",
      currency_code: "rub",
      payment_session_id: "payses-1",
      payment_data: { id: "payment-1", status: "succeeded" },
    }
    const paymentService = {
      getWebhookActionAndData: jest.fn().mockResolvedValue({
        action: PaymentActions.SUCCESSFUL,
        data: verifiedData,
      }),
    }
    const container = containerWith(paymentService)

    const result = await invoke(input, { container })

    expect(result.result).toEqual(verifiedData)
    expect(paymentService.getWebhookActionAndData).toHaveBeenCalledWith({
      provider: input.provider,
      payload: {
        data: input.body,
        rawData: Buffer.from("raw bytes"),
        headers: input.headers,
      },
    })
  })

  it("rejects mismatched, incomplete, or unauthenticated webhook data", async () => {
    const paymentService = {
      getWebhookActionAndData: jest.fn().mockResolvedValue({
        action: PaymentActions.SUCCESSFUL,
        data: {
          refund_id: "another-refund",
          payment_id: "payment-1",
          amount: "100.00",
          currency_code: "rub",
          payment_session_id: "payses-1",
          payment_data: { id: "payment-1" },
        },
      }),
    }

    await expect(
      invoke(input, { container: containerWith(paymentService) })
    ).rejects.toThrow("could not be verified")
  })
})
