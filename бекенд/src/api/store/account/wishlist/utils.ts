import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { WISHLIST_MODULE } from "../../../../modules/wishlist"
import type WishlistModuleService from "../../../../modules/wishlist/service"
import { retrieveCatalogProduct } from "../../../catalog/utils"

const PAGE_SIZE = 10

export function requireCustomerId(req: AuthenticatedMedusaRequest): string {
  const customerId = req.auth_context.actor_id

  if (!customerId) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Authentication required"
    )
  }

  return customerId
}

function wishlistService(scope: MedusaRequest["scope"]) {
  return scope.resolve(WISHLIST_MODULE) as WishlistModuleService
}

export async function addWishlistItem(
  scope: MedusaRequest["scope"],
  customerId: string,
  productId: string
) {
  const service = wishlistService(scope)
  const existing = await service.listWishlistItems({
    customer_id: customerId,
    product_id: productId,
  })

  if (existing.length) return existing[0]

  try {
    return await service.createWishlistItems({
      customer_id: customerId,
      product_id: productId,
    })
  } catch (error) {
    // Check-then-create isn't atomic — a concurrent double-click can lose
    // the race to the compound unique index. Rather than surface that as an
    // error, treat it the same as the check-first branch above: whichever
    // request actually inserted the row wins, the other just returns it.
    const [raceWinner] = await service.listWishlistItems({
      customer_id: customerId,
      product_id: productId,
    })

    if (raceWinner) return raceWinner

    throw error
  }
}

export async function removeWishlistItem(
  scope: MedusaRequest["scope"],
  customerId: string,
  productId: string
) {
  const service = wishlistService(scope)

  await service.deleteWishlistItems({
    customer_id: customerId,
    product_id: productId,
  })
}

// Лёгкая выборка для UI-иконки "в избранном" на карточках товара/каталога —
// без пагинации и без обогащения данными товара (иначе для проверки
// состояния иконки на N карточках каталога пришлось бы грузить N товаров).
export async function listWishlistProductIds(
  scope: MedusaRequest["scope"],
  customerId: string
) {
  const service = wishlistService(scope)
  const items = await service.listWishlistItems({ customer_id: customerId })

  return items.map((item) => item.product_id)
}

// Пагинация считается по видимым (доступным) товарам, а не по сырым строкам
// wishlist_item — иначе снятые с публикации/удалённые товары сдвигали бы
// разбиение на страницы. Список избранного обычно небольшой, поэтому
// фильтрация в памяти (как в account/orders/utils.ts для bucket) безопасна.
export async function listWishlistItems(
  scope: MedusaRequest["scope"],
  customerId: string,
  offset: number
) {
  const service = wishlistService(scope)
  const items = await service.listWishlistItems(
    { customer_id: customerId },
    { order: { created_at: "DESC" } }
  )

  const products = await Promise.all(
    items.map((item) => retrieveCatalogProduct(scope, item.product_id))
  )

  const visible = items
    .map((item, index) => ({ item, product: products[index] }))
    .filter(
      (entry): entry is { item: (typeof items)[number]; product: NonNullable<(typeof products)[number]> } =>
        !!entry.product
    )

  const page = visible.slice(offset, offset + PAGE_SIZE)

  return {
    items: page.map(({ item, product }) => ({
      id: item.id,
      product_id: item.product_id,
      created_at: item.created_at,
      product,
    })),
    count: visible.length,
  }
}
