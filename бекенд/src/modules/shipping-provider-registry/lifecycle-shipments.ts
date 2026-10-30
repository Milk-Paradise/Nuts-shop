type ShippingShipmentRegistry = {
  listShippingShipments(
    selector: { order_id: string; direction: "forward" }
  ): Promise<Array<Record<string, any>>>
}

// A forward shipment is identified by its order and direction. Callers must
// not need to know which carrier created it to show lifecycle state.
export async function retrieveForwardDeliveryShipment(
  registry: ShippingShipmentRegistry,
  orderId: string
) {
  const [shipment] = await registry.listShippingShipments({
    order_id: orderId,
    direction: "forward",
  })
  return shipment ?? null
}
