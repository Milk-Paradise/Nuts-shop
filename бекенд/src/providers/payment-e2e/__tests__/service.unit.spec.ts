import E2EPaymentProviderService from "../service"

describe("E2EPaymentProviderService", () => {
  afterEach(() => jest.restoreAllMocks())

  it("fails initiation from one cart's data without affecting another cart", async () => {
    const provider = new E2EPaymentProviderService({}, { base_url: "http://stub.test" })
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ confirmation_url: "http://stub.test/payments/good/page" }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    )

    await expect(provider.initiatePayment({
      amount: 100,
      currency_code: "rub",
      data: { cart_id: "cart_bad", e2e_fail_initiation: true },
    })).rejects.toThrow("Корзина сохранена")

    await expect(provider.initiatePayment({
      amount: 100,
      currency_code: "rub",
      data: {
        cart_id: "cart_good",
        e2e_fail_initiation: false,
        confirmation: { return_url: "http://store.test/payment-result" },
      },
    })).resolves.toMatchObject({
      status: "pending",
      data: {
        amount: { value: "100", currency: "rub" },
        confirmation: {
          confirmation_url: "http://stub.test/payments/good/page",
        },
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("reports captured only after the payment stub confirms it", async () => {
    const provider = new E2EPaymentProviderService({}, { base_url: "http://stub.test" })
    jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "pending" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "captured" }), { status: 200 }))
    const input = {
      data: {
        id: "e2e_pay_1",
        amount: { value: "100", currency: "rub" },
      },
    }

    await expect(provider.getPaymentStatus(input)).resolves.toMatchObject({ status: "pending" })
    await expect(provider.getPaymentStatus(input)).resolves.toMatchObject({ status: "captured" })
  })
})
