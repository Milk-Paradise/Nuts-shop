jest.mock("../../../../../../workflows/set-moysklad-connection-activity", () => ({
  setMoyskladConnectionActivityWorkflow: jest.fn(() => ({
    run: jest.fn().mockResolvedValue({
      result: {
        is_active: false,
        encrypted_credentials: "must-not-be-returned"
      }
    })
  }))
}))

import { POST } from "../route"

describe("POST /admin/moysklad/config/active", () => {
  it("updates only the integration activity and returns the safe status", async () => {
    const getConnectionAttentionReason = jest.fn().mockResolvedValue(null)
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })
    const req = {
      scope: {
        resolve: jest.fn().mockReturnValue({
          getConnectionAttentionReason
        })
      },
      validatedBody: { is_active: false }
    }

    await POST(req as never, { status } as never)

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({
      configured: true,
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
})
