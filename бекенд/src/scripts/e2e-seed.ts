import type {
  ExecArgs,
  IAuthModuleService,
  IRbacModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  completeOrderWorkflow,
  createCartWorkflow,
  createCustomerAccountWorkflow,
  createInventoryLevelsWorkflow,
  createOrderWorkflow,
  createCollectionsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createUserAccountWorkflow,
  updateProductsWorkflow,
  updateInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows"

import { CMS_HOMEPAGE_SNAPSHOT_KEY, persistCmsSnapshot } from "../lib/cms-snapshot"
import type { CmsHomepage } from "../lib/cms-content"
import { ABANDONED_CART_REMINDER_MODULE } from "../modules/abandoned-cart-reminder"
import type AbandonedCartReminderModuleService from "../modules/abandoned-cart-reminder/service"
import { CMS_SNAPSHOT_MODULE } from "../modules/cms-snapshot"
import type CmsSnapshotModuleService from "../modules/cms-snapshot/service"
import { PAYMENT_PROVIDER_CONFIG_MODULE } from "../modules/payment-provider-config"
import type PaymentProviderConfigModuleService from "../modules/payment-provider-config/service"
import { COMMERCE_BASELINE, type CommerceBaselineResult } from "./seed-commerce"
import {
  E2E_ADMIN_WITH_ACCESS,
  E2E_ADMIN_WITHOUT_ACCESS,
  E2E_CART_IDS,
  E2E_CATEGORY_HANDLES,
  E2E_CUSTOMER,
  E2E_HOMEPAGE_PUBLISHED,
  E2E_ORDER_DISPLAY_IDS,
  E2E_PREVIEW,
  E2E_PRODUCT_FIXTURES,
  E2E_PROMOTION_COLLECTION,
  E2E_PROVIDER_IDS,
  E2E_RESTRICTED_ADMIN_ROLE_NAME,
  E2E_SEED_VERSION,
  E2E_SHIPPING_FIXTURE,
} from "./e2e-seed-fixtures"

type QueryGraph = {
  graph(input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }): Promise<{ data: Record<string, any>[] }>
}

type ProductDefinition = {
  title: string
  handle: string
  sku: string
  category: string
  brand: string
  price: number
  stock: number
  allowBackorder?: boolean
  status?: ProductStatus
  metadata?: Record<string, unknown>
  images?: { url: string }[]
}

export const CATEGORIES: Array<{ name: string; handle: string; parent?: string }> = [
  { name: "E2E Покрытия", handle: E2E_CATEGORY_HANDLES.coatings },
  { name: "E2E Грунты", handle: E2E_CATEGORY_HANDLES.primers, parent: E2E_CATEGORY_HANDLES.coatings },
  { name: "E2E Эмали", handle: E2E_CATEGORY_HANDLES.paints, parent: E2E_CATEGORY_HANDLES.coatings },
  { name: "E2E Расходные материалы", handle: E2E_CATEGORY_HANDLES.consumables },
  { name: "E2E Абразивы", handle: E2E_CATEGORY_HANDLES.abrasives, parent: E2E_CATEGORY_HANDLES.consumables },
  { name: "E2E Маскировка", handle: E2E_CATEGORY_HANDLES.masking, parent: E2E_CATEGORY_HANDLES.consumables },
]

