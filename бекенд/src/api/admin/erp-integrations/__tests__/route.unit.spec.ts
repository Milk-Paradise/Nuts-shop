import { GET } from "../route"

describe("GET /admin/erp-integrations", () => {
  it("returns the active ERP and all registered integrations", async () => {
    const json = jest.fn()
    const service = {
      getActiveIntegration: jest.fn().mockResolvedValue({
        integration_key: "moysklad",
      }),
      listRegisteredIntegrations: jest.fn().mockResolvedValue([
        {
          integration_key: "moysklad",
          display_name: "МойСклад",
          is_active: true,
        },
      ]),
    }

    await GET(
      { scope: { resolve: jest.fn().mockReturnValue(service) } } as never,
      { json } as never
    )

    expect(json).toHaveBeenCalledWith({
      active_integration_key: "moysklad",
      integrations: [
        {
          integration_key: "moysklad",
          display_name: "МойСклад",
          is_active: true,
        },
      ],
    })
  })
})
