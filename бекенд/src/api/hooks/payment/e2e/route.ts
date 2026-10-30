import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { confirmE2EPaymentWorkflow } from "../../../../workflows/confirm-e2e-payment"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (process.env.E2E_RUN !== "true") {
    res.status(404).json({ message: "Not found" })
    return
  }
  if (
    !process.env.E2E_PAYMENT_WEBHOOK_SECRET ||
    req.headers["x-e2e-payment-secret"] !==
      process.env.E2E_PAYMENT_WEBHOOK_SECRET
  ) {
    res.status(404).json({ message: "Not found" })
    return
  }

  const body = req.body as { payment_id?: unknown }
  const { result } = await confirmE2EPaymentWorkflow(req.scope).run({
    input: {
      payment_id: typeof body.payment_id === "string" ? body.payment_id : "",
    },
  })
  res.status(200).json({ received: true, payment: result })
}
