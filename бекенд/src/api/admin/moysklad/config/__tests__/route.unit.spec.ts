import { GET } from "../route"

describe("GET /admin/moysklad/config", () => {
  it("never returns the stored credentials in plaintext on read", async () => {
    const getConnectionConfig = jest.fn().mockResolvedValue({
      is_active: true,
      encrypted_credentials: "v1.must-not-be-returned"
    })
    const getConnectionAttentionReason = jest.fn().mockResolvedValue(null)
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })
    const req = {
      scope: {
        resolve: jest.fn().mockReturnValue({
          getConnectionConfig,
          getConnectionAttentionReason
        })
      }
    }

    await GET(req as never, { status } as never)

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({
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
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain("must-not-be-returned")
  })

  it("represents an unset configuration without credentials", async () => {
    const getConnectionConfig = jest.fn().mockResolvedValue(null)
    const getConnectionAttentionReason = jest.fn().mockResolvedValue(null)
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })
    const req = {
      scope: {
        resolve: jest.fn().mockReturnValue({
          getConnectionConfig,
          getConnectionAttentionReason
        })
      }
    }

    await GET(req as never, { status } as never)

    expect(json).toHaveBeenCalledWith({
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

  it("returns a synchronization failure as an attention reason without disabling the integration", async () => {
    const service = {
      getConnectionConfig: jest.fn().mockResolvedValue({ is_active: true }),
      getConnectionAttentionReason: jest.fn().mockResolvedValue("Ошибка аутентификации МойСклад")
    }
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })

    await GET({ scope: { resolve: jest.fn().mockReturnValue(service) } } as never, { status } as never)

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        is_active: true,
        attention_reason: "Ошибка аутентификации МойСклад"
      })
    )
  })
})
