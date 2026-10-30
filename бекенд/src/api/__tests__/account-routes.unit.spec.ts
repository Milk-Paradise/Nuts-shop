const orders = {
  customer: { id: "cus_1", email: "buyer@test.com" },
  retrieveCustomer: jest.fn(),
  retrieveOrder: jest.fn(),
  list: jest.fn(),
  cancelRun: jest.fn(),
  returnRun: jest.fn(),
}
const wishlist = {
  requireCustomerId: jest.fn(),
  list: jest.fn(),
  add: jest.fn(),
  remove: jest.fn(),
  ids: jest.fn(),
}
const account = {
  merge: jest.fn(),
  register: jest.fn(),
  verifyUnsubscribe: jest.fn(),
  optOut: jest.fn(),
}

jest.mock("../store/account/orders/utils", () => ({
  retrieveAccountCustomer: (...args: unknown[]) => orders.retrieveCustomer(...args),
  retrieveAccountOrder: (...args: unknown[]) => orders.retrieveOrder(...args),
  listAccountOrders: (...args: unknown[]) => orders.list(...args),
}))
jest.mock("../store/account/wishlist/utils", () => ({
  requireCustomerId: (...args: unknown[]) => wishlist.requireCustomerId(...args),
  listWishlistItems: (...args: unknown[]) => wishlist.list(...args),
  addWishlistItem: (...args: unknown[]) => wishlist.add(...args),
  removeWishlistItem: (...args: unknown[]) => wishlist.remove(...args),
  listWishlistProductIds: (...args: unknown[]) => wishlist.ids(...args),
}))
jest.mock("../../workflows/cancel-catalog-customer-order", () => ({
  cancelCatalogCustomerOrderWorkflow: () => ({ run: orders.cancelRun }),
}))
jest.mock("../../workflows/request-catalog-shipping-return", () => ({
  requestCatalogShippingReturnWorkflow: () => ({ run: orders.returnRun }),
}))
jest.mock("../../workflows/merge-guest-cart-into-customer", () => ({
  mergeGuestCartIntoCustomer: (...args: unknown[]) => account.merge(...args),
}))
jest.mock("../../workflows/register-customer-account", () => ({
  registerCustomerAccount: (...args: unknown[]) => account.register(...args),
}))
jest.mock("../../lib/abandoned-cart-links", () => ({
  verifyAbandonedCartUnsubscribeToken: (...args: unknown[]) => account.verifyUnsubscribe(...args),
}))
jest.mock("../../workflows/opt-out-abandoned-cart-reminders", () => ({
  optOutOfAbandonedCartReminders: (...args: unknown[]) => account.optOut(...args),
}))

import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { SHIPPING_PROVIDER_REGISTRY_MODULE } from "../../modules/shipping-provider-registry"

import { GET as listOrders } from "../store/account/orders/route"
import { GET as getOrder } from "../store/account/orders/[id]/route"
import { POST as cancelOrder } from "../store/account/orders/[id]/cancel/route"
import { POST as returnOrder } from "../store/account/orders/[id]/return/route"
import { GET as getTracking } from "../store/account/orders/[id]/tracking/route"
import { GET as listWishlist, POST as addWishlist } from "../store/account/wishlist/route"
import { DELETE as removeWishlist } from "../store/account/wishlist/[productId]/route"
import { GET as wishlistIds } from "../store/account/wishlist/ids/route"
import { POST as mergeCart } from "../store/carts/[id]/merge-into-customer/route"
import { POST as registerCustomer } from "../store/customers/route"
import { POST as unsubscribe } from "../store/unsubscribe/abandoned-cart/route"

function response() {
  const res: any = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
  }
  return res
}

function request(overrides: Record<string, unknown> = {}) {
  const shippingRegistry = { listShippingShipments: jest.fn().mockResolvedValue([]) }
  const query = { graph: jest.fn().mockResolvedValue({ data: [{ id: "cus_1" }] }) }
  const req = {
    scope: {
      resolve: jest.fn((key) => {
        if (key === SHIPPING_PROVIDER_REGISTRY_MODULE) return shippingRegistry
        if (key === ContainerRegistrationKeys.QUERY) return query
        throw new Error(`Unexpected dependency: ${String(key)}`)
      }),
    },
    auth_context: { actor_id: "cus_1", auth_identity_id: "auth_1" },
    params: { id: "order_1", productId: "prod_1" },
    query: {},
    queryConfig: { fields: ["id", "email"] },
    validatedBody: {},
    ...overrides,
  } as any
  return { req, shippingRegistry, query }
}

