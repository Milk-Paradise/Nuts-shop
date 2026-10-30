import { createHmac, timingSafeEqual } from "node:crypto"

import type { ILockingModule, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"

import {
  CDEK_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../modules/shipping-provider-registry"
import { decryptShippingProviderCredentials } from "../modules/shipping-provider-registry/credentials"
import type { SimplifiedDeliveryStatus } from "../modules/shipping-provider-registry/delivery-core"
import type ShippingProviderRegistryModuleService from "../modules/shipping-provider-registry/service"

export const CDEK_WEBHOOK_SIGNATURE_HEADER = "x-cdek-signature"

type CdekWebhookEvent = {
  type: "ORDER_STATUS" | "PRINT_FORM"
  uuid: string
  date_time: string
  attributes: Record<string, unknown>
}

const PREPARING_CODES = new Set([
  "RECEIVED_AT_SHIPMENT_WAREHOUSE",
  "RETURNED_TO_SENDER_CITY_WAREHOUSE",
  "ACCEPTED_IN_SENDER_CITY",
])
const PLACED_CODES = new Set(["ACCEPTED", "CREATED"])
const DELIVERED_CODES = new Set(["DELIVERED", "POSTOMAT_RECEIVED"])
const CANCELLED_CODES = new Set(["INVALID", "REMOVED"])
const RETURN_CODES = new Set(["NOT_DELIVERED"])

export function cdekWebhookSignature(rawBody: Buffer | string, secret: string) {
  return createHmac("sha256", secret).update(rawBody).digest("hex")
}

export function verifyCdekWebhookSignature(
  rawBody: Buffer | string,
  suppliedSignature: string,
  secret: string
) {
  if (!/^[a-f\d]{64}$/i.test(suppliedSignature)) return false
  const expected = Buffer.from(cdekWebhookSignature(rawBody, secret), "hex")
  const supplied = Buffer.from(suppliedSignature, "hex")
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}

export function parseCdekWebhookEvent(value: unknown): CdekWebhookEvent {
  if (!value || typeof value !== "object") invalidWebhook()
  const event = value as Record<string, unknown>
  if (
    (event.type !== "ORDER_STATUS" && event.type !== "PRINT_FORM") ||
    typeof event.uuid !== "string" ||
    !event.uuid ||
    typeof event.date_time !== "string" ||
    !Number.isFinite(Date.parse(event.date_time)) ||
    !event.attributes ||
    typeof event.attributes !== "object" ||
    Array.isArray(event.attributes)
  ) invalidWebhook()

  return event as CdekWebhookEvent
}

function invalidWebhook(): never {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid CDEK webhook payload")
}

export function mapCdekStatusToSimplified(
  code: string,
  attributes: Record<string, unknown>
): SimplifiedDeliveryStatus | null {
  if (attributes.is_return === true || attributes.is_reverse === true ||
    attributes.is_client_return === true || RETURN_CODES.has(code)) {
    return "return_in_progress"
  }
  if (CANCELLED_CODES.has(code)) return "cancelled"
  if (DELIVERED_CODES.has(code)) return "delivered"
  if (PLACED_CODES.has(code)) return "placed"
  if (PREPARING_CODES.has(code)) return "preparing"

  // Every other documented movement/last-mile code is already past warehouse
  // acceptance. Unknown codes are ignored so a future CDEK addition cannot
  // corrupt the customer-facing state.
  if (/^(READY_|TAKEN_|SENT_|ACCEPTED_AT_|ACCEPTED_IN_|ARRIVED_|POSTOMAT_|IN_CUSTOMS_|CUSTOMS_|PASSED_|SEND_|MET_)/.test(code)) {
    return "in_transit"
  }
  return null
}

const PROGRESS: SimplifiedDeliveryStatus[] = [
  "placed",
  "preparing",
  "in_transit",
  "delivered",
]

export function canApplyCdekStatus(
  currentStatus: SimplifiedDeliveryStatus,
  currentEventAt: Date | string | null,
  nextStatus: SimplifiedDeliveryStatus,
  nextEventAt: Date
) {
  if (currentEventAt && nextEventAt.getTime() <= new Date(currentEventAt).getTime()) return false
  if (currentStatus === "cancelled" || currentStatus === "return_in_progress") return false
  if (nextStatus === "cancelled" || nextStatus === "return_in_progress") return true
  return PROGRESS.indexOf(nextStatus) >= PROGRESS.indexOf(currentStatus)
}

function printFormUuid(attributes: Record<string, unknown>) {
  if (typeof attributes.url !== "string") return null
  return attributes.url.match(/\/print\/(?:barcodes|orders)\/([^/.]+)(?:\.pdf)?(?:\?|$)/)?.[1] ?? null
}

async function findShipment(
  service: ShippingProviderRegistryModuleService,
  event: CdekWebhookEvent
) {
  if (event.type === "ORDER_STATUS") {
    const providerShipmentId = event.attributes.order_uuid
    if (typeof providerShipmentId !== "string" || !providerShipmentId) return null
    const [shipment] = await service.listShippingShipments({
      provider_key: CDEK_PROVIDER_KEY,
      provider_shipment_id: providerShipmentId,
    })
    return shipment ?? null
  }

  const requestUuid = printFormUuid(event.attributes)
  if (!requestUuid) return null
  const [shipment] = await service.listShippingShipments({
    provider_key: CDEK_PROVIDER_KEY,
    label_request_uuid: requestUuid,
  })
  return shipment ?? null
}

export type ProcessCdekWebhookResult = {
  status: "applied" | "ignored" | "duplicate"
  event_uuid: string
}

export async function processCdekWebhook(
  container: MedusaContainer,
  rawBody: Buffer,
  suppliedSignature: string | undefined,
  parsedBody: unknown
): Promise<ProcessCdekWebhookResult> {
  const service = container.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const config = await service.getProviderConfig(CDEK_PROVIDER_KEY)
  if (!config?.encrypted_credentials || !suppliedSignature) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Invalid CDEK webhook signature")
  }
  const { client_secret } = decryptShippingProviderCredentials(config.encrypted_credentials)
  if (!verifyCdekWebhookSignature(rawBody, suppliedSignature, client_secret)) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Invalid CDEK webhook signature")
  }

  const event = parseCdekWebhookEvent(parsedBody)
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  return locking.execute(`cdek-webhook:${event.uuid}`, async () => {
    const [processed] = await service.listShippingWebhookEvents({ event_uuid: event.uuid })
    if (processed) return { status: "duplicate", event_uuid: event.uuid }

    const shipmentIdentity = event.type === "ORDER_STATUS"
      ? event.attributes.order_uuid
      : printFormUuid(event.attributes)
    return locking.execute(
      `cdek-shipment-webhook:${typeof shipmentIdentity === "string" ? shipmentIdentity : event.uuid}`,
      async () => {
        // Events have distinct UUIDs, so the outer lock alone cannot prevent
        // an older and a newer event for the same shipment from racing. This
        // lock serializes their compare-and-update sections.
        const shipment = await findShipment(service, event)
        const [returnRequest] = !shipment && event.type === "ORDER_STATUS" &&
          typeof event.attributes.order_uuid === "string"
          ? await service.listShippingReturnRequests({
              provider_key: CDEK_PROVIDER_KEY,
              return_provider_shipment_id: event.attributes.order_uuid,
            })
          : []
        const orderLockKey = shipment?.order_id ?? returnRequest?.order_id
        return locking.execute(orderLockKey ?? `cdek-unmatched:${event.uuid}`, async () => {
        // The first lookup only resolves the order lock key. Re-read after the
        // order lock is acquired: cancellation may have changed the shipment
        // while this webhook was waiting.
        const lockedShipment = await findShipment(service, event)
        const [lockedReturnRequest] = !lockedShipment && event.type === "ORDER_STATUS" &&
          typeof event.attributes.order_uuid === "string"
          ? await service.listShippingReturnRequests({
              provider_key: CDEK_PROVIDER_KEY,
              return_provider_shipment_id: event.attributes.order_uuid,
            })
          : []
        let applied = false
        if (lockedShipment && event.type === "ORDER_STATUS") {
          const code = event.attributes.code
          const statusAtValue = event.attributes.status_date_time ?? event.date_time
          const statusAt = typeof statusAtValue === "string"
            ? new Date(statusAtValue)
            : new Date(NaN)
          const next = typeof code === "string"
            ? mapCdekStatusToSimplified(code, event.attributes)
            : null
          if (next && Number.isFinite(statusAt.getTime()) && canApplyCdekStatus(
            lockedShipment.simplified_status as SimplifiedDeliveryStatus,
            lockedShipment.status_event_at,
            next,
            statusAt
          )) {
            await service.updateShippingShipments({
              id: lockedShipment.id,
              simplified_status: next,
              status_event_at: statusAt,
              status_event_uuid: event.uuid,
              ...(typeof event.attributes.cdek_number === "string"
                ? { tracking_number: event.attributes.cdek_number }
                : {}),
            })
            applied = true
          }
        } else if (lockedReturnRequest && event.type === "ORDER_STATUS") {
          const code = event.attributes.code
          const statusAtValue = event.attributes.status_date_time ?? event.date_time
          const statusAt = typeof statusAtValue === "string"
            ? new Date(statusAtValue)
            : new Date(NaN)
          const next = typeof code === "string"
            ? mapCdekStatusToSimplified(code, event.attributes)
            : null
          const current = (lockedReturnRequest.return_delivery_status ?? "placed") as SimplifiedDeliveryStatus
          if (next && Number.isFinite(statusAt.getTime()) && canApplyCdekStatus(
            current,
            lockedReturnRequest.return_status_event_at,
            next,
            statusAt
          )) {
            await service.updateShippingReturnRequests({
              id: lockedReturnRequest.id,
              return_delivery_status: next,
              return_status_event_at: statusAt,
              ...(typeof event.attributes.cdek_number === "string"
                ? { return_tracking_number: event.attributes.cdek_number }
                : {}),
            })
            applied = true
          }
        } else if (lockedShipment && event.type === "PRINT_FORM" &&
          typeof event.attributes.url === "string") {
          if (lockedShipment.label_event_uuid !== event.uuid) {
            await service.updateShippingShipments({
              id: lockedShipment.id,
              label_url: event.attributes.url,
              label_event_uuid: event.uuid,
            })
            applied = true
          }
        }

        await service.createShippingWebhookEvents({
          event_uuid: event.uuid,
          provider_key: CDEK_PROVIDER_KEY,
          event_type: event.type,
          event_at: new Date(event.date_time),
          shipment_id: lockedShipment?.id ?? null,
          applied,
        })

        if (!applied) {
          const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
          logger.info(`CDEK webhook ${event.uuid} was accepted without a shipment state change`)
        }
        return { status: applied ? "applied" : "ignored", event_uuid: event.uuid }
        }, { timeout: 15 })
      },
      { timeout: 15 }
    )
  }, { timeout: 15 })
}
