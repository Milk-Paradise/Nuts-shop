export type AvailabilityStatus = "in_stock" | "backorder" | "out_of_stock"

export const availabilityRank: Record<AvailabilityStatus, number> = {
  in_stock: 0,
  backorder: 1,
  out_of_stock: 2,
}

type LocationLevel = {
  stocked_quantity?: number | string | null
  reserved_quantity?: number | string | null
}

type VariantInventoryItem = {
  required_quantity?: number | string | null
  inventory?: {
    location_levels?: LocationLevel[] | null
  } | null
}

export type AvailabilityVariant = {
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
  inventory_items?: VariantInventoryItem[] | null
}

function toQuantity(value: number | string | null | undefined) {
  const quantity = Number(value)
  return Number.isFinite(quantity) ? quantity : 0
}

function inventoryItemAvailable(item: VariantInventoryItem) {
  const levels = item.inventory?.location_levels ?? []
  const available = levels.reduce(
    (sum, level) =>
      sum + toQuantity(level.stocked_quantity) - toQuantity(level.reserved_quantity),
    0
  )
  const required = Math.max(1, toQuantity(item.required_quantity) || 1)

  return Math.floor(available / required)
}

export function variantAvailableQuantity(variant: AvailabilityVariant) {
  const items = variant.inventory_items ?? []

  if (!items.length) {
    return 0
  }

  return Math.min(...items.map((item) => inventoryItemAvailable(item)))
}

export function computeAvailability(
  availableQuantity: number,
  allowBackorder: boolean
): AvailabilityStatus {
  if (availableQuantity > 0) {
    return "in_stock"
  }

  return allowBackorder ? "backorder" : "out_of_stock"
}

export function variantAvailability(
  variant: AvailabilityVariant
): AvailabilityStatus {
  if (variant.manage_inventory === false) {
    return "in_stock"
  }

  return computeAvailability(
    variantAvailableQuantity(variant),
    !!variant.allow_backorder
  )
}

export function productAvailability(
  variants: AvailabilityVariant[] | null | undefined
): AvailabilityStatus {
  if (!variants?.length) {
    return "out_of_stock"
  }

  return variants
    .map((variant) => variantAvailability(variant))
    .reduce((best, status) =>
      availabilityRank[status] < availabilityRank[best] ? status : best
    )
}
