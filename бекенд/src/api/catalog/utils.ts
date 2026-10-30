import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"

import {
  availabilityRank,
  productAvailability,
  variantAvailableQuantity,
  variantAvailability,
  type AvailabilityStatus,
  type AvailabilityVariant,
} from "../../utils/availability"
import { cachedPublicCatalogList } from "./public-list-cache"

export type CatalogAvailability = AvailabilityStatus

export type CatalogProduct = {
  id: string
  title: string
  variant_id: string | null
  article: string | null
  price: number
  availability: CatalogAvailability
  max_quantity?: number | null
  category: string
  brand?: string | null
  image_url?: string | null
}

export type CatalogProductVariant = {
  id: string
  title: string
  article: string | null
  price: number
  availability: CatalogAvailability
  max_quantity: number | null
  options: Record<string, string>
}

export type CatalogProductDocument = {
  name: string
  url: string
}

export type CatalogProductDetail = CatalogProduct & {
  description?: string | null
  characteristics?: Record<string, string> | null
  documents?: CatalogProductDocument[]
  video_urls?: string[]
  variants?: CatalogProductVariant[]
}

export type ValidatedCartItem = {
  sku: string
  product: (CatalogProduct & { article: string; image_url: string | null }) | null
  purchasable: boolean
  problem: "not_found" | "invalid_product" | "out_of_stock" | null
}

export type CatalogCartValidationInput = {
  variant_id: string
  quantity: number
}

export type ValidatedCatalogCartItem = {
  variant_id: string
  quantity: number
  product: (CatalogProduct & { image_url: string | null }) | null
  purchasable: boolean
  problem:
    | "not_found"
    | "invalid_product"
    | "out_of_stock"
    | "insufficient_stock"
    | null
  available_quantity: number | null
}

type ProductPrice = {
  amount?: number | string | null
  currency_code?: string | null
}

type ProductVariant = AvailabilityVariant & {
  id?: string
  title?: string | null
  sku?: string | null
  options?:
    | { value?: string | null; option?: { title?: string | null } | null }[]
    | Record<string, string | null | undefined>
    | null
  prices?: ProductPrice[] | null
  price_set?: {
    prices?: ProductPrice[] | null
  } | null
}

type ProductCategory = {
  name?: string | null
}

export type CatalogSourceProduct = {
  id?: string
  title?: string | null
  description?: string | null
  status?: string | null
  thumbnail?: string | null
  metadata?: Record<string, unknown> | null
  categories?: ProductCategory[] | null
  variants?: ProductVariant[] | null
}

export const catalogProductFields = [
  "id",
  "title",
  "description",
  "status",
  "thumbnail",
  "metadata",
  "categories.id",
  "categories.name",
  "variants.id",
  "variants.title",
  "variants.sku",
  "variants.options.value",
  "variants.options.option.title",
  "variants.price_set.prices.amount",
  "variants.price_set.prices.currency_code",
  "variants.manage_inventory",
  "variants.allow_backorder",
  "variants.inventory_items.required_quantity",
  "variants.inventory_items.inventory.location_levels.stocked_quantity",
  "variants.inventory_items.inventory.location_levels.reserved_quantity",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ru")
}

function metadataString(product: CatalogSourceProduct, key: string) {
  const value = product.metadata?.[key]
  return typeof value === "string" && value.trim().length ? value.trim() : null
}

function metadataCharacteristics(product: CatalogSourceProduct) {
  const value = product.metadata?.characteristics

  if (!isRecord(value)) {
    return null
  }

  const characteristics = Object.entries(value).reduce<Record<string, string>>(
    (result, [key, item]) => {
      if (!key.trim() || typeof item !== "string" || !item.trim()) {
        return result
      }

      result[key] = item
      return result
    },
    {}
  )

  return Object.keys(characteristics).length ? characteristics : null
}

function normalizedHttpUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null
  }

  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:"
      ? value.trim()
      : null
  } catch {
    return null
  }
}

function metadataHttpUrls(product: CatalogSourceProduct, key: string) {
  const value = product.metadata?.[key]
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const url = normalizedHttpUrl(item)
        return url ? [url] : []
      })
    : []
}

