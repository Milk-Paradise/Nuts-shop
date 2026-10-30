import { Modules } from "@medusajs/framework/utils"

import { completeMoyskladOrderFulfillment } from "../complete-moysklad-order-fulfillment"

describe("completeMoyskladOrderFulfillment", () => {
  function setup() {
    let sync = {
      id: "sync_1",
      status: "synced",
      moysklad_order_id: "ms_order_1",
      fulfillment_status: null as string | null,
      moysklad_demand_id: null as string | null,
      fulfillment_attempts: 0,
    }
    const service = {
      getConnectionConfig: jest.fn().mockResolvedValue({
        is_active: true,
        credentials_status: "configured",
        encrypted_credentials: "encrypted",
      }),
      getOrderSyncStatus: jest.fn().mockImplementation(async () => sync),
      claimFulfillment: jest.fn().mockImplementation(async () => {
        sync = { ...sync, fulfillment_status: "syncing" }
        return sync
      }),
      recordFulfillmentAttempt: jest.fn().mockImplementation(async (input) => {
        sync = { ...sync, fulfillment_status: input.status, moysklad_demand_id: input.moyskladDemandId ?? null }
        return sync
      }),
      markCredentialsReentryRequired: jest.fn(),
    }
    const client = {
      findDemandByExternalCode: jest.fn().mockResolvedValue(null),
      createCustomerOrderDemand: jest.fn().mockResolvedValue({ id: "demand_1", meta: { href: "href-demand" } }),
    }
    const query = {
      graph: jest.fn().mockResolvedValue({ data: [{ id: "order_1", shipping_methods: [{ data: { cdekData: {} } }] }] }),
    }
    const container = {
      resolve: jest.fn((key: string) => {
        if (key === Modules.LOCKING) return { execute: async (_key: string, operation: () => Promise<unknown>) => operation() }
        if (key === "query") return query
        if (key === "moyskladIntegration") return service
        if (key === "logger") return { error: jest.fn() }
        throw new Error(`unexpected dependency ${key}`)
      }),
    }

    return { container: container as any, client: client as any, service, sync }
  }

  it("creates one demand and returns the stored demand on a repeated event", async () => {
    const { container, client, service } = setup()

    await expect(completeMoyskladOrderFulfillment(container, "order_1", client)).resolves.toEqual({
      status: "created",
      moysklad_demand_id: "demand_1",
    })
    await expect(completeMoyskladOrderFulfillment(container, "order_1", client)).resolves.toEqual({
      status: "already_created",
      moysklad_demand_id: "demand_1",
    })

    expect(client.createCustomerOrderDemand).toHaveBeenCalledTimes(1)
    expect(service.recordFulfillmentAttempt).toHaveBeenCalledWith(expect.objectContaining({
      orderId: "order_1",
      status: "synced",
      moyskladDemandId: "demand_1",
    }))
  })

  it("does not create an ERP shipment for an unrelated fulfillment", async () => {
    const { container, client } = setup()
    container.resolve.mockImplementation((key: string) => {
      if (key === Modules.LOCKING) return { execute: async (_key: string, operation: () => Promise<unknown>) => operation() }
      if (key === "query") return { graph: jest.fn().mockResolvedValue({ data: [{ shipping_methods: [{ data: { manual: true } }] }] }) }
      if (key === "moyskladIntegration") return {
        getConnectionConfig: jest.fn().mockResolvedValue({ is_active: true, credentials_status: "configured", encrypted_credentials: "encrypted" }),
      }
      throw new Error(`unexpected dependency ${key}`)
    })

    await expect(completeMoyskladOrderFulfillment(container, "order_1", client)).resolves.toEqual({
      status: "skipped",
      reason: "unsupported_delivery_method",
    })
    expect(client.createCustomerOrderDemand).not.toHaveBeenCalled()
  })
})
