import { serializeMoyskladConnectionConfig } from "../serializers"

describe("serializeMoyskladConnectionConfig", () => {
  it("exposes only the configuration status", () => {
    const response = serializeMoyskladConnectionConfig({
      encrypted_credentials: "v1.must-not-be-returned",
      is_active: true
    })

    expect(response).toEqual({
      configured: true,
      is_active: true,
      credentials_status: "configured",
      credentials_attention_reason: null,
      stock_sync_last_error: null,
      stock_sync_last_attempt_at: null,
      stock_sync_last_success_at: null,
      stock_sync_unmatched: [],
      attention_reason: null
    })
    expect(JSON.stringify(response)).not.toContain("must-not-be-returned")
  })

  it("represents an unset configuration without credentials", () => {
    expect(serializeMoyskladConnectionConfig(null)).toEqual({
      configured: false,
      is_active: false,
      credentials_status: "configured",
      credentials_attention_reason: null,
      stock_sync_last_error: null,
      stock_sync_last_attempt_at: null,
      stock_sync_last_success_at: null,
      stock_sync_unmatched: [],
      attention_reason: null
    })
  })

  it("exposes the separate stock-cycle error without exposing credentials", () => {
    expect(
      serializeMoyskladConnectionConfig({
        encrypted_credentials: "v1.secret",
        is_active: true,
        stock_sync_last_error: "МойСклад недоступен",
        stock_sync_last_attempt_at: new Date("2026-08-20T12:00:00.000Z"),
        stock_sync_last_success_at: new Date("2026-08-20T11:55:00.000Z"),
        stock_sync_unmatched: {
          items: [
            {
              source: "medusa_variant",
              source_id: "variant_1",
              code: null,
              sku: "SKU-1",
              name: "Красная краска",
              reason: "missing_moysklad_match"
            }
          ]
        }
      })
    ).toEqual({
      configured: true,
      is_active: true,
      credentials_status: "configured",
      credentials_attention_reason: null,
      stock_sync_last_error: "МойСклад недоступен",
      stock_sync_last_attempt_at: "2026-08-20T12:00:00.000Z",
      stock_sync_last_success_at: "2026-08-20T11:55:00.000Z",
      stock_sync_unmatched: [
        {
          source: "medusa_variant",
          source_id: "variant_1",
          code: null,
          sku: "SKU-1",
          name: "Красная краска",
          reason: "missing_moysklad_match"
        }
      ],
      attention_reason: null
    })
  })

  it("drops malformed diagnostic rows at the API boundary", () => {
    const response = serializeMoyskladConnectionConfig({
      is_active: true,
      stock_sync_unmatched: [
        null,
        { source: "unknown", source_id: "bad", reason: "missing_moysklad_match" },
        { source: "medusa_variant", source_id: "variant_1", reason: "unknown", secret: "must-not-leak" },
        {
          source: "moysklad_product",
          source_id: "product_1",
          code: "CODE-1",
          sku: 123,
          name: "Грунт",
          reason: "ambiguous_moysklad_code",
          secret: "must-not-leak"
        }
      ]
    })

    expect(response.stock_sync_unmatched).toEqual([
      {
        source: "moysklad_product",
        source_id: "product_1",
        code: "CODE-1",
        sku: null,
        name: "Грунт",
        reason: "ambiguous_moysklad_code"
      }
    ])
    expect(JSON.stringify(response)).not.toContain("must-not-leak")
  })

  it("exposes a safe attention reason without exposing credentials", () => {
    const response = serializeMoyskladConnectionConfig(
      { encrypted_credentials: "v1.secret", is_active: true },
      "Ошибка аутентификации МойСклад"
    )

    expect(response.attention_reason).toBe("Ошибка аутентификации МойСклад")
    expect(JSON.stringify(response)).not.toContain("v1.secret")
  })

  it("exposes the re-entry state without exposing the stored secret", () => {
    const response = serializeMoyskladConnectionConfig({
      encrypted_credentials: "v2.secret",
      is_active: true,
      credentials_status: "needs_reentry",
      credentials_attention_reason: "Введите реквизиты МойСклад заново."
    })

    expect(response).toMatchObject({
      credentials_status: "needs_reentry",
      credentials_attention_reason: "Введите реквизиты МойСклад заново."
    })
    expect(JSON.stringify(response)).not.toContain("v2.secret")
  })
})
