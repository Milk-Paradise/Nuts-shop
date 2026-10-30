import { z } from "zod"

export const availabilityValues = [
  "in_stock",
  "backorder",
  "out_of_stock",
] as const

function firstQueryValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value
}

const optionalTrimmedString = z.preprocess((value) => {
  const raw = firstQueryValue(value)

  if (typeof raw !== "string") {
    return undefined
  }

  const trimmed = raw.trim()
  return trimmed.length ? trimmed : undefined
}, z.string().optional())

const optionalPrice = z.preprocess((value) => {
  const raw = firstQueryValue(value)

  if (raw === undefined || raw === null || raw === "") {
    return undefined
  }

  const parsed = typeof raw === "number" ? raw : Number(raw)

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}, z.number().optional())

const optionalPositiveInteger = z.preprocess((value) => {
  const raw = firstQueryValue(value)

  if (raw === undefined || raw === null || raw === "") {
    return undefined
  }

  const parsed = typeof raw === "number" ? raw : Number(raw)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }

  return Math.floor(parsed)
}, z.number().int().positive().optional())

// Порядок выдачи задаёт backend, а не браузер: сортировать нужно всю выдачу,
// а не только текущую страницу. Неизвестное значение не валит запрос — как и
// для availability, оно молча падает в сортировку по умолчанию.
export const catalogSortValues = [
  "relevance",
  "price_asc",
  "price_desc",
  "title",
] as const

export type CatalogSort = (typeof catalogSortValues)[number]

function isCatalogSort(value: unknown): value is CatalogSort {
  return typeof value === "string" && catalogSortValues.includes(value as CatalogSort)
}

function isAvailability(value: unknown): value is (typeof availabilityValues)[number] {
  return (
    typeof value === "string" &&
    availabilityValues.includes(value as (typeof availabilityValues)[number])
  )
}

export const GetCatalogSearchSchema = z.object({
  q: optionalTrimmedString,
  category: optionalTrimmedString,
  category_id: optionalTrimmedString,
  brand: optionalTrimmedString,
  availability: z.preprocess((value) => {
    const raw = firstQueryValue(value)

    return isAvailability(raw) ? raw : undefined
  }, z.enum(availabilityValues).optional()),
  min_price: optionalPrice,
  max_price: optionalPrice,
  sort: z.preprocess((value) => {
    const raw = firstQueryValue(value)

    return isCatalogSort(raw) ? raw : "relevance"
  }, z.enum(catalogSortValues).default("relevance")),
  page: optionalPositiveInteger,
  limit: optionalPositiveInteger,
})

export type GetCatalogSearchQuery = z.infer<typeof GetCatalogSearchSchema>

export const GetCategoryProductsSchema = z.object({
  page: optionalPositiveInteger,
  subcategory: optionalTrimmedString,
})

export type GetCategoryProductsQuery = z.infer<
  typeof GetCategoryProductsSchema
>

const cartValidationItemSchema = z.object({
  variant_id: z.string().trim().min(1),
  quantity: z
    .number()
    .int()
    .min(1)
    .max(99)
    .catch(1),
})

export const ValidateCatalogCartSchema = z
  .object({
    skus: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
    items: z.array(cartValidationItemSchema).min(1).max(100).optional(),
  })
  .refine((value) => value.skus?.length || value.items?.length, {
    message: "Either skus or items must be provided",
  })

export type ValidateCatalogCartBody = z.infer<typeof ValidateCatalogCartSchema>

const checkoutPhone = z
  .string()
  .trim()
  .min(1)
  .regex(/^[+\d\s()-]+$/, "Phone contains unsupported characters")
  .refine((value) => {
    const digitCount = value.replace(/\D/g, "").length
    return digitCount >= 10 && digitCount <= 15
  }, "Phone must contain 10-15 digits")

export const CheckoutCatalogOrderSchema = z
  .object({
    cart_id: z.string().trim().min(1),
    name: z.string().trim().min(1).max(200),
    phone: checkoutPhone,
    email: z.string().trim().email(),
    city: z.string().trim().min(1),
    // Optional: a pickup-point (ПВЗ) checkout only carries the city — street/
    // house/apartment are courier-only (mirrors SyncCatalogShippingAddressSchema).
    street: z.string().trim().min(1).optional(),
    house: z.string().trim().min(1).optional(),
    apartment: z.string().trim().min(1).optional(),
    comment: z.string().max(1000).optional().default(""),
  })
  .strict()

export type CheckoutCatalogOrderBody = z.infer<typeof CheckoutCatalogOrderSchema>

export const InitiateCatalogPaymentSchema = z
  .object({
    order_id: z.string().trim().min(1),
    provider_id: z.string().trim().min(1),
    return_url: z.string().url(),
  })
  .strict()

export type InitiateCatalogPaymentBody = z.infer<
  typeof InitiateCatalogPaymentSchema
>

export const CheckCatalogPaymentStatusSchema = z
  .object({
    cart_id: z.string().trim().min(1),
  })
  .strict()

export type CheckCatalogPaymentStatusBody = z.infer<
  typeof CheckCatalogPaymentStatusSchema
>

export const GetShippingOptionsSchema = z.object({
  cart_id: z.preprocess((value) => firstQueryValue(value), z.string().trim().min(1)),
})

export type GetShippingOptionsQuery = z.infer<typeof GetShippingOptionsSchema>

export const GetShippingTariffsSchema = z.object({
  city: z.preprocess((value) => firstQueryValue(value), z.string().trim().min(1)),
  postal_code: optionalTrimmedString,
})

export type GetShippingTariffsQuery = z.infer<typeof GetShippingTariffsSchema>

export const GetPickupPointsSchema = z.object({
  city: z.preprocess((value) => firstQueryValue(value), z.string().trim().min(1)),
  provider_key: optionalTrimmedString,
  address: optionalTrimmedString,
})

export type GetPickupPointsQuery = z.infer<typeof GetPickupPointsSchema>

export const SyncCatalogShippingAddressSchema = z
  .object({
    cart_id: z.string().trim().min(1),
    city: z.string().trim().min(1),
    // Optional: a pickup-point (ПВЗ) quote only needs the city — street/house/
    // apartment are courier-only. When sent, they must still be non-empty.
    street: z.string().trim().min(1).optional(),
    house: z.string().trim().min(1).optional(),
    apartment: z.string().trim().min(1).optional(),
  })
  .strict()

export type SyncCatalogShippingAddressBody = z.infer<
  typeof SyncCatalogShippingAddressSchema
>

export const SelectCatalogShippingOptionSchema = z
  .object({
    cart_id: z.string().trim().min(1),
    option_id: z.string().trim().min(1),
    point_id: z.string().trim().min(1).optional(),
  })
  .strict()

export type SelectCatalogShippingOptionBody = z.infer<
  typeof SelectCatalogShippingOptionSchema
>
