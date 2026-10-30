import { CdekClient } from "../cdek-client"

const credentials = {
  client_id: "client-id-must-not-leak",
  client_secret: "client-secret-must-not-leak",
}

const input = {
  contract_type: "online_store" as const,
  sender: { city: "Москва", postal_code: "101000" },
  package: {
    weight_grams: 1200,
    length_mm: 300,
    width_mm: 200,
    height_mm: 150,
  },
}

describe("CdekClient tariff list", () => {
  it("authorizes and returns only tariff code and name", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "access-token" }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tariff_codes: [
              {
                tariff_code: 136,
                tariff_name: "Посылка склад — склад",
                delivery_sum: 999,
              },
            ],
          }),
          { status: 200 }
        )
      )

    const tariffs = await new CdekClient("https://cdek.test/v2", fetcher).listAvailableTariffs(
      credentials,
      input
    )

    expect(tariffs).toEqual([
      { code: 136, name: "Посылка склад — склад" },
    ])
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://cdek.test/v2/calculator/tarifflist",
      expect.objectContaining({ method: "POST" })
    )
    expect(JSON.stringify(tariffs)).not.toContain(credentials.client_id)
    expect(JSON.stringify(tariffs)).not.toContain(credentials.client_secret)
  })

  it("distinguishes a missing tariff response from an empty contract", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "access-token" }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))

    await expect(
      new CdekClient("https://cdek.test/v2", fetcher).listAvailableTariffs(
        credentials,
        input
      )
    ).rejects.toEqual(
      expect.objectContaining({
        message:
          "Авторизация прошла, но ответ СДЭК не содержит список тарифов. Повторите попытку.",
      })
    )
  })
})

describe("CdekClient calculation and pickup points", () => {
  it("normalizes selected real-time tariffs and ignores unselected delivery modes", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tariff_codes: [
          { tariff_code: 136, tariff_name: "ПВЗ", tariff_description: "desc", delivery_mode: 2, delivery_sum: 450, period_min: 2, period_max: 4 },
          { tariff_code: 137, tariff_name: "Курьер", delivery_mode: 1, delivery_sum: 600, period_min: 1, period_max: 3 },
        ],
      }), { status: 200 }))

    const result = await new CdekClient("https://cdek.test/v2", fetcher).calculateTariffs(
      credentials,
      { ...input, recipient: { city: "Тула" }, tariff_codes: [136] }
    )

    expect(result).toEqual([expect.objectContaining({ code: 136, delivery_mode: 2, delivery_sum: 450 })])
    const request = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(request.to_location).toEqual({ city: "Тула", country_code: "RU" })
    expect(request.packages).toEqual([{ weight: 1200, length: 30, width: 20, height: 15 }])
  })

  it("uses a CDEK city code instead of a city name when calculating tariffs", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tariff_codes: [
          { tariff_code: 136, tariff_name: "ПВЗ", delivery_mode: 2, delivery_sum: 450, period_min: 2, period_max: 4 },
        ],
      }), { status: 200 }))

    await new CdekClient("https://cdek.test/v2", fetcher).calculateTariffs(
      credentials,
      { ...input, recipient: { city: "Тула", code: 123, postal_code: "300000" }, tariff_codes: [136] }
    )

    const request = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(request.to_location).toEqual({ code: 123, country_code: "RU", postal_code: "300000" })
  })

  it("finds CDEK city candidates with country, city, and optional region", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { code: 44, city: "Москва", country_code: "RU", region: "Москва", region_code: 1 },
        { code: "bad", city: "Некорректный", country_code: "RU", region: "Москва", region_code: 1 },
        { code: 137, city: "Москва", country_code: "RU", region: "Московская область", region_code: 50 },
      ]), { status: 200 }))

    await expect(new CdekClient("https://cdek.test/v2", fetcher).findCities(credentials, {
      country_code: "RU",
      city: "Москва",
      region: "Московская область",
    })).resolves.toEqual([
      { code: 44, city: "Москва", country_code: "RU", region: "Москва", region_code: 1 },
      { code: 137, city: "Москва", country_code: "RU", region: "Московская область", region_code: 50 },
    ])

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://cdek.test/v2/location/cities?country_codes=RU&city=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0&region=%D0%9C%D0%BE%D1%81%D0%BA%D0%BE%D0%B2%D1%81%D0%BA%D0%B0%D1%8F+%D0%BE%D0%B1%D0%BB%D0%B0%D1%81%D1%82%D1%8C",
      expect.objectContaining({ method: "GET" })
    )
  })

  it("returns no candidates for an empty CDEK city result", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))

    await expect(new CdekClient("https://cdek.test/v2", fetcher).findCities(credentials, {
      country_code: "RU",
      city: "Тула",
    })).resolves.toEqual([])
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://cdek.test/v2/location/cities?country_codes=RU&city=%D0%A2%D1%83%D0%BB%D0%B0",
      expect.objectContaining({ method: "GET" })
    )
  })

  it("returns a single valid CDEK city candidate", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { code: 270, city: "Тула", country_code: "RU", region: "Тульская область", region_code: 71 },
      ]), { status: 200 }))

    await expect(new CdekClient("https://cdek.test/v2", fetcher).findCities(credentials, {
      country_code: "RU",
      city: "Тула",
    })).resolves.toEqual([
      { code: 270, city: "Тула", country_code: "RU", region: "Тульская область", region_code: 71 },
    ])
  })

  it.each([new Response("", { status: 200 }), new Response(JSON.stringify({}), { status: 200 })])(
    "turns a malformed CDEK city result into an API error",
    async (response) => {
      const fetcher = jest
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
        .mockResolvedValueOnce(response)

      await expect(new CdekClient("https://cdek.test/v2", fetcher).findCities(credentials, {
        country_code: "RU",
        city: "Тула",
      })).rejects.toMatchObject({ name: "CdekApiError", status: 502 })
    }
  )

  it("normalizes the nested delivery-point location returned by the sandbox", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        code: "MSK1", name: "ПВЗ", type: "PVZ", work_time: "Пн-Вс 10-20",
        location: { city: "Москва", city_code: 44, address: "ул. Тестовая, 1", address_full: "Россия, Москва, ул. Тестовая, 1", latitude: 55.7, longitude: 37.6 },
      }]), { status: 200 }))

    await expect(new CdekClient("https://cdek.test/v2", fetcher).listDeliveryPoints(credentials))
      .resolves.toEqual([expect.objectContaining({ code: "MSK1", location: expect.objectContaining({ latitude: 55.7 }) })])
  })

  it("turns calculator timeouts into an explicit calculation error", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))

    await expect(new CdekClient("https://cdek.test/v2", fetcher).calculateTariffs(
      credentials,
      { ...input, recipient: { city: "Тула" }, tariff_codes: [136] }
    )).rejects.toMatchObject({
      status: 502,
      message: "Не удалось рассчитать доставку СДЭК. Повторите попытку позже.",
    })
  })
})

