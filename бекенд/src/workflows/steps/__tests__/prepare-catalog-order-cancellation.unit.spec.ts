import { MedusaError } from "@medusajs/framework/utils"
import { prepareCatalogOrderCancellation } from "../prepare-catalog-order-cancellation"

function containerWithOrder(order: unknown, cdekShipment?: unknown) {
  const graph = jest.fn().mockResolvedValue({ data: [order] })
  const resolve = jest.fn((key: string) => key === "shippingProviderRegistry"
    ? { listShippingShipments: jest.fn().mockResolvedValue(cdekShipment ? [cdekShipment] : []) }
    : { graph })

  return { container: { resolve } as any }
}

const baseInput = {
  order_id: "order_1",
  customer_id: "cus_1",
  customer_email: "buyer@test.com",
}

describe("prepareCatalogOrderCancellation", () => {
  it("throws NOT_FOUND when the order doesn't belong to the requesting customer", async () => {
    const { container } = containerWithOrder({
      id: "order_1",
      status: "pending",
      customer: { id: "cus_other" },
      email: "someone-else@test.com",
    })

    await expect(
      prepareCatalogOrderCancellation(container, baseInput)
    ).rejects.toThrow(MedusaError)
  })

  it("allows cancellation when there are no fulfillments", async () => {
    const { container } = containerWithOrder({
      id: "order_1",
      status: "pending",
      customer: { id: "cus_1" },
      items: [{ id: "item_1" }],
      fulfillments: [],
      payment_collections: [],
    })

    await expect(
      prepareCatalogOrderCancellation(container, baseInput)
    ).resolves.toMatchObject({
      already_canceled: false,
    })
  })

  it("blocks cancellation once the order is completed", async () => {
    const { container } = containerWithOrder({
      id: "order_1",
      status: "completed",
      customer: { id: "cus_1" },
      fulfillments: [],
      payment_collections: [],
    })

    await expect(
      prepareCatalogOrderCancellation(container, baseInput)
    ).rejects.toThrow(MedusaError)
  })

  it("blocks cancellation when an active fulfillment belongs to a non-CDEK provider", async () => {
    const { container } = containerWithOrder({
      id: "order_1",
      status: "pending",
      customer: { id: "cus_1" },
      fulfillments: [{ id: "ful_1", provider_id: "manual_manual", canceled_at: null }],
      payment_collections: [],
    })

    await expect(
      prepareCatalogOrderCancellation(container, baseInput)
    ).rejects.toThrow(MedusaError)
  })

  it("routes a CDEK cancellation to one return request after warehouse acceptance", async () => {
    const { container } = containerWithOrder({
      id: "order_1",
      status: "pending",
      customer: { id: "cus_1" },
      fulfillments: [
        { id: "ful_cdek", provider_id: "cdek_cdek", canceled_at: null },
      ],
      payment_collections: [],
    }, {
      order_id: "order_1",
      provider_key: "cdek_cdek",
      simplified_status: "preparing",
    })

    await expect(
      prepareCatalogOrderCancellation(container, baseInput)
    ).resolves.toMatchObject({
      active_cdek_fulfillment_ids: [],
      requires_return_request: true,
      previous_delivery_status: "preparing",
    })
  })

  it("surfaces a placed CDEK fulfillment for provider-agnostic cancellation", async () => {
    const { container } = containerWithOrder({
      id: "order_1",
      status: "pending",
      customer: { id: "cus_1" },
      fulfillments: [
        { id: "ful_cdek", provider_id: "cdek_cdek", canceled_at: null },
      ],
      payment_collections: [],
    }, {
      order_id: "order_1",
      provider_key: "cdek_cdek",
      simplified_status: "placed",
    })

    await expect(
      prepareCatalogOrderCancellation(container, baseInput)
    ).resolves.toMatchObject({
      active_cdek_fulfillment_ids: ["ful_cdek"],
      requires_return_request: false,
    })
  })

  it("treats an already canceled order as idempotent regardless of fulfillments", async () => {
    const { container } = containerWithOrder({
      id: "order_1",
      status: "canceled",
      customer: { id: "cus_1" },
      fulfillments: [{ id: "ful_1", provider_id: "manual_manual", canceled_at: null }],
      payment_collections: [],
    })

    await expect(
      prepareCatalogOrderCancellation(container, baseInput)
    ).resolves.toMatchObject({
      already_canceled: true,
    })
  })

  it("authorizes guest checkout by normalized email and summarizes payment/refund boundaries", async () => {
    const { container } = containerWithOrder({
      id: "order_1",
      status: "pending",
      email: " Buyer@Test.COM ",
      customer: null,
      items: [{ id: "item_1" }, { id: "" }, {}, { id: 42 }],
      fulfillments: [
        { id: "other_1", provider_id: "other_provider", canceled_at: null },
        { id: "", provider_id: "other_provider", canceled_at: null },
        { id: "canceled", provider_id: "manual_manual", canceled_at: "2026-01-01" },
      ],
      payment_collections: [
        {
          id: "pc_1",
          payments: [
            {
              id: "pay_refund_due",
              provider_id: "pp_yookassa_yookassa",
              captures: [{ amount: "100" }, { amount: "invalid" }],
              refunds: [{ amount: 25 }, { amount: undefined }],
            },
            {
              id: "pay_fully_refunded",
              provider_id: "pp_yookassa_yookassa",
              captures: [{ amount: 50 }],
              refunds: [{ amount: 50 }],
            },
            { id: "manual", provider_id: "pp_system_default", captures: null },
            { id: "", provider_id: null, captures: [] },
          ],
        },
        { id: "", payments: null },
        {},
      ],
    })

    await expect(prepareCatalogOrderCancellation(container, {
      ...baseInput,
      customer_id: "different",
      customer_email: "buyer@test.com",
    })).rejects.toThrow(MedusaError)
  })

  it("handles missing optional collections as an offline cancellable order", async () => {
    const { container } = containerWithOrder({
      id: "order_1", status: "pending", customer: { id: "cus_1" },
      items: null, fulfillments: null, payment_collections: null,
    })
    await expect(prepareCatalogOrderCancellation(container, baseInput)).resolves.toEqual({
      order_id: "order_1",
      already_canceled: false,
      is_online: false,
      has_outstanding_online_refund: false,
      line_item_ids: [],
      payment_collection_ids: [],
      uncaptured_payment_ids: [],
      uncaptured_payments: [],
      active_cdek_fulfillment_ids: [],
      requires_return_request: false,
      previous_delivery_status: null,
    })
  })

  it("rejects an absent order and a guest order with blank or non-string emails", async () => {
    for (const order of [undefined, { id: "order_1", email: " " }, { id: "order_1", email: 42 }]) {
      const { container } = containerWithOrder(order)
      await expect(prepareCatalogOrderCancellation(container, {
        ...baseInput, customer_id: "different", customer_email: "buyer@test.com",
      })).rejects.toBeInstanceOf(MedusaError)
    }
  })

})
