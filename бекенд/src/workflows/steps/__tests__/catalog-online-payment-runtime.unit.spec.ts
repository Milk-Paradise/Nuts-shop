import {
  buildCatalogOnlinePaymentOutput,
  buildCatalogPaymentReservationInput,
} from "../catalog-online-payment-runtime"
import { resolveCatalogPaymentCollectionId } from "../catalog-checkout"

describe("buildCatalogPaymentReservationInput", () => {
  it("throws the existing error when the payment cart has no sales channel", () => {
    expect(() =>
      buildCatalogPaymentReservationInput({ sales_channel_id: null, items: [] })
    ).toThrow("Payment cart is missing a sales channel")
  })

  it("throws the existing error when a cart item has incomplete inventory data", () => {
    expect(() =>
      buildCatalogPaymentReservationInput({
        sales_channel_id: "sc_1",
        items: [{ id: "item_1", variant_id: null, quantity: 1 }],
      })
    ).toThrow("Payment cart item is missing inventory data")
  })

  it("preserves the valid inventory confirmation DTO", () => {
    const variant = { id: "variant_1", manage_inventory: true }

    expect(
      buildCatalogPaymentReservationInput({
        sales_channel_id: "sc_1",
        items: [
          {
            id: "item_1",
            variant_id: "variant_1",
            quantity: 2,
            variant,
          },
        ],
      })
    ).toEqual({
      sales_channel_id: "sc_1",
      variants: [variant],
      items: [{ id: "item_1", variant_id: "variant_1", quantity: 2 }],
    })
  })
})

describe("online-payment runtime result validation", () => {
  it("throws the existing error when payment collection creation produced no id", () => {
    expect(() =>
      resolveCatalogPaymentCollectionId({
        existing_payment_collection: { id: null },
        created_payment_collection: undefined,
      })
    ).toThrow("Payment collection was not created")
  })

  it("throws the existing error when initial payment has no redirect URL", () => {
    expect(() =>
      buildCatalogOnlinePaymentOutput("pay_col_1", {
        id: "pay_ses_1",
        data: { confirmation: {} },
      })
    ).toThrow("Payment provider did not return a redirect URL")
  })

  it("throws the same existing error when reinitiation has no redirect URL", () => {
    expect(() =>
      buildCatalogOnlinePaymentOutput("pay_col_existing", {
        id: "pay_ses_retry",
        data: {},
      })
    ).toThrow("Payment provider did not return a redirect URL")
  })

  it("preserves the valid payment response", () => {
    expect(
      buildCatalogOnlinePaymentOutput("pay_col_1", {
        id: "pay_ses_1",
        data: {
          confirmation: { confirmation_url: "https://pay.example/redirect" },
        },
      })
    ).toEqual({
      payment_collection_id: "pay_col_1",
      payment_session_id: "pay_ses_1",
      redirect_url: "https://pay.example/redirect",
    })
  })
})
