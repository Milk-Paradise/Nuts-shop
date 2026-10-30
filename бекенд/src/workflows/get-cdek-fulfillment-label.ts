import type { ILockingModule, MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

import {
  CDEK_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
  isShippingProviderError,
} from "../modules/shipping-provider-registry"
import { decryptShippingProviderCredentials } from "../modules/shipping-provider-registry/credentials"
import type ShippingProviderRegistryModuleService from "../modules/shipping-provider-registry/service"

const NOT_READY = "Этикетка ещё не готова у СДЭК. Подождите минуту и повторите попытку."

async function confirmLabelReady(
  service: ShippingProviderRegistryModuleService,
  credentials: ReturnType<typeof decryptShippingProviderCredentials>,
  requestUuid: string
): Promise<GetCdekFulfillmentLabelResult> {
  try {
    await service.downloadCdekFulfillmentLabel(credentials, requestUuid)
    return { status: "ready" }
  } catch (error) {
    if (isShippingProviderError(error) && error.status === 409) {
      return { status: "not_ready", message: NOT_READY }
    }
    return { status: "failed", error: error instanceof Error ? error.message : String(error) }
  }
}

export type GetCdekFulfillmentLabelResult =
  | { status: "ready" }
  | { status: "not_ready"; message: string }
  | { status: "skipped"; reason: "shipment_not_created" }
  | { status: "failed"; error: string }

export async function getCdekFulfillmentLabel(
  container: MedusaContainer,
  orderId: string
): Promise<GetCdekFulfillmentLabelResult> {
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  return locking.execute(`cdek-label:${orderId}`, async () => {
    const service = container.resolve<ShippingProviderRegistryModuleService>(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    const [shipment] = await service.listShippingShipments({
      order_id: orderId,
      provider_key: CDEK_PROVIDER_KEY,
      direction: "forward",
    })
    if (!shipment?.provider_shipment_id || shipment.status !== "created") {
      return { status: "skipped", reason: "shipment_not_created" }
    }
    const config = await service.getProviderConfig(CDEK_PROVIDER_KEY)
    if (!config?.encrypted_credentials) {
      return { status: "failed", error: "Конфигурация СДЭК не найдена." }
    }
    const credentials = decryptShippingProviderCredentials(config.encrypted_credentials)
    if (shipment.label_url && shipment.label_request_uuid) {
      return confirmLabelReady(service, credentials, shipment.label_request_uuid)
    }
    if (shipment.label_request_uuid) return { status: "not_ready", message: NOT_READY }
    try {
      const requested = await service.requestCdekFulfillmentLabel(
        credentials,
        shipment.provider_shipment_id
      )
      await service.updateShippingShipments({
        id: shipment.id,
        label_request_uuid: requested.uuid,
        label_url: requested.url,
      })
      return requested.url
        ? confirmLabelReady(service, credentials, requested.uuid)
        : { status: "not_ready", message: NOT_READY }
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }, { timeout: 15 })
}

export async function downloadCdekFulfillmentLabel(
  container: MedusaContainer,
  orderId: string
) {
  const service = container.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const [shipment] = await service.listShippingShipments({
    order_id: orderId,
    provider_key: CDEK_PROVIDER_KEY,
    direction: "forward",
  })
  if (!shipment?.label_request_uuid || !shipment.label_url) {
    throw new Error(NOT_READY)
  }
  const config = await service.getProviderConfig(CDEK_PROVIDER_KEY)
  if (!config?.encrypted_credentials) throw new Error("Конфигурация СДЭК не найдена.")
  return service.downloadCdekFulfillmentLabel(
    decryptShippingProviderCredentials(config.encrypted_credentials),
    shipment.label_request_uuid
  )
}
