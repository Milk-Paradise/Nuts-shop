const mockTransferCartRun = jest.fn()
const mockRefreshCartRun = jest.fn()
const mockCreateCustomerRun = jest.fn()
const mockUpdateCustomersRun = jest.fn()
const mockSetAuthMetadataRun = jest.fn()
const mockUpdateCartByVersion = jest.fn()
const mockValidateCatalogCartItems = jest.fn()

jest.mock("@medusajs/medusa/core-flows", () => ({
  transferCartCustomerWorkflow: () => ({ run: mockTransferCartRun }),
  refreshCartItemsWorkflow: () => ({ run: mockRefreshCartRun }),
  createCustomerAccountWorkflow: () => ({ run: mockCreateCustomerRun }),
  updateCustomersWorkflow: () => ({ run: mockUpdateCustomersRun }),
  setAuthAppMetadataWorkflow: () => ({ run: mockSetAuthMetadataRun }),
}))

jest.mock("../../api/catalog/utils", () => ({
  validateCatalogCartItems: (...args: unknown[]) => mockValidateCatalogCartItems(...args),
}))

import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"

import { CART_VERSIONING_MODULE } from "../../modules/cart"
import { CART_MERGE_OPERATION_MODULE } from "../../modules/cart-merge-operation"
import { mergeGuestCartIntoCustomer } from "../merge-guest-cart-into-customer"
import { registerCustomerAccount } from "../register-customer-account"

type Cart = {
  id: string
  customer_id: string | null
  items: any[]
  created_at?: string
  completed_at?: string | null
  version?: number
}

function cartContainer(accountCarts: Cart[], guestCarts: Cart[]) {
  const allCarts = [...accountCarts, ...guestCarts].map((cart, index) => ({
    created_at: new Date(index).toISOString(),
    completed_at: null,
    version: 1,
    ...cart,
  }))
  const operations: any[] = []
  const query = {
    graph: jest.fn(async ({ filters }: any) => ({
      data: filters?.id
        ? allCarts.filter((cart) => cart.id === filters.id)
        : allCarts.filter((cart) => cart.customer_id === filters?.customer_id && !cart.completed_at),
    })),
  }
  const cartService = {
    updateLineItems: jest.fn(async (id, data) => {
      const line = allCarts.flatMap((cart) => cart.items ?? []).find((item) => item.id === id)
      if (line) Object.assign(line, data)
      return { id, ...data }
    }),
    addLineItems: jest.fn(async (cartId, items) => {
      const created = items.map((item, index) => ({ id: `created_line_${index}`, ...item }))
      const cart = allCarts.find((entry) => entry.id === cartId)
      if (cart) cart.items.push(...created)
      return created
    }),
  }
  const operationService = {
    listCartMergeOperations: jest.fn(async (filter: any) => operations.filter((entry) => entry.guest_cart_id === filter.guest_cart_id)),
    createCartMergeOperations: jest.fn(async (input: any) => {
      const operation = { id: `operation_${operations.length + 1}`, ...input }
      operations.push(operation)
      return operation
    }),
    updateCartMergeOperations: jest.fn(async (input: any) => {
      const operation = operations.find((entry) => entry.id === input.id)
      Object.assign(operation, input)
      return operation
    }),
  }
  const locking = {
    execute: jest.fn(async (_keys, callback) => callback()),
  }
  const container = {
    resolve: jest.fn((key) => {
      if (key === ContainerRegistrationKeys.QUERY) return query
      if (key === Modules.CART) return cartService
      if (key === CART_MERGE_OPERATION_MODULE) return operationService
      if (key === Modules.LOCKING) {
        return locking
      }
      if (key === CART_VERSIONING_MODULE) {
        return {
          getVersion: jest.fn(async (id) =>
            allCarts.find((cart) => cart.id === id)?.version ?? null
          ),
          updateCartByVersion: mockUpdateCartByVersion,
        }
      }
      throw new Error(`Unexpected dependency: ${String(key)}`)
    }),
  }
  return { container: container as any, query, cartService, operationService, locking, allCarts }
}

const guestItem = {
  id: "guest_line",
  variant_id: "variant_1",
  quantity: 2,
  title: "Краска",
  subtitle: null,
  thumbnail: null,
  product_id: "prod_1",
  product_title: "Краска",
  variant_sku: "SKU-1",
  variant_title: null,
  unit_price: 500,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockValidateCatalogCartItems.mockImplementation(async (_container, items) => items.map((item: any) => ({
    ...item,
    product: { max_quantity: 99 },
    purchasable: true,
    problem: null,
    available_quantity: 99,
  })))
  mockTransferCartRun.mockResolvedValue({ result: undefined })
  mockRefreshCartRun.mockResolvedValue({ result: undefined })
  mockUpdateCartByVersion.mockResolvedValue({ cart: {}, version: 2 })
})

