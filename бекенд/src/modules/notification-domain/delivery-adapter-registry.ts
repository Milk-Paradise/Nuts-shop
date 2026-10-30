import { MedusaError } from "@medusajs/framework/utils"

import type {
  DeliveryAdapter,
  NotificationForDelivery,
} from "./delivery-executor"

export type DeliveryChannel = Exclude<NotificationForDelivery["channel"], "none">

const adapters = new Map<DeliveryChannel, DeliveryAdapter>()

export function registerNotificationDeliveryAdapter(
  channel: DeliveryChannel,
  adapter: DeliveryAdapter
) {
  if (adapter.channel !== channel) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Cannot register ${adapter.channel} delivery adapter for ${channel}`
    )
  }
  adapters.set(channel, adapter)
  return () => adapters.delete(channel)
}

export function getNotificationDeliveryAdapter(channel: DeliveryChannel) {
  return adapters.get(channel)
}

export function clearNotificationDeliveryAdapters() {
  adapters.clear()
}
