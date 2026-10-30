export const DELIVERY_CAPABILITIES = [
  "quote",
  "pickup_points",
  "forward_shipment",
  "return_shipment",
  "cancel",
  "tracking",
  "label",
  "webhook",
] as const

export type DeliveryCapability = (typeof DELIVERY_CAPABILITIES)[number]
export type DeliveryDirection = "forward" | "return"
export type DeliveryMethodType = "courier" | "pickup_point"
export type SimplifiedDeliveryStatus =
  | "placed"
  | "preparing"
  | "in_transit"
  | "delivered"
  | "cancelled"
  | "return_in_progress"

export type DeliveryPickupPoint = {
  id: string
  name: string
  address: string
}

export type DeliveryOffer = {
  provider_key: string
  method_key: string
  type: DeliveryMethodType
  availability: "available" | "unavailable"
  amount: number | null
  currency_code: string | null
  delivery_days_min: number | null
  delivery_days_max: number | null
  pickup_point: DeliveryPickupPoint | null
  quote_id: string | null
  unavailable_reason: string | null
}

export type DeliveryQuoteCandidate = Omit<DeliveryOffer, "availability" | "unavailable_reason"> & {
  available: boolean
  unavailable_reason?: string | null
}

export type ShipmentRequest = {
  business_action_id: string
  direction: DeliveryDirection
  destination_key: string
  quote_id?: string
}

export type ShipmentResult = {
  provider_shipment_id: string
  tracking_number: string | null
  label_url: string | null
}

export type DeliveryAdapter = {
  provider_key: string
  capabilities: readonly DeliveryCapability[]
  quote?: (request: unknown) => Promise<readonly DeliveryQuoteCandidate[]>
  pickup_points?: (request: unknown) => Promise<readonly DeliveryPickupPoint[]>
  forward_shipment?: (request: ShipmentRequest) => Promise<ShipmentResult>
  return_shipment?: (request: ShipmentRequest) => Promise<ShipmentResult>
  cancel?: (request: unknown) => Promise<void>
  tracking?: (request: unknown) => Promise<unknown>
  label?: (request: unknown) => Promise<unknown>
  webhook?: (request: unknown) => Promise<unknown>
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

export function normalizeDeliveryOffer(candidate: DeliveryQuoteCandidate): DeliveryOffer {
  const identityIsValid = nonEmpty(candidate.provider_key) && nonEmpty(candidate.method_key)
  const pickupIsValid = candidate.type !== "pickup_point" || (
    !!candidate.pickup_point &&
    nonEmpty(candidate.pickup_point.id) &&
    nonEmpty(candidate.pickup_point.name) &&
    nonEmpty(candidate.pickup_point.address)
  )
  const resultIsComplete = identityIsValid &&
    Number.isFinite(candidate.amount) && candidate.amount! >= 0 &&
    nonEmpty(candidate.currency_code) &&
    Number.isInteger(candidate.delivery_days_min) && candidate.delivery_days_min! >= 0 &&
    Number.isInteger(candidate.delivery_days_max) &&
    candidate.delivery_days_max! >= candidate.delivery_days_min! &&
    nonEmpty(candidate.quote_id) && pickupIsValid

  if (!candidate.available || !resultIsComplete) {
    return {
      provider_key: candidate.provider_key,
      method_key: candidate.method_key,
      type: candidate.type,
      availability: "unavailable",
      amount: null,
      currency_code: null,
      delivery_days_min: null,
      delivery_days_max: null,
      pickup_point: null,
      quote_id: null,
      unavailable_reason: candidate.unavailable_reason ?? "incomplete_provider_response",
    }
  }

  return {
    provider_key: candidate.provider_key,
    method_key: candidate.method_key,
    type: candidate.type,
    availability: "available",
    amount: candidate.amount,
    currency_code: candidate.currency_code,
    delivery_days_min: candidate.delivery_days_min,
    delivery_days_max: candidate.delivery_days_max,
    pickup_point: candidate.pickup_point,
    quote_id: candidate.quote_id,
    unavailable_reason: null,
  }
}

export class DeliveryCapabilityError extends Error {
  constructor(providerKey: string, capability: DeliveryCapability) {
    super(`Delivery provider "${providerKey}" does not support "${capability}"`)
    this.name = "DeliveryCapabilityError"
  }
}

export class DeliveryProviderRegistry {
  private readonly adapters = new Map<string, DeliveryAdapter>()

  register(adapter: DeliveryAdapter) {
    if (!nonEmpty(adapter.provider_key) || this.adapters.has(adapter.provider_key)) {
      throw new Error(`Invalid or duplicate delivery provider key: "${adapter.provider_key}"`)
    }

    const capabilities = new Set(adapter.capabilities)
    for (const capability of capabilities) {
      if (!DELIVERY_CAPABILITIES.includes(capability) || typeof adapter[capability] !== "function") {
        throw new Error(`Provider "${adapter.provider_key}" declares an invalid capability: "${capability}"`)
      }
    }

    this.adapters.set(adapter.provider_key, Object.freeze({ ...adapter, capabilities: [...capabilities] }))
  }

  get(providerKey: string) {
    const adapter = this.adapters.get(providerKey)
    if (!adapter) throw new Error(`Unknown delivery provider: "${providerKey}"`)
    return adapter
  }

  supports(providerKey: string, capability: DeliveryCapability) {
    return this.get(providerKey).capabilities.includes(capability)
  }

  handler<K extends DeliveryCapability>(providerKey: string, capability: K) {
    const adapter = this.get(providerKey)
    if (!adapter.capabilities.includes(capability)) {
      throw new DeliveryCapabilityError(providerKey, capability)
    }
    return adapter[capability] as NonNullable<DeliveryAdapter[K]>
  }
}

export function shipmentIdempotencyKey(request: ShipmentRequest) {
  if (!nonEmpty(request.business_action_id) || !nonEmpty(request.destination_key)) {
    throw new Error("Shipment idempotency requires a business action and destination")
  }
  return `${request.business_action_id}:${request.direction}:${request.destination_key}`
}

export class DeliveryIdempotencyCoordinator<T> {
  private readonly operations = new Map<string, Promise<T>>()

  run(key: string, operation: () => Promise<T>): Promise<T> {
    const current = this.operations.get(key)
    if (current) return current

    let pending: Promise<T>
    pending = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (this.operations.get(key) === pending) {
          this.operations.delete(key)
        }
      })
    this.operations.set(key, pending)
    return pending
  }
}

export async function collectDeliveryOffers<T>(
  adapters: readonly { provider_key: string; quote: () => Promise<readonly T[]> }[]
): Promise<{ offers: T[]; unavailable_provider_keys: string[] }> {
  const results = await Promise.allSettled(adapters.map((adapter) => adapter.quote()))
  const offers: T[] = []
  const unavailable_provider_keys: string[] = []

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      unavailable_provider_keys.push(adapters[index].provider_key)
      return
    }
    offers.push(...result.value)
  })

  return { offers, unavailable_provider_keys }
}
