import { createHash } from "node:crypto"

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { reconcileCatalogRefundWebhookWorkflow } from "../../../../workflows/reconcile-catalog-refund-webhook"
import { verifyCatalogPaymentWebhookWorkflow } from "../../../../workflows/verify-catalog-payment-webhook"
import {
  isYooKassaWebhookIp,
  resolveYooKassaWebhookSourceIp,
} from "./source-ip"

const MEDUSA_YOOKASSA_PROVIDER = "yookassa_yookassa"
const CATALOG_YOOKASSA_PROVIDER = "yookassa"

type YooKassaWebhookBody = {
  event?: unknown
  object?: {
    id?: unknown
  }
}

function webhookIdentity(body: YooKassaWebhookBody) {
  if (
    typeof body.event !== "string" ||
    !body.event ||
    typeof body.object?.id !== "string" ||
    !body.object.id
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid YooKassa webhook payload"
    )
  }

  return { event: body.event, object_id: body.object.id }
}

function transactionId(event: string, paymentId: string) {
  const digest = createHash("sha256")
    .update(`${event}\u0000${paymentId}`)
    .digest("hex")

  return `catalog-yookassa-webhook-${digest}`
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const sourceIp = resolveYooKassaWebhookSourceIp({
    remoteAddress: req.socket.remoteAddress,
    forwardedFor: req.headers["x-forwarded-for"],
    realIp: req.headers["x-real-ip"],
  })

  if (!isYooKassaWebhookIp(sourceIp)) {
    logger.warn(`YooKassa webhook rejected: untrusted source IP ${sourceIp || "unknown"}`)
    res.status(403).json({ message: "Webhook source is not allowed" })
    return
  }

  let identity: ReturnType<typeof webhookIdentity>

  try {
    identity = webhookIdentity(req.body as YooKassaWebhookBody)
  } catch {
    logger.warn("YooKassa webhook rejected: invalid payload")
    res.status(400).json({ message: "Webhook could not be verified" })
    return
  }

  try {
    const rawData =
      req.rawBody ?? Buffer.from(JSON.stringify(req.body), "utf8")
    const workflowInput = {
      provider: MEDUSA_YOOKASSA_PROVIDER,
      provider_id: CATALOG_YOOKASSA_PROVIDER,
      event: identity.event,
      body: req.body as Record<string, unknown>,
      raw_data_base64: Buffer.from(rawData).toString("base64"),
      headers: req.headers,
    }

    if (identity.event === "refund.succeeded") {
      const { result } = await reconcileCatalogRefundWebhookWorkflow(
        req.scope
      ).run({
        input: { ...workflowInput, refund_id: identity.object_id },
        context: {
          transactionId: transactionId(identity.event, identity.object_id),
        },
      })
      res.status(200).json({ received: true, refund_id: result.refund_id })
      return
    }

    if (!identity.event.startsWith("payment.")) {
      res.status(400).json({ message: "Webhook event is not supported" })
      return
    }

    const { result } = await verifyCatalogPaymentWebhookWorkflow(req.scope).run({
      input: {
        ...workflowInput,
        provider_payment_id: identity.object_id,
      },
      context: {
        transactionId: transactionId(identity.event, identity.object_id),
      },
    })

    res.status(200).json({ received: true, session_id: result.session_id })
  } catch (error) {
    // Stored workflows can deserialize MedusaError into a plain object. The
    // framework marker remains stable across that boundary, unlike instanceof.
    if (
      (error instanceof MedusaError || MedusaError.isMedusaError(error)) &&
      error.type === MedusaError.Types.NOT_ALLOWED
    ) {
      logger.warn(
        `YooKassa webhook rejected: verification failed for ${identity.object_id}`
      )
      res.status(400).json({ message: "Webhook could not be verified" })
      return
    }

    logger.error(
      `YooKassa webhook verification failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    )
    res.status(503).json({ message: "Webhook verification is temporarily unavailable" })
  }
}