beforeEach(() => {
  jest.clearAllMocks()
  orders.retrieveCustomer.mockResolvedValue(orders.customer)
  orders.retrieveOrder.mockResolvedValue({ id: "order_1" })
  orders.list.mockResolvedValue({ orders: [{ id: "order_1" }], count: 1 })
  orders.cancelRun.mockResolvedValue({ result: { outcome: "canceled" } })
  orders.returnRun.mockResolvedValue({ result: { request: { id: "return_1" } } })
  wishlist.requireCustomerId.mockReturnValue("cus_1")
  wishlist.list.mockResolvedValue({ items: [{ product_id: "prod_1" }], count: 1 })
  wishlist.add.mockResolvedValue({ product_id: "prod_1" })
  wishlist.remove.mockResolvedValue(undefined)
  wishlist.ids.mockResolvedValue(["prod_1"])
  account.merge.mockResolvedValue({ cartId: "cart_account" })
  account.register.mockResolvedValue({ id: "cus_1" })
  account.verifyUnsubscribe.mockReturnValue(true)
  account.optOut.mockResolvedValue(undefined)
})

it("falls back to the full, newest-first, paged view for anything it does not recognize", async () => {
  const all = request({ query: { filter: "unknown", sort: "sideways", offset: "9" } })
  await listOrders(all.req, response())
  // An unrecognized filter is not "no filter": the page size stays put, so a
  // broken query parameter cannot make the endpoint return every order at once.
  expect(orders.list).toHaveBeenCalledWith(all.req.scope, orders.customer, {
    filter: "all",
    sort: "created_at_desc",
    limit: 10,
    offset: 9,
  })

  // Every filter gets the same page size — otherwise switching the filter would
  // silently switch how much the account page loads.
  for (const filter of ["history", "in_progress"] as const) {
    for (const [offset, expected] of [["12", 12], ["-1", 0], ["1.5", 0], ["bad", 0]] as const) {
      const filtered = request({ query: { filter, sort: "created_at_asc", offset } })
      const res = response()
      await listOrders(filtered.req, res)
      expect(orders.list).toHaveBeenLastCalledWith(filtered.req.scope, orders.customer, {
        filter,
        sort: "created_at_asc",
        limit: 10,
        offset: expected,
      })
      expect(res.json).toHaveBeenCalledWith({ orders: [{ id: "order_1" }], count: 1 })
    }
  }
})

it("retrieves, cancels and requests a return only after account ownership resolution", async () => {
  const detail = request()
  const detailRes = response()
  await getOrder(detail.req, detailRes)
  expect(detailRes.json).toHaveBeenCalledWith({ order: { id: "order_1" } })

  const cancellation = request()
  const cancelRes = response()
  await cancelOrder(cancellation.req, cancelRes)
  expect(orders.cancelRun).toHaveBeenCalledWith({
    input: {
      order_id: "order_1",
      customer_id: "cus_1",
      customer_email: "buyer@test.com",
    },
  })
  expect(cancelRes.json).toHaveBeenCalledWith(expect.objectContaining({
    order: { id: "order_1" }, outcome: "canceled",
  }))

  const returning = request()
  const returnRes = response()
  await returnOrder(returning.req, returnRes)
  expect(orders.returnRun).toHaveBeenCalledWith({
    input: {
      order_id: "order_1",
      customer_id: "cus_1",
      customer_email: "buyer@test.com",
    },
  })
  expect(returnRes.json).toHaveBeenCalledWith(expect.objectContaining({
    outcome: "return_requested", return_request: { id: "return_1" },
  }))
})

