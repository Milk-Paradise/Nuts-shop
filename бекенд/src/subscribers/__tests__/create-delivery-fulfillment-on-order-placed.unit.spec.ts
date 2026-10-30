jest.mock("../../workflows/delivery-lifecycle", () => ({
  createDeliveryOrderFulfillmentIfNeeded: jest.fn(),
}))

import {
  ContainerRegistrationKeys,
  OrderWorkflowEvents,
} from "@medusajs/framework/utils"

import { createDeliveryOrderFulfillmentIfNeeded } from "../../workflows/delivery-lifecycle"
import createDeliveryFulfillmentOnOrderPlaced, {
  config,
} from "../create-delivery-fulfillment-on-order-placed"

const createDeliveryOrderFulfillmentIfNeededMock =
  createDeliveryOrderFulfillmentIfNeeded as jest.Mock

const order = {
  shipping_methods: [
    {
      shipping_option_id: "so_cdek",
      shipping_option: { provider_id: "cdek_cdek" },
      data: { cdekData: { tariff_code: 136 } },
    },
  ],
}

function buildContainer() {
  const query = { graph: jest.fn().mockResolvedValue({ data: [order] }) }
  const logger = { error: jest.fn() }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) return query
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      throw new Error(`Unexpected container key: ${key}`)
    }),
  }

  return { container, query, logger }
}

function placedEvent(container: unknown) {
  return {
    event: { name: OrderWorkflowEvents.PLACED, data: { id: "order_1" } },
    container,
  } as never
}

describe("createDeliveryFulfillmentOnOrderPlaced subscriber", () => {
  beforeEach(() => {
    createDeliveryOrderFulfillmentIfNeededMock.mockReset()
  })

  it("loads delivery fields and creates fulfillment for the placed order", async () => {
    createDeliveryOrderFulfillmentIfNeededMock.mockResolvedValue({
      status: "created",
    })
    const { container, query } = buildContainer()

    await createDeliveryFulfillmentOnOrderPlaced(placedEvent(container))

    expect(query.graph).toHaveBeenCalledWith({
      entity: "order",
      fields: [
        "shipping_methods.shipping_option_id",
        "shipping_methods.shipping_option.provider_id",
        "shipping_methods.data",
      ],
      filters: { id: "order_1" },
    })
    expect(createDeliveryOrderFulfillmentIfNeededMock).toHaveBeenCalledWith(
      container,
      "order_1",
      order
    )
    expect(config).toMatchObject({
      event: OrderWorkflowEvents.PLACED,
      context: { subscriberId: "create-delivery-fulfillment-on-order-placed" },
    })
  })

  it("logs a failed result without throwing", async () => {
    createDeliveryOrderFulfillmentIfNeededMock.mockResolvedValue({
      status: "failed",
      error: "carrier unavailable",
    })
    const { container, logger } = buildContainer()

    await expect(
      createDeliveryFulfillmentOnOrderPlaced(placedEvent(container))
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("carrier unavailable")
    )
  })

  it("catches thrown errors without propagating them", async () => {
    createDeliveryOrderFulfillmentIfNeededMock.mockRejectedValue(
      new Error("unexpected failure")
    )
    const { container, logger } = buildContainer()

    await expect(
      createDeliveryFulfillmentOnOrderPlaced(placedEvent(container))
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("unexpected failure")
    )
  })
})
