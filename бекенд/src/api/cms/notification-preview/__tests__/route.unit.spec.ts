import { MedusaError } from "@medusajs/framework/utils"

import { cmsWebhookSignature } from "../../../../lib/cms-snapshot"
import { POST } from "../route"
import { CmsNotificationPreviewSchema } from "../validators"

describe("POST /cms/notification-preview", () => {
  const originalSecret = process.env.STRAPI_WEBHOOK_SECRET

  beforeEach(() => {
    process.env.STRAPI_WEBHOOK_SECRET = "preview-secret"
  })

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.STRAPI_WEBHOOK_SECRET
    else process.env.STRAPI_WEBHOOK_SECRET = originalSecret
  })

  it("rejects an unsigned request", async () => {
    await expect(POST({ headers: {}, body: {} } as never, {} as never))
      .rejects.toMatchObject({ type: MedusaError.Types.UNAUTHORIZED })
  })

  it("rejects an otherwise valid but expired signature", async () => {
    const body = { event: "order-confirmation" }
    const timestamp = String(Date.now() - 5 * 60_000 - 1)
    const signature = cmsWebhookSignature(
      JSON.stringify(body),
      timestamp,
      "preview-secret"
    )
    await expect(POST({
      headers: { "x-cms-timestamp": timestamp, "x-cms-signature": signature },
      body,
    } as never, {} as never)).rejects.toMatchObject({
      type: MedusaError.Types.UNAUTHORIZED,
    })
  })

  it("requires exactly one data source and a +7-compatible SMS test number", () => {
    expect(CmsNotificationPreviewSchema.safeParse({
      event: "order-confirmation",
      channel: "email",
      text: "text",
    }).success).toBe(false)
    expect(CmsNotificationPreviewSchema.safeParse({
      event: "order-confirmation",
      channel: "sms",
      text: "text",
      use_example: true,
      send_test: true,
    }).success).toBe(false)
    expect(CmsNotificationPreviewSchema.safeParse({
      event: "order-confirmation",
      channel: "sms",
      text: "text",
      use_example: true,
      send_test: true,
      phone: "+375291234567",
    }).success).toBe(false)
  })
})
