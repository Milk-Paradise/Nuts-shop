import type { ILockingModule, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"

import { OZON_PROVIDER_KEY, SHIPPING_PROVIDER_REGISTRY_MODULE } from "../modules/shipping-provider-registry"
import { decryptShippingProviderCredentials } from "../modules/shipping-provider-registry/credentials"
import type { SimplifiedDeliveryStatus } from "../modules/shipping-provider-registry/delivery-core"
import type ShippingProviderRegistryModuleService from "../modules/shipping-provider-registry/service"

export const OZON_WEBHOOK_SIGNATURE_HEADER = "x-ozon-signature"

type OzonWebhookEvent = {
  event_id: string
  event_type: string
  shipment_id: string
  status?: string
  event_at: string
  tracking_number?: string
}

const STATUS_MAP: Record<string, SimplifiedDeliveryStatus> = {
  created: "placed", accepted: "preparing", processing: "preparing", in_transit: "in_transit",
  delivered: "delivered", cancelled: "cancelled", returned: "return_in_progress",
}
const PROGRESS: SimplifiedDeliveryStatus[] = ["placed", "preparing", "in_transit", "delivered"]

export function parseOzonWebhookEvent(value: unknown): OzonWebhookEvent {
  if (!value || typeof value !== "object") invalidWebhook()
  const event = value as Record<string, unknown>
  if (typeof event.event_id !== "string" || !event.event_id ||
      typeof event.event_type !== "string" || !event.event_type ||
      typeof event.shipment_id !== "string" || !event.shipment_id ||
      typeof event.event_at !== "string" || !Number.isFinite(Date.parse(event.event_at))) invalidWebhook()
  return event as OzonWebhookEvent
}

function invalidWebhook(): never {
  throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid Ozon webhook payload")
}

export function mapOzonStatus(status?: string) {
  return status ? STATUS_MAP[status.toLowerCase()] ?? null : null
}

function canApply(current: SimplifiedDeliveryStatus, currentAt: Date | string | null, next: SimplifiedDeliveryStatus, nextAt: Date) {
  if (currentAt && nextAt.getTime() <= new Date(currentAt).getTime()) return false
  if (current === "cancelled" || current === "return_in_progress") return false
  if (next === "cancelled" || next === "return_in_progress") return true
  return PROGRESS.indexOf(next) >= PROGRESS.indexOf(current)
}

export type ProcessOzonWebhookResult = { status: "applied" | "ignored" | "duplicate"; event_id: string }

export async function processOzonWebhook(
  container: MedusaContainer,
  rawBody: Buffer,
  headers: Headers | Record<string, string | string[] | undefined>,
  parsedBody: unknown
): Promise<ProcessOzonWebhookResult> {
  const service = container.resolve<ShippingProviderRegistryModuleService>(SHIPPING_PROVIDER_REGISTRY_MODULE)
  const config = await service.getProviderConfig(OZON_PROVIDER_KEY)
  if (!config?.encrypted_credentials) throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Invalid Ozon webhook signature")
  const { client_secret } = decryptShippingProviderCredentials(config.encrypted_credentials)
  const supplied = headers instanceof Headers ? headers.get(OZON_WEBHOOK_SIGNATURE_HEADER) : headers[OZON_WEBHOOK_SIGNATURE_HEADER]
  const signature = Array.isArray(supplied) ? supplied[0] : supplied
  if (!signature || !(await service.verifyOzonWebhookSignature(rawBody, headers, client_secret))) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Invalid Ozon webhook signature")
  }
  const event = parseOzonWebhookEvent(parsedBody)
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  return locking.execute(`ozon-webhook:${event.event_id}`, async () => {
    const [processed] = await service.listShippingWebhookEvents({ event_uuid: event.event_id })
    if (processed) return { status: "duplicate", event_id: event.event_id }
    const [shipment] = await service.listShippingShipments({ provider_key: OZON_PROVIDER_KEY, provider_shipment_id: event.shipment_id })
    const next = mapOzonStatus(event.status)
    const eventAt = new Date(event.event_at)
    const applied = !!shipment && !!next && canApply(shipment.simplified_status as SimplifiedDeliveryStatus, shipment.status_event_at, next, eventAt)
    if (applied) {
      await service.updateShippingShipments({ id: shipment.id, simplified_status: next, status_event_at: eventAt, status_event_uuid: event.event_id, ...(event.tracking_number ? { tracking_number: event.tracking_number } : {}) })
    }
    await service.createShippingWebhookEvents({ event_uuid: event.event_id, provider_key: OZON_PROVIDER_KEY, event_type: event.event_type, event_at: eventAt, shipment_id: shipment?.id ?? null, applied })
    if (!applied) container.resolve(ContainerRegistrationKeys.LOGGER).info(`Ozon webhook ${event.event_id} was accepted without a shipment state change`)
    return { status: applied ? "applied" : "ignored", event_id: event.event_id }
  }, { timeout: 15 })
}