function metadataDocuments(product: CatalogSourceProduct) {
  const value = product.metadata?.documents

  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item): CatalogProductDocument[] => {
    if (!isRecord(item)) {
      return []
    }

    const id = typeof item.id === "string" ? item.id.trim() : ""
    const name = typeof item.name === "string" ? item.name.trim() : ""
    const url = normalizedHttpUrl(item.url)

    return id && name && url ? [{ name, url }] : []
  })
}

function variantPrices(variant: ProductVariant) {
  return variant.price_set?.prices ?? variant.prices ?? []
}

function variantPrice(variant: ProductVariant) {
  const prices = variantPrices(variant)
    .map((price) => ({
      amount: Number(price.amount),
      currency_code: price.currency_code,
    }))
    .filter((price) => Number.isFinite(price.amount) && price.amount > 0)

  if (!prices.length) {
    return null
  }

  const rubPrices = prices.filter((price) => price.currency_code === "rub")
  const selectedPrices = rubPrices.length ? rubPrices : prices

  return Math.min(...selectedPrices.map((price) => price.amount))
}

function productPrice(product: CatalogSourceProduct) {
  const prices = product.variants
    ?.flatMap((variant) => variantPrices(variant))
    .map((price) => ({
      amount: Number(price.amount),
      currency_code: price.currency_code,
    }))
    .filter((price) => Number.isFinite(price.amount) && price.amount > 0)

  if (!prices?.length) {
    return null
  }

  const rubPrices = prices.filter((price) => price.currency_code === "rub")
  const selectedPrices = rubPrices.length ? rubPrices : prices

  return Math.min(...selectedPrices.map((price) => price.amount))
}

function productCategory(product: CatalogSourceProduct) {
  return (
    product.categories
      ?.map((category) => category.name?.trim())
      .find((name): name is string => !!name) ?? null
  )
}

function findVariantBySku(product: CatalogSourceProduct, sku: string) {
  return (
    product.variants?.find((variant) => variant.sku?.trim() === sku.trim()) ??
    null
  )
}

function findVariantById(product: CatalogSourceProduct, variantId: string) {
  return product.variants?.find((variant) => variant.id === variantId) ?? null
}

function variantOptionRecord(variant: ProductVariant) {
  if (!variant.options) {
    return {}
  }

  if (!Array.isArray(variant.options)) {
    return Object.entries(variant.options).reduce<Record<string, string>>(
      (result, [key, value]) => {
        if (key.trim() && typeof value === "string" && value.trim()) {
          result[key] = value.trim()
        }

        return result
      },
      {}
    )
  }

  return variant.options.reduce<Record<string, string>>((result, option) => {
    const title = option.option?.title?.trim()
    const value = option.value?.trim()

    if (title && value) {
      result[title] = value
    }

    return result
  }, {})
}

function variantTitle(variant: ProductVariant, options: Record<string, string>) {
  const title = variant.title?.trim()

  if (title) {
    return title
  }

  const optionValues = Object.values(options)

  return optionValues.length
    ? optionValues.join(" / ")
    : variant.sku?.trim() ?? "Вариант"
}

function productDetailVariants(product: CatalogSourceProduct) {
  return (product.variants ?? [])
    .map((variant): CatalogProductVariant | null => {
      const id = variant.id
      const price = variantPrice(variant)

      if (!id || price === null) {
        return null
      }

      const options = variantOptionRecord(variant)

      return {
        id,
        title: variantTitle(variant, options),
        article: variant.sku?.trim() || null,
        price,
        availability: variantAvailability(variant),
        max_quantity: variantMaximumOrderQuantity(variant),
        options,
      }
    })
    .filter((variant): variant is CatalogProductVariant => !!variant)
}

function variantMaximumOrderQuantity(variant: ProductVariant) {
  if (variant.manage_inventory === false || variant.allow_backorder) {
    return null
  }

  return Math.max(0, variantAvailableQuantity(variant))
}

