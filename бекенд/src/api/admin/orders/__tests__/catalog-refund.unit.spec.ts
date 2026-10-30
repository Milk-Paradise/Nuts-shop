import {
  catalogRefundAdminState,
  retryCatalogOrderRefund,
} from "../catalog-refund"

function containerWithMetadata(...metadata: Array<Record<string, unknown>>) {
  const retrieveOrder = jest.fn()
  const updateOrders = jest.fn().mockResolvedValue({})

  for (const value of metadata) {
    retrieveOrder.mockResolvedValueOnce({ metadata: value })
  }

  return {
    container: {
      resolve: jest.fn(() => ({ retrieveOrder, updateOrders })),
    } as any,
    retrieveOrder,
    updateOrders,
  }
}

describe("catalog refund admin state", () => {
  it("exposes the provider error to admins", () => {
    expect(
      catalogRefundAdminState({
        catalog_refund_status: "error",
        catalog_refund_error: "provider rate limit",
        catalog_refund_updated_at: "2026-07-13T20:00:00.000Z",
      })
    ).toEqual({
      status: "error",
      error: "provider rate limit",
      updated_at: "2026-07-13T20:00:00.000Z",
    })
  })

  it("retries from an error and returns the cleared successful state", async () => {
    const { container } = containerWithMetadata(
      {
        catalog_refund_status: "error",
        catalog_refund_error: "network timeout",
      },
      {
        catalog_refund_status: "refunded",
        catalog_refund_error: null,
      },
      {
        catalog_refund_status: "refunded",
        catalog_refund_error: null,
      }
    )
    const runRefund = jest.fn().mockResolvedValue(undefined)

    await expect(
      retryCatalogOrderRefund(
        container,
        {
          order_id: "order_test",
          requested_by: "user_admin",
          confirmed: true,
          request_id: "00000000-0000-4000-8000-000000000001",
        },
        runRefund
      )
    ).resolves.toEqual({
      status: "refunded",
      error: null,
      updated_at: null,
    })
    expect(runRefund).toHaveBeenCalledWith(expect.objectContaining({
      order_id: "order_test",
      requested_by: "user_admin",
      refund_request_id: expect.any(String),
    }))
  })

  it("requires confirmation for a first refund", async () => {
    const { container } = containerWithMetadata({})
    const runRefund = jest.fn()

    await expect(
      retryCatalogOrderRefund(
        container,
        {
          order_id: "order_test",
          request_id: "00000000-0000-4000-8000-000000000002",
        },
        runRefund
      )
    ).rejects.toThrow("явное подтверждение")
    expect(runRefund).not.toHaveBeenCalled()
  })

  it("requires explicit confirmation before a refund retry", async () => {
    const { container } = containerWithMetadata({
      catalog_refund_status: "error",
      catalog_refund_error: "network timeout",
    })
    const runRefund = jest.fn()

    await expect(
      retryCatalogOrderRefund(
        container,
        {
          order_id: "order_test",
          request_id: "00000000-0000-4000-8000-000000000003",
        },
        runRefund
      )
    ).rejects.toThrow("явное подтверждение")
    expect(runRefund).not.toHaveBeenCalled()
  })
})