describe("guest cart merge", () => {
  const input = { customerId: "cus_1", guestCartId: "guest_1" }

  it("keeps the newest account cart when the saved guest id is missing", async () => {
    const { container } = cartContainer([
      { id: "account_old", customer_id: "cus_1", items: [] },
      { id: "account_new", customer_id: "cus_1", items: [] },
    ], [])
    await expect(mergeGuestCartIntoCustomer(container, input))
      .resolves.toMatchObject({ cartId: "account_new" })

    const missingEverywhere = cartContainer([], [])
    await expect(mergeGuestCartIntoCustomer(missingEverywhere.container, input))
      .resolves.toMatchObject({ cartId: "guest_1" })
  })

  it("is idempotent for the same customer and rejects a cart claimed by another customer", async () => {
    const same = cartContainer(
      [{ id: "account_1", customer_id: "cus_1", items: [] }],
      [{ id: "guest_1", customer_id: "cus_1", items: [guestItem] }],
    )
    await expect(mergeGuestCartIntoCustomer(same.container, input))
      .resolves.toMatchObject({ cartId: "guest_1" })

    const claimed = cartContainer(
      [{ id: "account_1", customer_id: "cus_1", items: [] }],
      [{ id: "guest_1", customer_id: "cus_other", items: [guestItem] }],
    )
    await expect(mergeGuestCartIntoCustomer(claimed.container, input))
      .resolves.toMatchObject({ cartId: "account_1" })
    expect(mockTransferCartRun).not.toHaveBeenCalled()
  })

  it("refreshes a pending operation after releasing the merge lock", async () => {
    const { container, locking, operationService } = cartContainer(
      [{ id: "account_1", customer_id: "cus_1", items: [] }],
      [{ id: "guest_1", customer_id: null, items: [guestItem] }]
    )
    await operationService.createCartMergeOperations({
      guest_cart_id: "guest_1",
      customer_id: "cus_1",
      result_cart_id: "account_1",
      state: "refresh_pending",
    })
    let outerLockHeld = false
    locking.execute.mockImplementation(async (_keys, callback) => {
      outerLockHeld = true
      try {
        return await callback()
      } finally {
        outerLockHeld = false
      }
    })
    mockRefreshCartRun.mockImplementation(async () => {
      expect(outerLockHeld).toBe(false)
      return { result: undefined }
    })

    await expect(mergeGuestCartIntoCustomer(container, input))
      .resolves.toMatchObject({ cartId: "account_1" })
    expect(mockRefreshCartRun).toHaveBeenCalledWith({
      input: { cart_id: "account_1", force_refresh: true },
    })
  })

  it("reassigns the guest cart when the customer has no active cart", async () => {
    const { container } = cartContainer([], [
      { id: "guest_1", customer_id: null, items: [guestItem] },
    ])
    mockTransferCartRun.mockResolvedValue({ result: undefined })
    mockUpdateCartByVersion.mockResolvedValue({ cart: { id: "guest_1" }, version: 1 })

    await expect(mergeGuestCartIntoCustomer(container, input))
      .resolves.toMatchObject({ cartId: "guest_1" })
    expect(mockUpdateCartByVersion).toHaveBeenCalledWith(
      "guest_1",
      1,
      { customer_id: "cus_1" }
    )
  })

  it("keeps the larger matching quantity, copies new lines and refreshes touched items", async () => {
    const accountLine = { ...guestItem, id: "account_line", quantity: 3 }
    const second = {
      ...guestItem,
      id: "guest_line_2",
      variant_id: "variant_2",
      subtitle: "1 л",
      thumbnail: "https://img.test/paint.jpg",
      variant_title: "Красный",
    }
    const { container, cartService, locking } = cartContainer(
      [{ id: "account_1", customer_id: "cus_1", items: [accountLine] }],
      [{ id: "guest_1", customer_id: null, items: [guestItem, second, { ...guestItem, id: "bad", variant_id: null }] }],
    )
    mockUpdateCartByVersion.mockResolvedValue({ cart: { id: "account_1" }, version: 1 })
    let outerLockHeld = false
    locking.execute.mockImplementation(async (_keys, callback) => {
      outerLockHeld = true
      try {
        return await callback()
      } finally {
        outerLockHeld = false
      }
    })
    mockRefreshCartRun.mockImplementation(async () => {
      expect(outerLockHeld).toBe(false)
      return { result: undefined }
    })

    await expect(mergeGuestCartIntoCustomer(container, input))
      .resolves.toMatchObject({ cartId: "account_1" })
    expect(cartService.updateLineItems).not.toHaveBeenCalledWith("account_line", { quantity: 5 })
    expect(cartService.addLineItems).toHaveBeenCalledWith("account_1", [expect.objectContaining({
      variant_id: "variant_2",
      quantity: 2,
      subtitle: "1 л",
      thumbnail: "https://img.test/paint.jpg",
      variant_title: "Красный",
      unit_price: 500,
    })])
    expect(mockRefreshCartRun).toHaveBeenCalledWith({
      input: {
        cart_id: "account_1",
        items: [
          expect.objectContaining({ id: "created_line_0", variant_id: "variant_2" }),
          expect.objectContaining({ id: "created_line_0", quantity: 2 }),
        ],
      },
    })
  })

  it("does not mutate or refresh for an empty guest cart", async () => {
    const { container, cartService } = cartContainer(
      [{ id: "account_1", customer_id: "cus_1", items: [] }],
      [{ id: "guest_1", customer_id: null, items: null as any }],
    )
    await expect(mergeGuestCartIntoCustomer(container, input))
      .resolves.toMatchObject({ cartId: "account_1" })
    expect(cartService.updateLineItems).not.toHaveBeenCalled()
    expect(cartService.addLineItems).not.toHaveBeenCalled()
    expect(mockRefreshCartRun).not.toHaveBeenCalled()
  })

  it("caps merged quantities to available stock and replays without applying the merge twice", async () => {
    const accountLine = { ...guestItem, id: "account_line", quantity: 3 }
    const guest = { ...guestItem, quantity: 6 }
    const { container, cartService, operationService } = cartContainer(
      [{ id: "account_1", customer_id: "cus_1", items: [accountLine] }],
      [{ id: "guest_1", customer_id: null, items: [guest] }]
    )
    mockValidateCatalogCartItems.mockResolvedValueOnce([{
      variant_id: "variant_1", quantity: 6, product: { max_quantity: 4 },
      purchasable: false, problem: "insufficient_stock", available_quantity: 4,
    }])
    mockValidateCatalogCartItems.mockResolvedValueOnce([{
      variant_id: "variant_1", quantity: 4, product: { max_quantity: 4 },
      purchasable: true, problem: null, available_quantity: 4,
    }])

    const first = await mergeGuestCartIntoCustomer(container, input)
    expect(cartService.updateLineItems).toHaveBeenCalledWith(
      "account_line", { quantity: 4 }
    )
    expect(first.items).toEqual([expect.objectContaining({
      line_item_id: "account_line", allowed_quantity: 4, purchasable: true,
    })])

    await mergeGuestCartIntoCustomer(container, input)
    expect(operationService.createCartMergeOperations).toHaveBeenCalledTimes(1)
    expect(cartService.updateLineItems).toHaveBeenCalledTimes(1)
  })

  it("preserves an out-of-stock line and reports an allowed quantity of zero", async () => {
    const { container } = cartContainer([], [
      { id: "guest_1", customer_id: null, items: [guestItem] },
    ])
    mockValidateCatalogCartItems.mockResolvedValue([{
      variant_id: "variant_1", quantity: 2, product: { max_quantity: 0 },
      purchasable: false, problem: "out_of_stock", available_quantity: 0,
    }])

    const result = await mergeGuestCartIntoCustomer(container, input)
    expect(result.items).toEqual([expect.objectContaining({
      quantity: 2, purchasable: false, problem: "out_of_stock", allowed_quantity: 0,
    })])
  })
})

