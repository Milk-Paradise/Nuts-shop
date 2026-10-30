import { MoyskladClient, type MoyskladFetch, type MoyskladFetchResponse } from "../client"
import { encryptMoyskladCredentials } from "../credentials"

function jsonResponse(body: unknown): MoyskladFetchResponse {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }
}

process.env.MOYSKLAD_ENCRYPTION_KEY = "test-moysklad-encryption-key"

describe("MoyskladClient customer order creation", () => {
  const encryptedCredentials = encryptMoyskladCredentials({
    type: "token",
    token: "access-token",
  })

  beforeEach(() => {
    process.env.MOYSKLAD_ENCRYPTION_KEY = "test-moysklad-encryption-key"
  })

  it("returns the only organization found in MoySklad", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue(jsonResponse({ rows: [{ id: "org_1", meta: { href: "href-org" } }] }))
    const client = new MoyskladClient(fetch)

    await expect(client.findDefaultOrganization(encryptedCredentials)).resolves.toEqual({
      id: "org_1",
      meta: { href: "href-org" },
    })
    expect(fetch.mock.calls[0][0]).toBe(
      "https://api.moysklad.ru/api/remap/1.2/entity/organization?limit=1"
    )
  })

  it("throws a clear error when no organization is configured in MoySklad", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue(jsonResponse({ rows: [] }))
    const client = new MoyskladClient(fetch)

    await expect(client.findDefaultOrganization(encryptedCredentials)).rejects.toThrow(
      "В МойСклад не настроено ни одной организации."
    )
  })

  it("finds an existing counterparty by email", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue(jsonResponse({ rows: [{ id: "cp_1", meta: { href: "href-cp" } }] }))
    const client = new MoyskladClient(fetch)

    await expect(
      client.findCounterpartyByEmail(encryptedCredentials, "buyer@example.com")
    ).resolves.toEqual({ id: "cp_1", meta: { href: "href-cp" } })
    expect(fetch.mock.calls[0][0]).toBe(
      "https://api.moysklad.ru/api/remap/1.2/entity/counterparty?filter=email%3Dbuyer%40example.com&limit=1"
    )
  })

  it("returns null when no counterparty matches the email", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue(jsonResponse({ rows: [] }))
    const client = new MoyskladClient(fetch)

    await expect(
      client.findCounterpartyByEmail(encryptedCredentials, "buyer@example.com")
    ).resolves.toBeNull()
  })

  it("creates an individual counterparty with the given contact details", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue(jsonResponse({ id: "cp_2", meta: { href: "href-cp-2" } }))
    const client = new MoyskladClient(fetch)

    await client.createCounterparty(encryptedCredentials, {
      name: "Иван Иванов",
      email: "buyer@example.com",
      phone: "+70000000000",
    })

    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        name: "Иван Иванов",
        companyType: "individual",
        email: "buyer@example.com",
        phone: "+70000000000",
      }),
    })
  })

  it("finds products in MoySklad matching a Medusa SKU via the code filter", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue(jsonResponse({ rows: [{ id: "prod_1", meta: { href: "href-prod" } }] }))
    const client = new MoyskladClient(fetch)

    await expect(client.findProductsBySku(encryptedCredentials, "SKU-1")).resolves.toEqual([
      { id: "prod_1", meta: { href: "href-prod" } },
    ])
    expect(fetch.mock.calls[0][0]).toBe(
      "https://api.moysklad.ru/api/remap/1.2/entity/product?filter=code%3DSKU-1&limit=2"
    )
  })

  it("returns every match for an ambiguous SKU instead of picking one", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue(
        jsonResponse({
          rows: [
            { id: "prod_1", meta: { href: "href-1" } },
            { id: "prod_2", meta: { href: "href-2" } },
          ],
        })
      )
    const client = new MoyskladClient(fetch)

    await expect(client.findProductsBySku(encryptedCredentials, "SKU-1")).resolves.toHaveLength(2)
  })

  it("sends the customer order with organization/agent/assortment meta references and price converted to kopecks", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue(jsonResponse({ id: "ms_order_1", meta: { href: "href-order" } }))
    const client = new MoyskladClient(fetch)

    await client.createCustomerOrder(encryptedCredentials, {
      organizationHref: "href-org",
      agentHref: "href-cp",
      description: "Заказ Medusa order_1",
      positions: [{ assortmentHref: "href-prod", quantity: 2, priceRubles: 500 }],
    })

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe("https://api.moysklad.ru/api/remap/1.2/entity/customerorder")
    expect(JSON.parse(init.body as string)).toEqual({
      organization: { meta: { href: "href-org", type: "organization", mediaType: "application/json" } },
      agent: { meta: { href: "href-cp", type: "counterparty", mediaType: "application/json" } },
      description: "Заказ Medusa order_1",
      positions: [
        {
          quantity: 2,
          assortment: { meta: { href: "href-prod", type: "product", mediaType: "application/json" } },
          price: 50000,
        },
      ],
    })
  })

  it("omits the price field for a position without a unit price", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue(jsonResponse({ id: "ms_order_1", meta: { href: "href-order" } }))
    const client = new MoyskladClient(fetch)

    await client.createCustomerOrder(encryptedCredentials, {
      organizationHref: "href-org",
      agentHref: "href-cp",
      positions: [{ assortmentHref: "href-prod", quantity: 1 }],
    })

    const body = JSON.parse(fetch.mock.calls[0][1].body as string)
    expect(body.positions[0]).toEqual({
      quantity: 1,
      assortment: { meta: { href: "href-prod", type: "product", mediaType: "application/json" } },
    })
  })

  it("rejects a successful order response without a document id", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue(jsonResponse({ meta: { href: "href-order" } }))
    const client = new MoyskladClient(fetch, {
      throttle: jest.fn().mockResolvedValue(undefined),
    })

    await expect(
      client.createCustomerOrder(encryptedCredentials, {
        organizationHref: "href-org",
        agentHref: "href-cp",
        positions: [{ assortmentHref: "href-prod", quantity: 1 }],
      })
    ).rejects.toThrow("не вернул идентификатор созданного заказа")
  })

  it("sends a PUT with the new description to mark the existing order cancelled", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue(jsonResponse({ id: "ms_order_1", meta: { href: "href-order" } }))
    const client = new MoyskladClient(fetch)

    await client.markCustomerOrderCancelled(
      encryptedCredentials,
      "ms_order_1",
      "Заказ Medusa order_1 — ОТМЕНЁН"
    )

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe("https://api.moysklad.ru/api/remap/1.2/entity/customerorder/ms_order_1")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body as string)).toEqual({
      description: "Заказ Medusa order_1 — ОТМЕНЁН",
    })
  })

  it("surfaces the MoySklad error text when creating the order fails", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => "Не найдена организация",
      })
    const client = new MoyskladClient(fetch)

    await expect(
      client.createCustomerOrder(encryptedCredentials, {
        organizationHref: "href-org",
        agentHref: "href-cp",
        positions: [],
      })
    ).rejects.toMatchObject({ message: "Не найдена организация", status: 400 })
  })

  it("creates an incoming payment linked to the customer order in the matching currency", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValueOnce(jsonResponse({ organization: { meta: { href: "href-org", type: "organization", mediaType: "application/json" } }, agent: { meta: { href: "href-agent", type: "counterparty", mediaType: "application/json" } } }))
      .mockResolvedValueOnce(jsonResponse({ rows: [{ meta: { href: "href-rub" } }] }))
      .mockResolvedValueOnce(jsonResponse({ id: "ms_payment_1", meta: { href: "href-payment" } }))
    const client = new MoyskladClient(fetch)

    await client.createIncomingPayment(encryptedCredentials, {
      externalCode: "medusa-payment-order_1", customerOrderId: "ms_order_1",
      amount: 123.45, currencyCode: "rub", paidAt: new Date("2026-09-10T10:30:00.000Z")
    })

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/ms_order_1",
      "https://api.moysklad.ru/api/remap/1.2/entity/currency?filter=isoCode%3DRUB&limit=2",
      "https://api.moysklad.ru/api/remap/1.2/entity/paymentin"
    ])
    expect(JSON.parse(fetch.mock.calls[2][1].body as string)).toEqual({
      externalCode: "medusa-payment-order_1",
      moment: "2026-09-10 13:30:00.000",
      organization: { meta: { href: "href-org", type: "organization", mediaType: "application/json" } },
      agent: { meta: { href: "href-agent", type: "counterparty", mediaType: "application/json" } },
      sum: 12345,
      rate: { currency: { meta: { href: "href-rub", type: "currency", mediaType: "application/json" } } },
      operations: [{ meta: { href: "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/ms_order_1", type: "customerorder", mediaType: "application/json" }, linkedSum: 12345 }]
    })
  })

  it("reuses a demand found by the stable external code", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue(jsonResponse({ rows: [{ id: "demand_1", meta: { href: "href-demand" } }] }))
    const client = new MoyskladClient(fetch)

    await expect(client.findDemandByExternalCode(encryptedCredentials, "medusa-fulfillment-order_1"))
      .resolves.toEqual({ id: "demand_1", meta: { href: "href-demand" } })
    expect(fetch.mock.calls[0][0]).toBe(
      "https://api.moysklad.ru/api/remap/1.2/entity/demand?filter=externalCode%3Dmedusa-fulfillment-order_1&limit=2"
    )
  })

  it("creates a demand linked to the customer order and copies its positions", async () => {
    const fetch = jest.fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValueOnce(jsonResponse({
        meta: { href: "href-order" },
        organization: { meta: { href: "href-org", type: "organization", mediaType: "application/json" } },
        agent: { meta: { href: "href-agent", type: "counterparty", mediaType: "application/json" } },
        positions: [{ quantity: 2, price: 50000, assortment: { meta: { href: "href-product", type: "product", mediaType: "application/json" } } }],
      }))
      .mockResolvedValueOnce(jsonResponse({ id: "demand_1", meta: { href: "href-demand" } }))
    const client = new MoyskladClient(fetch)

    await client.createCustomerOrderDemand(encryptedCredentials, {
      customerOrderId: "ms_order_1",
      externalCode: "medusa-fulfillment-order_1",
    })

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.moysklad.ru/api/remap/1.2/entity/customerorder/ms_order_1?expand=positions",
      "https://api.moysklad.ru/api/remap/1.2/entity/demand",
    ])
    expect(JSON.parse(fetch.mock.calls[1][1].body as string)).toEqual({
      externalCode: "medusa-fulfillment-order_1",
      organization: { meta: { href: "href-org", type: "organization", mediaType: "application/json" } },
      agent: { meta: { href: "href-agent", type: "counterparty", mediaType: "application/json" } },
      customerOrder: { meta: { href: "href-order", type: "customerorder", mediaType: "application/json" } },
      positions: [{
        quantity: 2,
        price: 50000,
        assortment: { meta: { href: "href-product", type: "product", mediaType: "application/json" } },
      }],
    })
  })
})