describe("CdekClient order creation", () => {
  it("registers an order and returns its provider identifiers", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entity: { uuid: "uuid-1", cdek_number: "1234567890" },
        requests: [{ state: "ACCEPTED" }],
      }), { status: 202 }))

    const result = await new CdekClient("https://cdek.test/v2", fetcher).createOrder(
      credentials,
      {
        type: 1,
        number: "order_1",
        tariff_code: 136,
        from_location: { city: "Москва" },
        to_location: { city: "Тула" },
        recipient: { name: "Иван Иванов", phones: [{ number: "+79990000000" }] },
        packages: [{ number: "order-1", weight: 1000, length: 30, width: 20, height: 15 }],
      }
    )

    expect(result).toEqual({ uuid: "uuid-1", cdek_number: "1234567890" })
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://cdek.test/v2/orders",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("surfaces a CDEK validation error without leaking credentials", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        requests: [{ errors: [{ message: "Некорректный тариф" }] }],
      }), { status: 202 }))

    await expect(new CdekClient("https://cdek.test/v2", fetcher).createOrder(
      credentials,
      {
        type: 2,
        number: "order_1",
        tariff_code: 999,
        from_location: { city: "Москва" },
        to_location: { city: "Тула" },
        recipient: { name: "Иван", phones: [{ number: "+79990000000" }] },
        packages: [{ number: "1", weight: 1000, length: 1, width: 1, height: 1 }],
      }
    )).rejects.toMatchObject({ message: "Некорректный тариф" })
  })

  it.each([
    ["malformed JSON", new Response("not-json", { status: 202 })],
    ["a success response without UUID", new Response(JSON.stringify({ entity: {} }), { status: 202 })],
    ["an unstructured server error", new Response(JSON.stringify({}), { status: 500 })],
  ])("marks %s after POST as ambiguous", async (_name, response) => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(response)

    await expect(new CdekClient("https://cdek.test/v2", fetcher).createOrder(
      credentials,
      {
        type: 2, number: "order_1", tariff_code: 136,
        from_location: { city: "Москва" }, to_location: { city: "Тула" },
        recipient: { name: "Иван", phones: [{ number: "+79990000000" }] },
        packages: [{ number: "1", weight: 1000, length: 1, width: 1, height: 1 }],
      }
    )).rejects.toMatchObject({ mayHaveSucceeded: true })
  })
})

