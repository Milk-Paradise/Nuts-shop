import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"

import {
  CART_VERSIONING_MODULE,
} from "../../../../modules/cart"
import CartVersioningService, {
  ConflictError,
  type CartRecord,
  type UpdateCartByVersionData,
} from "../../../../modules/cart/service"
import type {
  GetCatalogCartQuery,
  UpdateCatalogCartBody,
} from "./validators"

type CatalogCart = Record<string, unknown> & {
  id: string
  items: unknown[]
  version: number
  updated_at: string | Date
}

type CartModuleService = {
  retrieveCart(
    id: string,
    config?: { relations?: string[] }
  ): Promise<unknown>
}

type CartConflictResponse = {
  code: "CART_VERSION_CONFLICT"
  message: string
  cart: CatalogCart
}

async function retrieveCatalogCart(
  req: MedusaRequest,
  id: string,
  version?: number
): Promise<CatalogCart> {
  const cartService = req.scope.resolve(Modules.CART) as CartModuleService
  const cart = (await cartService.retrieveCart(id, {
    relations: ["items"],
  })) as Record<string, unknown>
  // cart.version приходит от Modules.CART.retrieveCart всегда undefined:
  // version — поле отдельного shared-table partial-модуля cartVersioning,
  // его ORM-метаданные core Cart не видят (AIL-502 убрал совпадение имён,
  // на котором это раньше случайно держалось). Явный version от вызывающей
  // стороны (из updateCartByVersion/ConflictError, уже читающих version
  // прямым SQL) предпочтительнее; без него читаем тем же прямым SQL сами.
  const versioningService = req.scope.resolve(
    CART_VERSIONING_MODULE
  ) as CartVersioningService
  const resolvedVersion =
    version ?? (await versioningService.getVersion(id)) ?? undefined

  if (!Number.isSafeInteger(resolvedVersion) || resolvedVersion! < 0) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Cart ${id} does not expose a valid version`
    )
  }

  return {
    ...cart,
    id,
    items: Array.isArray(cart.items) ? cart.items : [],
    version: resolvedVersion!,
  } as CatalogCart
}

export async function GET(
  req: MedusaRequest<{}, GetCatalogCartQuery>,
  res: MedusaResponse<CatalogCart>
) {
  const cart = await retrieveCatalogCart(req, req.validatedQuery.cart_id)

  return res.status(200).json(cart)
}

export async function PUT(
  req: MedusaRequest<UpdateCatalogCartBody>,
  res: MedusaResponse<CatalogCart | CartConflictResponse>
) {
  const { cart_id, version, ...updates } = req.validatedBody
  const cartVersioningService = req.scope.resolve(
    CART_VERSIONING_MODULE
  ) as CartVersioningService

  try {
    const updated = await cartVersioningService.updateCartByVersion(
      cart_id,
      version,
      updates as UpdateCartByVersionData
    )
    const cart = await retrieveCatalogCart(req, cart_id, updated.version)

    return res.status(200).json(cart)
  } catch (error) {
    if (!(error instanceof ConflictError)) {
      throw error
    }

    const current = error.details as CartRecord
    const cart = await retrieveCatalogCart(req, cart_id, current.version)

    return res.status(409).json({
      code: "CART_VERSION_CONFLICT",
      message: error.message,
      cart,
    })
  }
}