function variantForDirectPurchase(
  product: CatalogSourceProduct,
  variants: CatalogProductVariant[],
  options: { sku?: string; variantId?: string }
) {
  if (options.variantId) {
    return findVariantById(product, options.variantId)
  }

  const sku = options.sku

  if (sku) {
    return findVariantBySku(product, sku)
  }

  return variants.length === 1
    ? product.variants?.find((variant) => variant.id === variants[0].id) ?? null
    : null
}

export function mapCatalogProduct(
  product: CatalogSourceProduct,
  options: { includeDetails?: boolean; sku?: string; variantId?: string } = {}
): CatalogProductDetail | null {
  if (product.status !== ProductStatus.PUBLISHED) {
    return null
  }

  const id = product.id
  const title = product.title?.trim()
  const price = productPrice(product)
  const category = productCategory(product)

  if (!id || !title || price === null || !category) {
    return null
  }

  const variants = productDetailVariants(product)
  const purchaseVariant = variantForDirectPurchase(product, variants, options)
  const purchaseVariantPrice = purchaseVariant ? variantPrice(purchaseVariant) : null
  const purchaseArticle = purchaseVariant?.sku?.trim() || null
  const requiresSpecificVariant = !!(options.sku || options.variantId)

  if (requiresSpecificVariant && (!purchaseVariant || purchaseVariantPrice === null)) {
    return null
  }

  const availability = purchaseVariant
    ? variantAvailability(purchaseVariant)
    : productAvailability(product.variants)

  const mapped: CatalogProductDetail = {
    id,
    title,
    variant_id: purchaseVariant?.id ?? null,
    article: options.sku ?? purchaseArticle,
    price: purchaseVariantPrice ?? price,
    availability,
    ...(purchaseVariant
      ? { max_quantity: variantMaximumOrderQuantity(purchaseVariant) }
      : {}),
    category,
    brand: metadataString(product, "brand"),
    image_url: product.thumbnail ?? null,
  }

  if (options.includeDetails) {
    mapped.description = product.description ?? null
    mapped.characteristics = metadataCharacteristics(product)
    mapped.documents = metadataDocuments(product)
    mapped.video_urls = metadataHttpUrls(product, "video_urls")
    mapped.variants = variants

    if (!purchaseVariant && variants.length > 1) {
      mapped.article = null
    }
  }

  return mapped
}

function relevance(product: CatalogProduct, query: string) {
  const search = normalize(query)
  const title = normalize(product.title)
  const article = product.article ? normalize(product.article) : ""

  if (article === search) {
    return 0
  }

  if (article.includes(search)) {
    return 1
  }

  if (title.startsWith(search)) {
    return 2
  }

  return title.includes(search) ? 3 : 4
}

export function sortCatalogProducts(products: CatalogProduct[], query?: string) {
  return [...products].sort((left, right) => {
    const availabilityDiff =
      availabilityRank[left.availability] - availabilityRank[right.availability]

    if (availabilityDiff !== 0) {
      return availabilityDiff
    }

    if (query) {
      const relevanceDiff = relevance(left, query) - relevance(right, query)

      if (relevanceDiff !== 0) {
        return relevanceDiff
      }
    }

    return left.title.localeCompare(right.title, "ru")
  })
}

async function queryProducts(
  container: MedusaContainer,
  filters: Record<string, unknown>,
  pagination: { take?: number; order?: Record<string, "ASC" | "DESC"> } = {}
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: catalogProductFields,
    filters,
    pagination: {
      take: pagination.take ?? 500,
      skip: 0,
      ...(pagination.order ? { order: pagination.order } : {}),
    },
  })

  return data as CatalogSourceProduct[]
}

const PROMOTIONS_COLLECTION_TITLE = "Акции"

async function findPromotionsCollectionId(container: MedusaContainer) {
  const productModuleService = container.resolve(Modules.PRODUCT)
  const collections = await productModuleService.listProductCollections(
    { title: PROMOTIONS_COLLECTION_TITLE },
    { take: 1 }
  )

  return collections[0]?.id ?? null
}