describe("CdekClient barcode labels", () => {
  it("requests an A6 barcode and downloads the ready PDF", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entity: { uuid: "print-uuid", url: "https://cdek.test/v2/print/barcodes/print-uuid.pdf" },
      }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(Buffer.from("%PDF-mocked"), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }))
    const client = new CdekClient("https://cdek.test/v2", fetcher)

    await expect(client.requestBarcodeLabel(credentials, "order-uuid"))
      .resolves.toEqual({
        uuid: "print-uuid",
        url: "https://cdek.test/v2/print/barcodes/print-uuid.pdf",
      })
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      orders: [{ order_uuid: "order-uuid" }],
      copy_count: 1,
      format: "A6",
      lang: "RUS",
    })
    await expect(client.downloadBarcodeLabel(credentials, "print-uuid"))
      .resolves.toEqual(Buffer.from("%PDF-mocked"))
  })

  it("returns a clear retry message while the form is not ready", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 202 }))

    await expect(new CdekClient("https://cdek.test/v2", fetcher)
      .downloadBarcodeLabel(credentials, "print-uuid"))
      .rejects.toMatchObject({
        status: 409,
        message: "Этикетка ещё не готова у СДЭК. Подождите минуту и повторите попытку.",
      })
  })
})

describe("CdekClient order confirmation", () => {
  const auth = () =>
    new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 })

  it("rejects an order CDEK validated as invalid, quoting its reason", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(auth())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entity: { uuid: "uuid-1", cdek_number: null },
            requests: [
              {
                type: "CREATE",
                state: "INVALID",
                errors: [{ code: "error_validate_receiver_delivery_point_is_empty", message: "Не указан пункт выдачи" }],
              },
            ],
          }),
          { status: 200 }
        )
      )

    await expect(
      new CdekClient("https://cdek.test/v2", fetcher).confirmOrderCreation(credentials, "uuid-1", 1)
    ).rejects.toThrow("Не указан пункт выдачи")
  })

  it("returns the track number once CDEK accepted the order", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(auth())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entity: { uuid: "uuid-1", cdek_number: "1234567890" },
            requests: [{ type: "CREATE", state: "SUCCESSFUL" }],
          }),
          { status: 200 }
        )
      )

    await expect(
      new CdekClient("https://cdek.test/v2", fetcher).confirmOrderCreation(credentials, "uuid-1", 1)
    ).resolves.toEqual({ uuid: "uuid-1", cdek_number: "1234567890" })
  })

  it("keeps a still-pending order without a verdict instead of failing it", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(auth())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entity: { uuid: "uuid-1", cdek_number: null },
            requests: [{ type: "CREATE", state: "ACCEPTED" }],
          }),
          { status: 200 }
        )
      )

    await expect(
      new CdekClient("https://cdek.test/v2", fetcher).confirmOrderCreation(credentials, "uuid-1", 1)
    ).resolves.toEqual({ uuid: "uuid-1", cdek_number: null })
  })
})

