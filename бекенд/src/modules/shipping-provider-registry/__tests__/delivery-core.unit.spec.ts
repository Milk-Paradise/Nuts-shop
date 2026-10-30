import {
  collectDeliveryOffers,
  DeliveryCapabilityError,
  DeliveryIdempotencyCoordinator,
  DeliveryProviderRegistry,
  normalizeDeliveryOffer,
  shipmentIdempotencyKey,
  type DeliveryAdapter,
} from "../delivery-core"

const forwardOnlyAdapter: DeliveryAdapter = {
  provider_key: "forward-only",
  capabilities: ["quote", "forward_shipment"],
  quote: async () => [],
  forward_shipment: async () => ({
    provider_shipment_id: "shipment-1",
    tracking_number: null,
    label_url: null,
  }),
}

describe("provider-neutral delivery core", () => {
  it("exposes only confirmed adapter capabilities and does not imitate returns", () => {
    const registry = new DeliveryProviderRegistry()
    registry.register(forwardOnlyAdapter)

    expect(registry.supports("forward-only", "forward_shipment")).toBe(true)
    expect(registry.supports("forward-only", "return_shipment")).toBe(false)
    expect(() => registry.handler("forward-only", "return_shipment"))
      .toThrow(DeliveryCapabilityError)
  })

  it("rejects a declared capability without an implementation", () => {
    const registry = new DeliveryProviderRegistry()
    expect(() => registry.register({
      provider_key: "invalid",
      capabilities: ["return_shipment"],
    })).toThrow("declares an invalid capability")
  })

  it("marks an incomplete or contradictory quote unavailable", () => {
    expect(normalizeDeliveryOffer({
      provider_key: "carrier",
      method_key: "courier",
      type: "courier",
      available: true,
      amount: 500,
      currency_code: "RUB",
      delivery_days_min: 4,
      delivery_days_max: 2,
      pickup_point: null,
      quote_id: "opaque-token",
    })).toEqual(expect.objectContaining({
      provider_key: "carrier",
      method_key: "courier",
      availability: "unavailable",
      amount: null,
      quote_id: null,
      unavailable_reason: "incomplete_provider_response",
    }))
  })

  it("preserves a complete, verifiable quote result", () => {
    expect(normalizeDeliveryOffer({
      provider_key: "carrier",
      method_key: "pvz",
      type: "pickup_point",
      available: true,
      amount: 500,
      currency_code: "RUB",
      delivery_days_min: 2,
      delivery_days_max: 4,
      pickup_point: { id: "point-1", name: "ПВЗ", address: "Москва" },
      quote_id: "opaque-token",
    })).toEqual(expect.objectContaining({
      availability: "available",
      quote_id: "opaque-token",
      pickup_point: { id: "point-1", name: "ПВЗ", address: "Москва" },
    }))
  })

  it("keeps healthy provider offers when another provider calculation fails", async () => {
    await expect(collectDeliveryOffers([
      { provider_key: "cdek", quote: async () => [{ id: "cdek-offer" }] },
      { provider_key: "store-pickup", quote: async () => [{ id: "pickup-offer" }] },
      { provider_key: "offline", quote: async () => { throw new Error("timeout") } },
    ])).resolves.toEqual({
      offers: [{ id: "cdek-offer" }, { id: "pickup-offer" }],
      unavailable_provider_keys: ["offline"],
    })
  })

  it("coalesces two parallel requests for the same business action", async () => {
    const coordinator = new DeliveryIdempotencyCoordinator<{ id: string }>()
    const request = {
      business_action_id: "fulfill-order-1",
      direction: "forward" as const,
      destination_key: "customer-address-1",
    }
    const key = shipmentIdempotencyKey(request)
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const operation = async () => {
      calls += 1
      await gate
      return { id: "shipment-1" }
    }

    const first = coordinator.run(key, operation)
    const second = coordinator.run(key, operation)
    release()

    await expect(Promise.all([first, second])).resolves.toEqual([
      { id: "shipment-1" },
      { id: "shipment-1" },
    ])
    expect(calls).toBe(1)
  })

  it("releases a successful operation after it settles", async () => {
    const coordinator = new DeliveryIdempotencyCoordinator<number>()
    const operation = jest.fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)

    await expect(coordinator.run("shipment", operation)).resolves.toBe(1)
    await expect(coordinator.run("shipment", operation)).resolves.toBe(2)
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it("releases a failed operation so it can be retried", async () => {
    const coordinator = new DeliveryIdempotencyCoordinator<string>()
    const operation = jest.fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce("retried")

    await expect(coordinator.run("shipment", operation)).rejects.toThrow("temporary failure")
    await expect(coordinator.run("shipment", operation)).resolves.toBe("retried")
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it("separates idempotency by direction and destination", () => {
    const base = { business_action_id: "order-1", direction: "forward" as const }
    expect(shipmentIdempotencyKey({ ...base, destination_key: "address-1" }))
      .not.toBe(shipmentIdempotencyKey({ ...base, destination_key: "address-2" }))
    expect(shipmentIdempotencyKey({ ...base, destination_key: "address-1" }))
      .not.toBe(shipmentIdempotencyKey({ ...base, direction: "return", destination_key: "address-1" }))
  })
})