describe("customer account registration", () => {
  const input = {
    authIdentityId: "auth_1",
    customerData: {
      email: "buyer@test.com",
      first_name: "Новый",
      last_name: null,
      phone: null,
    },
  }

  function customerContainer(customers: any[]) {
    const service = { listCustomers: jest.fn().mockResolvedValue(customers) }
    return {
      service,
      container: { resolve: jest.fn(() => service) } as any,
    }
  }

  it("rejects a duplicate password account", async () => {
    const { container } = customerContainer([{ id: "cus_existing", has_account: true }])
    await expect(registerCustomerAccount(container, input))
      .rejects.toBeInstanceOf(MedusaError)
    expect(mockCreateCustomerRun).not.toHaveBeenCalled()
  })

  it("uses the standard workflow when no guest customer exists", async () => {
    const { container, service } = customerContainer([])
    mockCreateCustomerRun.mockResolvedValue({ result: { id: "cus_new" } })
    await expect(registerCustomerAccount(container, input))
      .resolves.toEqual({ id: "cus_new" })
    expect(service.listCustomers).toHaveBeenCalledWith({ email: "buyer@test.com" })
    expect(mockCreateCustomerRun).toHaveBeenCalledWith({ input })

    const noEmail = customerContainer([])
    await registerCustomerAccount(noEmail.container, {
      ...input,
      customerData: { ...input.customerData, email: null },
    })
    expect(noEmail.service.listCustomers).not.toHaveBeenCalled()
  })

  it("upgrades the guest row and preserves fields omitted by registration", async () => {
    const guest = {
      id: "cus_guest",
      has_account: false,
      first_name: "Старое",
      last_name: "Имя",
      phone: "+70000000000",
    }
    const { container } = customerContainer([guest])
    mockUpdateCustomersRun.mockResolvedValue({ result: [{ id: "cus_guest", has_account: true }] })
    mockSetAuthMetadataRun.mockResolvedValue({ result: undefined })

    await expect(registerCustomerAccount(container, input))
      .resolves.toEqual({ id: "cus_guest", has_account: true })
    expect(mockUpdateCustomersRun).toHaveBeenCalledWith({
      input: {
        selector: { id: "cus_guest" },
        update: {
          has_account: true,
          first_name: "Новый",
          last_name: "Имя",
          phone: "+70000000000",
        },
      },
    })
    expect(mockSetAuthMetadataRun).toHaveBeenCalledWith({
      input: {
        authIdentityId: "auth_1",
        actorType: "customer",
        value: "cus_guest",
      },
    })
  })
})