it("returns stored CDEK tracking or no tracking when no carrier shipment exists", async () => {
  const statusEvent = new Date("2026-08-01T10:00:00.000Z")
  const cdekReq = request()
  cdekReq.shippingRegistry.listShippingShipments.mockResolvedValue([{
    simplified_status: "in_transit",
    tracking_number: "CDEK-1",
    status_event_at: statusEvent,
    updated_at: new Date("2026-07-01T00:00:00.000Z"),
  }])
  const cdekRes = response()
  await getTracking(cdekReq.req, cdekRes)
  expect(cdekRes.json).toHaveBeenCalledWith({ result: {
    status: "unchanged",
    tracking: {
      status: "in_transit",
      trackingNumber: "CDEK-1",
      trackingUrl: null,
      polledAt: statusEvent.toISOString(),
    },
  } })
  const emptyReq = request()
  const emptyRes = response()
  await getTracking(emptyReq.req, emptyRes)
  expect(emptyRes.json).toHaveBeenCalledWith({
    result: { status: "unchanged", tracking: null },
  })
})

it("keeps wishlist routes scoped to the authenticated customer and encoded product id", async () => {
  const listReq = request({ query: { offset: "20" } })
  const listRes = response()
  await listWishlist(listReq.req, listRes)
  expect(wishlist.list).toHaveBeenCalledWith(listReq.req.scope, "cus_1", 20)
  expect(listRes.json).toHaveBeenCalledWith({ items: [{ product_id: "prod_1" }], count: 1 })

  for (const offset of ["-1", "bad", undefined]) {
    const req = request({ query: { offset } })
    await listWishlist(req.req, response())
    expect(wishlist.list).toHaveBeenLastCalledWith(req.req.scope, "cus_1", 0)
  }

  const addReq = request({ validatedBody: { product_id: "prod_2" } })
  await addWishlist(addReq.req, response())
  expect(wishlist.add).toHaveBeenCalledWith(addReq.req.scope, "cus_1", "prod_2")

  const removeReq = request({ params: { productId: "prod/2" } })
  const removeRes = response()
  await removeWishlist(removeReq.req, removeRes)
  expect(wishlist.remove).toHaveBeenCalledWith(removeReq.req.scope, "cus_1", "prod/2")
  expect(removeRes.json).toHaveBeenCalledWith({ id: "prod/2", deleted: true })

  const idsReq = request()
  const idsRes = response()
  await wishlistIds(idsReq.req, idsRes)
  expect(idsRes.json).toHaveBeenCalledWith({ product_ids: ["prod_1"] })
})

it("merges a guest cart into the authenticated account", async () => {
  const { req } = request({ params: { id: "guest_cart" } })
  const res = response()
  await mergeCart(req, res)
  expect(account.merge).toHaveBeenCalledWith(req.scope, {
    customerId: "cus_1",
    guestCartId: "guest_cart",
  })
  expect(res.json).toHaveBeenCalledWith({ cart_id: "cart_account", items: undefined })
})

it("registers only an unauthenticated identity and returns requested customer fields", async () => {
  const existing = request()
  await expect(registerCustomer(existing.req, response())).rejects.toBeInstanceOf(MedusaError)

  const registration = request({
    auth_context: { actor_id: undefined, auth_identity_id: "auth_1" },
    validatedBody: { email: "buyer@test.com", first_name: "Иван" },
  })
  const res = response()
  await registerCustomer(registration.req, res)
  expect(account.register).toHaveBeenCalledWith(registration.req.scope, {
    authIdentityId: "auth_1",
    customerData: registration.req.validatedBody,
  })
  expect(registration.query.graph).toHaveBeenCalledWith({
    entity: "customer",
    fields: ["id", "email"],
    filters: { id: "cus_1" },
  })
  expect(res.json).toHaveBeenCalledWith({ customer: { id: "cus_1" } })
})

it("requires a valid signed token before opting out of reminders", async () => {
  const valid = request({ validatedBody: { customer_id: "cus_1", token: "signed" } })
  const validRes = response()
  await unsubscribe(valid.req, validRes)
  expect(account.optOut).toHaveBeenCalledWith(valid.req.scope, "cus_1")
  expect(validRes.json).toHaveBeenCalledWith({ opted_out: true })

  account.verifyUnsubscribe.mockReturnValue(false)
  await expect(unsubscribe(valid.req, response())).rejects.toBeInstanceOf(MedusaError)
  expect(account.optOut).toHaveBeenCalledTimes(1)
})