export async function listPromotedCatalogProducts(container: MedusaContainer) {
  return cachedPublicCatalogList(
    container,
    "catalog:public-list:v1:promotions",
    async () => {
      const collectionId = await findPromotionsCollectionId(container)

      if (!collectionId) {
        return []
      }

      const products = await queryProducts(
        container,
        { status: ProductStatus.PUBLISHED, collection_id: collectionId },
        { order: { created_at: "DESC" } }
      )

      return products
        .map((product) => mapCatalogProduct(product))
        .filter((product): product is CatalogProduct => !!product)
    }
  )
}

const NEW_ARRIVALS_LIMIT = 12

export async function listNewCatalogProducts(container: MedusaContainer) {
  return cachedPublicCatalogList(
    container,
    "catalog:public-list:v1:new-arrivals",
    async () => {
      const products = await queryProducts(
        container,
        { status: ProductStatus.PUBLISHED },
        { take: NEW_ARRIVALS_LIMIT, order: { created_at: "DESC" } }
      )

      return products
        .map((product) => mapCatalogProduct(product))
        .filter((product): product is CatalogProduct => !!product)
    }
  )
}

export async function retrieveCatalogProduct(
  container: MedusaContainer,
  id: string
) {
  const products = await queryProducts(container, {
    id,
    status: ProductStatus.PUBLISHED,
  })

  return mapCatalogProduct(products[0] ?? {}, { includeDetails: true })
}

export async function validateCatalogCart(
  container: MedusaContainer,
  skus: string[]
): Promise<ValidatedCartItem[]> {
  const uniqueSkus = Array.from(new Set(skus))
  const products = await queryProducts(container, {
    status: ProductStatus.PUBLISHED,
    variants: {
      sku: uniqueSkus,
    },
  })

  return skus.map((sku) => {
    const product = products.find((item) => findVariantBySku(item, sku))

    if (!product) {
      return {
        sku,
        product: null,
        purchasable: false,
        problem: "not_found",
      }
    }

    const mapped = mapCatalogProduct(product, { sku })

    if (!mapped || !mapped.article) {
      return {
        sku,
        product: null,
        purchasable: false,
        problem: "invalid_product",
      }
    }

    return {
      sku,
      product: {
        ...mapped,
        article: mapped.article,
        image_url: mapped.image_url ?? null,
      },
      purchasable: mapped.availability !== "out_of_stock",
      problem: mapped.availability === "out_of_stock" ? "out_of_stock" : null,
    }
  })
}

export async function validateCatalogCartItems(
  container: MedusaContainer,
  items: CatalogCartValidationInput[]
): Promise<ValidatedCatalogCartItem[]> {
  const uniqueVariantIds = Array.from(new Set(items.map((item) => item.variant_id)))
  const products = await queryProducts(container, {
    status: ProductStatus.PUBLISHED,
    variants: {
      id: uniqueVariantIds,
    },
  })

  return items.map((item) => {
    const product = products.find((entry) =>
      findVariantById(entry, item.variant_id)
    )

    if (!product) {
      return {
        variant_id: item.variant_id,
        quantity: item.quantity,
        product: null,
        purchasable: false,
        problem: "not_found",
        available_quantity: null,
      }
    }

    const variant = findVariantById(product, item.variant_id)
    const mapped = mapCatalogProduct(product, { variantId: item.variant_id })

    if (!variant || !mapped || mapped.variant_id !== item.variant_id) {
      return {
        variant_id: item.variant_id,
        quantity: item.quantity,
        product: null,
        purchasable: false,
        problem: "invalid_product",
        available_quantity: null,
      }
    }

    const availableQuantity =
      variant.manage_inventory === false
        ? null
        : variantAvailableQuantity(variant)
    const hasInsufficientStock =
      availableQuantity !== null &&
      !variant.allow_backorder &&
      item.quantity > availableQuantity
    const problem =
      mapped.availability === "out_of_stock"
        ? "out_of_stock"
        : hasInsufficientStock
          ? "insufficient_stock"
          : null

    return {
      variant_id: item.variant_id,
      quantity: item.quantity,
      product: {
        ...mapped,
        image_url: mapped.image_url ?? null,
      },
      purchasable: problem === null,
      problem,
      available_quantity: availableQuantity,
    }
  })
}
