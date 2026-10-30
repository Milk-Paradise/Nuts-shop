import { MedusaError } from "@medusajs/framework/utils"

import { CmsTargetsValidateSchema, POST } from "../route"

describe("POST /cms/targets/validate", () => {
  const originalSecret = process.env.STRAPI_WEBHOOK_SECRET

  beforeEach(() => {
    process.env.STRAPI_WEBHOOK_SECRET = "cms-test-secret"
  })

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.STRAPI_WEBHOOK_SECRET
    else process.env.STRAPI_WEBHOOK_SECRET = originalSecret
  })

  it("returns 401 for an invalid secret of a different length", async () => {
    await expect(POST({
      headers: { "x-cms-internal-secret": "wrong" },
    } as never, {} as never)).rejects.toMatchObject({
      type: MedusaError.Types.UNAUTHORIZED,
    })
  })

  it("rejects a non-array targets value so the middleware returns 400", () => {
    expect(CmsTargetsValidateSchema.safeParse({ targets: "prod_1" }).success).toBe(false)
  })

  it("returns 200 for a valid request", async () => {
    const graph = jest.fn().mockResolvedValue({
      data: [{ id: "prod_1", status: "published" }],
    })
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })
    const targets = [{ type: "product" as const, medusaId: "prod_1" }]

    await POST({
      headers: { "x-cms-internal-secret": "cms-test-secret" },
      body: { targets },
      validatedBody: { targets },
      scope: { resolve: jest.fn().mockReturnValue({ graph }) },
    } as never, { status } as never)

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({ valid: ["product:prod_1"] })
  })
})