const PRODUCTS: ProductDefinition[] = [
  { ...E2E_PRODUCT_FIXTURES.purchasable, category: E2E_CATEGORY_HANDLES.primers, brand: "E2E Novol", price: 790, stock: 9999 },
  { title: "E2E Лак для изменения доступности", ...E2E_PRODUCT_FIXTURES.mutableAvailability, category: E2E_CATEGORY_HANDLES.paints, brand: "E2E Mobihel", price: 2490, stock: 9999 },
  { ...E2E_PRODUCT_FIXTURES.lowStock, category: E2E_CATEGORY_HANDLES.abrasives, brand: "E2E Novol", price: 120, stock: 2 },
  { ...E2E_PRODUCT_FIXTURES.backorder, category: E2E_CATEGORY_HANDLES.paints, brand: "E2E Mobihel", price: 3100, stock: 0, allowBackorder: true },
  { ...E2E_PRODUCT_FIXTURES.unavailable, category: E2E_CATEGORY_HANDLES.primers, brand: "E2E Novol", price: 1150, stock: 0 },
  { ...E2E_PRODUCT_FIXTURES.unpublished, category: E2E_CATEGORY_HANDLES.primers, brand: "E2E Novol", price: 980, stock: 9999, status: ProductStatus.DRAFT },
  {
    title: "E2E Лак с полной карточкой", ...E2E_PRODUCT_FIXTURES.fullContent,
    category: E2E_CATEGORY_HANDLES.paints, brand: "E2E Mobihel", price: 4890, stock: 9999,
    images: [
      { url: "https://assets.example.test/e2e/clearcoat-front.jpg" },
      { url: "https://assets.example.test/e2e/clearcoat-back.jpg" },
      { url: "https://assets.example.test/e2e/clearcoat-detail.jpg" },
    ],
    metadata: {
      characteristics: { "Объём": "1 л", "Компоненты": "2K", "Блеск": "Высокий" },
      documents: [
        { id: "e2e-clearcoat-tds", name: "Техническая карта", url: "https://assets.example.test/e2e/clearcoat-tds.pdf" },
        { id: "e2e-clearcoat-sds", name: "Паспорт безопасности", url: "https://assets.example.test/e2e/clearcoat-sds.pdf" },
      ],
      video_urls: ["https://www.youtube.com/watch?v=e2e-clearcoat", "https://video.example.test/e2e/clearcoat"],
    },
  },
  { title: "E2E Эмаль синяя", handle: "e2e-enamel-blue", sku: "E2E-ENAMEL-BLUE", category: E2E_CATEGORY_HANDLES.paints, brand: "E2E Mobihel", price: 1750, stock: 9999 },
  { title: "E2E Эмаль красная", handle: "e2e-enamel-red", sku: "E2E-ENAMEL-RED", category: E2E_CATEGORY_HANDLES.paints, brand: "E2E Novol", price: 1890, stock: 9999 },
  { title: "E2E Круг P80", handle: "e2e-disc-p80", sku: "E2E-DISC-P80", category: E2E_CATEGORY_HANDLES.abrasives, brand: "E2E Novol", price: 85, stock: 9999 },
  { title: "E2E Круг P240", handle: "e2e-disc-p240", sku: "E2E-DISC-P240", category: E2E_CATEGORY_HANDLES.abrasives, brand: "E2E Mobihel", price: 95, stock: 9999 },
  { title: "E2E Малярная лента", handle: "e2e-masking-tape", sku: "E2E-MASKING-TAPE", category: E2E_CATEGORY_HANDLES.masking, brand: "E2E Novol", price: 260, stock: 9999 },
  { title: "E2E Плёнка укрывная", handle: "e2e-masking-film", sku: "E2E-MASKING-FILM", category: E2E_CATEGORY_HANDLES.masking, brand: "E2E Mobihel", price: 640, stock: 9999 },
  ...Array.from({ length: 18 }, (_, index): ProductDefinition => {
    const number = String(index + 1).padStart(2, "0")
    return {
      title: `E2E Каталожное покрытие ${number}`,
      handle: `e2e-catalog-coating-${number}`,
      sku: `E2E-CATALOG-COATING-${number}`,
      category: index % 2 === 0 ? E2E_CATEGORY_HANDLES.primers : E2E_CATEGORY_HANDLES.paints,
      brand: index % 2 === 0 ? "E2E Novol" : "E2E Mobihel",
      price: 500 + index * 175,
      stock: 9999,
    }
  }),
]

const FIXED_TIME = "2026-01-15T10:00:00.000Z"

function query(container: MedusaContainer) {
  return container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
}

async function first(container: MedusaContainer, entity: string, fields: string[], filters: Record<string, unknown>) {
  return (await query(container).graph({ entity, fields, filters })).data[0]
}