describe("CdekClient failure and idempotency boundaries", () => {
  const auth = (body: unknown = { access_token: "token" }, status = 200) =>
    new Response(JSON.stringify(body), { status })

  it.each([
    [jest.fn().mockRejectedValue(new Error("offline")), 502, "временно недоступен"],
    [jest.fn().mockResolvedValue(auth({}, 401)), 400, "client_id"],
    [jest.fn().mockResolvedValue(auth({}, 500)), 502, "Не удалось проверить"],
  ])("maps authorization failure", async (fetcher, status, message) => {
    await expect(new CdekClient("https://cdek.test", fetcher as any).testAuthorization(credentials))
      .rejects.toMatchObject({ status, message: expect.stringContaining(message) })
  })

  it("rejects authorization responses without a token", async () => {
    await expect(new CdekClient("https://cdek.test", jest.fn().mockResolvedValue(auth({}))).testAuthorization(credentials))
      .rejects.toThrow("did not contain")
  })

  it.each([
    [new Error("timeout"), "не вернул список тарифов"],
    [new Response("{}", { status: 500 }), "не вернул список тарифов"],
    [new Response(JSON.stringify({ tariff_codes: [null, {}, { tariff_code: 1, tariff_name: " " }] }), { status: 200 }), "не вернул доступные тарифы"],
  ])("rejects unusable tariff-list results", async (result, message) => {
    const fetcher = jest.fn().mockResolvedValueOnce(auth())
    if (result instanceof Error) fetcher.mockRejectedValueOnce(result)
    else fetcher.mockResolvedValueOnce(result)
    await expect(new CdekClient("https://cdek.test", fetcher).listAvailableTariffs(credentials, { ...input, contract_type: "delivery" }))
      .rejects.toThrow(message)
  })

  it("rejects malformed and unsuccessful calculation responses", async () => {
    for (const response of [
      new Response(JSON.stringify({ tariff_codes: [] }), { status: 500 }),
      new Response(JSON.stringify({}), { status: 200 }),
    ]) {
      const fetcher = jest.fn().mockResolvedValueOnce(auth()).mockResolvedValueOnce(response)
      await expect(new CdekClient("https://cdek.test", fetcher).calculateTariffs(credentials, { ...input, recipient: { city: "Тула", postal_code: "300000" }, tariff_codes: [1] })).rejects.toMatchObject({ status: 502 })
    }
  })

  it("filters malformed calculated tariffs and optional delivery-point fields", async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(auth())
      .mockResolvedValueOnce(new Response(JSON.stringify({ tariff_codes: [null, {}, { tariff_code: 1, tariff_name: "A", delivery_mode: 1, delivery_sum: 2, period_min: 1, period_max: 2 }] }), { status: 200 }))
      .mockResolvedValueOnce(auth())
      .mockResolvedValueOnce(new Response(JSON.stringify([null, {}, { code: "P", name: "Point", type: "PVZ", location: { city: "M", address: "A" } }, { code: "bad", name: "Bad", type: "PVZ", location: {} }]), { status: 200 }))
    const client = new CdekClient("https://cdek.test", fetcher)
    await expect(client.calculateTariffs(credentials, { ...input, recipient: { city: "Тула" }, tariff_codes: [1] })).resolves.toEqual([expect.objectContaining({ code: 1, description: null })])
    await expect(client.listDeliveryPoints(credentials)).resolves.toEqual([
      expect.objectContaining({ code: "P", work_time: null, location: expect.objectContaining({ city_code: null, address_full: null, latitude: null, longitude: null }) }),
    ])
  })

  it("rejects malformed delivery point responses", async () => {
    for (const response of [new Response("{}", { status: 500 }), new Response("{}", { status: 200 })]) {
      const fetcher = jest.fn().mockResolvedValueOnce(auth()).mockResolvedValueOnce(response)
      await expect(new CdekClient("https://cdek.test", fetcher).listDeliveryPoints(credentials)).rejects.toThrow("Не удалось обновить")
    }
  })

  it("finds existing orders and treats 404 or missing UUID as absent", async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response(JSON.stringify({ entity: {} }), { status: 200 }))
      .mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response(JSON.stringify({ entity: { uuid: "u", cdek_number: null } }), { status: 200 }))
    const client = new CdekClient("https://cdek.test", fetcher)
    await expect(client.findOrderByNumber(credentials, "order/1")).resolves.toBeNull()
    await expect(client.findOrderByNumber(credentials, "order/1")).resolves.toBeNull()
    await expect(client.findOrderByNumber(credentials, "order/1")).resolves.toEqual({ uuid: "u", cdek_number: null })
  })

  it("rejects failed existing-order lookup", async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }))
    await expect(new CdekClient("https://cdek.test", fetcher).findOrderByNumber(credentials, "order")).rejects.toThrow("проверить существующую")
  })

  it("deletes an order idempotently and surfaces provider rejection", async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response(JSON.stringify({ requests: [{ errors: [{ message: "cannot delete" }] }] }), { status: 200 }))
      .mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    const client = new CdekClient("https://cdek.test", fetcher)
    await expect(client.deleteOrder(credentials, "uuid")).resolves.toBeUndefined()
    await expect(client.deleteOrder(credentials, "uuid")).rejects.toThrow("cannot delete")
    await expect(client.deleteOrder(credentials, "uuid")).resolves.toBeUndefined()
  })

  it("validates barcode request and PDF response", async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response(JSON.stringify({ requests: [{ errors: [{ message: "bad label" }] }] }), { status: 200 }))
      .mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response(JSON.stringify({ entity: {} }), { status: 200 }))
      .mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response("not pdf", { status: 200, headers: { "content-type": "text/plain" } }))
      .mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response("error", { status: 500 }))
    const client = new CdekClient("https://cdek.test", fetcher)
    await expect(client.requestBarcodeLabel(credentials, "uuid")).rejects.toThrow("bad label")
    await expect(client.requestBarcodeLabel(credentials, "uuid")).rejects.toThrow("идентификатор")
    await expect(client.downloadBarcodeLabel(credentials, "print")).rejects.toMatchObject({ status: 409 })
    await expect(client.downloadBarcodeLabel(credentials, "print")).rejects.toMatchObject({ status: 502 })
  })
})