export async function baseline(container: MedusaContainer): Promise<CommerceBaselineResult> {
  const [salesChannel, region, stockLocation, shippingProfile, fulfillmentSet, serviceZone, shippingOption, store, publishableApiKey] = await Promise.all([
    first(container, "sales_channel", ["id", "name"], { name: COMMERCE_BASELINE.salesChannelName }),
    first(container, "region", ["id", "name", "currency_code"], { name: COMMERCE_BASELINE.regionName }),
    first(container, "stock_location", ["id", "name"], { name: COMMERCE_BASELINE.stockLocationName }),
    first(container, "shipping_profile", ["id", "name", "type"], { type: "default" }),
    first(container, "fulfillment_set", ["id", "name"], { name: COMMERCE_BASELINE.fulfillmentSetName }),
    first(container, "service_zone", ["id", "name"], { name: COMMERCE_BASELINE.serviceZoneName }),
    first(container, "shipping_option", ["id", "name"], { name: COMMERCE_BASELINE.shippingOptionName }),
    first(container, "store", ["id", "name", "metadata"], { name: COMMERCE_BASELINE.storeName }),
    first(container, "api_key", ["id", "title", "token"], { title: COMMERCE_BASELINE.apiKeyTitle }),
  ])
  const missing = { salesChannel, region, stockLocation, shippingProfile, fulfillmentSet, serviceZone, shippingOption, store, publishableApiKey }
  for (const [name, value] of Object.entries(missing)) {
    if (!value?.id) throw new Error(`E2E seed requires migrated commerce baseline: missing ${name}`)
  }
  return missing as CommerceBaselineResult
}

export async function seedCatalog(container: MedusaContainer, base: CommerceBaselineResult) {
  const categories = new Map<string, Record<string, any>>()
  for (const definition of CATEGORIES) {
    let category = await first(container, "product_category", ["id", "handle"], { handle: definition.handle })
    if (!category) {
      const parent = definition.parent ? categories.get(definition.parent) : undefined
      const { result } = await createProductCategoriesWorkflow(container).run({ input: { product_categories: [{ name: definition.name, handle: definition.handle, is_active: true, is_internal: false, parent_category_id: parent?.id }] } })
      category = result[0]
    }
    categories.set(definition.handle, category)
  }

  const products = new Map<string, Record<string, any>>()
  for (const definition of PRODUCTS) {
    let product = await first(container, "product", ["id", "handle", "title", "variants.id", "variants.sku", "variants.inventory_items.inventory_item_id"], { handle: definition.handle })
    if (!product) {
      const { result } = await createProductsWorkflow(container).run({ input: { products: [{
        title: definition.title,
        handle: definition.handle,
        description: `Детерминированный товар ${definition.title} для e2e-сценариев.`,
        status: definition.status ?? ProductStatus.PUBLISHED,
        category_ids: [categories.get(definition.category)!.id],
        shipping_profile_id: base.shippingProfile.id,
        images: definition.images,
        metadata: { brand: definition.brand, characteristics: { "Назначение": "E2E-проверка" }, ...definition.metadata },
        options: [{ title: "Упаковка", values: ["Стандарт"] }],
        variants: [{ title: "Стандарт", sku: definition.sku, manage_inventory: true, allow_backorder: definition.allowBackorder ?? false, options: { "Упаковка": "Стандарт" }, prices: [{ amount: definition.price, currency_code: "rub" }] }],
        sales_channels: [{ id: base.salesChannel.id }],
      }] } })
      product = await first(container, "product", ["id", "handle", "title", "variants.id", "variants.sku", "variants.inventory_items.inventory_item_id"], { id: result[0].id })
    }
    const inventoryItemId = product.variants[0].inventory_items[0].inventory_item_id
    const level = await first(container, "inventory_level", ["id", "inventory_item_id", "location_id"], { inventory_item_id: inventoryItemId, location_id: base.stockLocation.id })
    if (level) {
      await updateInventoryLevelsWorkflow(container).run({ input: { updates: [{ id: level.id, inventory_item_id: inventoryItemId, location_id: base.stockLocation.id, stocked_quantity: definition.stock }] } })
    } else {
      await createInventoryLevelsWorkflow(container).run({ input: { inventory_levels: [{ inventory_item_id: inventoryItemId, location_id: base.stockLocation.id, stocked_quantity: definition.stock }] } })
    }
    products.set(definition.handle, product)
  }
  return products
}

export async function seedPromotionCollection(container: MedusaContainer, products: Map<string, Record<string, any>>) {
  let collection = await first(container, "product_collection", ["id", "handle"], { handle: E2E_PROMOTION_COLLECTION.handle })
  if (!collection) {
    const { result } = await createCollectionsWorkflow(container).run({ input: { collections: [{
      title: E2E_PROMOTION_COLLECTION.title,
      handle: E2E_PROMOTION_COLLECTION.handle,
    }] } })
    collection = result[0]
  }

  const ids = E2E_PROMOTION_COLLECTION.productHandles
    .map((handle) => products.get(handle)?.id)
    .filter((id): id is string => Boolean(id))
  if (ids.length) {
    await updateProductsWorkflow(container).run({ input: { selector: { id: ids }, update: { collection_id: collection.id } } })
  }
}

async function registerIdentity(container: MedusaContainer, email: string, password: string) {
  const auth = container.resolve(Modules.AUTH) as IAuthModuleService
  const result = await auth.register("emailpass", { body: { email, password } })
  if (!result.success || !result.authIdentity?.id) throw new Error(`Unable to register ${email}: ${result.error ?? "unknown auth error"}`)
  return result.authIdentity.id
}

async function seedCustomer(container: MedusaContainer) {
  const existing = await first(container, "customer", ["id", "email"], { email: E2E_CUSTOMER.email })
  if (existing) return existing
  const authIdentityId = await registerIdentity(container, E2E_CUSTOMER.email, E2E_CUSTOMER.password)
  const { result } = await createCustomerAccountWorkflow(container).run({ input: { authIdentityId, customerData: { id: E2E_CUSTOMER.id, email: E2E_CUSTOMER.email, first_name: E2E_CUSTOMER.firstName, last_name: E2E_CUSTOMER.lastName, phone: E2E_CUSTOMER.phone } } as any })
  return result
}

export async function seedAdmins(container: MedusaContainer) {
  const rbac = container.resolve(Modules.RBAC) as IRbacModuleService
  let role = (await rbac.listRbacRoles({ name: E2E_RESTRICTED_ADMIN_ROLE_NAME }))[0]
  if (!role) {
    role = await rbac.createRbacRoles({ name: E2E_RESTRICTED_ADMIN_ROLE_NAME })
    const productReadPolicies = await rbac.listRbacPolicies({ resource: "product", operation: "read" })
    if (!productReadPolicies.length) throw new Error("RBAC product:read policy is missing")
    await rbac.createRbacRolePolicies(productReadPolicies.map((policy) => ({ role_id: role.id, policy_id: policy.id })))
  }
  for (const fixture of [E2E_ADMIN_WITH_ACCESS, E2E_ADMIN_WITHOUT_ACCESS]) {
    if (await first(container, "user", ["id", "email"], { email: fixture.email })) continue
    const authIdentityId = await registerIdentity(container, fixture.email, fixture.password)
    await createUserAccountWorkflow(container).run({ input: { authIdentityId, userData: { email: fixture.email, first_name: "E2E", last_name: fixture === E2E_ADMIN_WITH_ACCESS ? "Admin" : "Viewer", roles: [fixture === E2E_ADMIN_WITH_ACCESS ? "role_super_admin" : role.id] } } })
  }
}

async function seedCarts(container: MedusaContainer, base: CommerceBaselineResult, customerId: string, products: Map<string, Record<string, any>>) {
  const variantId = products.get(E2E_PRODUCT_FIXTURES.purchasable.handle)!.variants[0].id
  for (const [kind, id] of Object.entries(E2E_CART_IDS)) {
    if (await first(container, "cart", ["id"], { id })) continue
    await createCartWorkflow(container).run({ input: { id, region_id: base.region.id, sales_channel_id: base.salesChannel.id, customer_id: customerId, email: E2E_CUSTOMER.email, items: [{ variant_id: variantId, quantity: 1 }], metadata: { e2e_fixture: kind, seed_version: E2E_SEED_VERSION } } as any })
  }
  const reminders = container.resolve(ABANDONED_CART_REMINDER_MODULE) as AbandonedCartReminderModuleService
  const [existing] = await reminders.listAbandonedCartReminders({ cart_id: E2E_CART_IDS.abandoned })
  if (!existing) await reminders.createAbandonedCartReminders({ id: "abandoned_cart_reminder_e2e", cart_id: E2E_CART_IDS.abandoned, sent_at: new Date(FIXED_TIME), cart_updated_at_at_send: new Date(FIXED_TIME) } as any)
}

async function seedOrders(container: MedusaContainer, base: CommerceBaselineResult, customerId: string, products: Map<string, Record<string, any>>) {
  const product = products.get(E2E_PRODUCT_FIXTURES.purchasable.handle)!
  const variant = product.variants[0]
  for (const fixture of [{ key: "cancelable", displayId: E2E_ORDER_DISPLAY_IDS.cancelable }, { key: "non-cancelable", displayId: E2E_ORDER_DISPLAY_IDS.nonCancelable }]) {
    let order = await first(container, "order", ["id", "display_id", "status", "metadata"], { display_id: fixture.displayId })
    if (order && order.metadata?.e2e_fixture !== fixture.key) {
      throw new Error(`Order display_id ${fixture.displayId} is occupied by a non-E2E order`)
    }
    if (!order) {
      const { result } = await createOrderWorkflow(container).run({ input: {
        region_id: base.region.id, sales_channel_id: base.salesChannel.id, customer_id: customerId, email: E2E_CUSTOMER.email, currency_code: "rub", status: "pending",
        shipping_address: { first_name: E2E_CUSTOMER.firstName, last_name: E2E_CUSTOMER.lastName, phone: E2E_CUSTOMER.phone, ...E2E_SHIPPING_FIXTURE.address },
        items: [{ title: product.title, product_id: product.id, product_title: product.title, product_handle: product.handle, variant_id: variant.id, variant_sku: variant.sku, variant_title: "Стандарт", quantity: 1, unit_price: 790 }],
        shipping_methods: [{ name: "E2E доставка", amount: 490, shipping_option_id: base.shippingOption.id, data: { e2e: true } }],
        metadata: { e2e_fixture: fixture.key, expected_display_id: fixture.displayId, seed_version: E2E_SEED_VERSION }, no_notification: true,
      } })
      order = result
    }
    if (Number(order.display_id) !== fixture.displayId) throw new Error(`Expected E2E order display_id ${fixture.displayId}, got ${order.display_id}`)
    if (fixture.key === "non-cancelable" && order.status !== "completed") await completeOrderWorkflow(container).run({ input: { orderIds: [order.id] } })
  }
}

async function seedExternalConfigurations(
  container: MedusaContainer,
  base: CommerceBaselineResult
) {
  const payments = container.resolve(PAYMENT_PROVIDER_CONFIG_MODULE) as PaymentProviderConfigModuleService
  await payments.savePaymentProviderConfig({ provider_id: E2E_PROVIDER_IDS.paymentConfig, shop_id: "e2e-shop", secret_key: "e2e-provider-secret", mode: "test", is_enabled: true, actor_id: "e2e-seed" })
  await payments.setPaymentProviderAvailability({
    provider_id: E2E_PROVIDER_IDS.paymentConfig,
    store_id: base.store.id,
    region_id: base.region.id,
    is_enabled: true,
  })
}

async function seedHomepage(container: MedusaContainer) {
  const snapshots = container.resolve(CMS_SNAPSHOT_MODULE) as CmsSnapshotModuleService
  await persistCmsSnapshot(
    snapshots as any,
    CMS_HOMEPAGE_SNAPSHOT_KEY,
    E2E_HOMEPAGE_PUBLISHED as unknown as CmsHomepage
  )
}

export default async function e2eSeed({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  logger.info(`Seeding deterministic E2E fixtures (${E2E_SEED_VERSION})...`)
  const base = await baseline(container)
  const products = await seedCatalog(container, base)
  const customer = await seedCustomer(container)
  await seedAdmins(container)
  await seedPromotionCollection(container, products)
  await seedCarts(container, base, customer.id, products)
  await seedOrders(container, base, customer.id, products)
  await seedExternalConfigurations(container, base)
  await seedHomepage(container)
  logger.info(`Finished E2E seed. Preview draft '${E2E_PREVIEW.revision}' and token are fixtures for the T07 CMS stub; backend persists published content only.`)
}
