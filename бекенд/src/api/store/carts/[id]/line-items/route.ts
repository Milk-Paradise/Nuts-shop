import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { ICartModuleService } from "@medusajs/framework/types"

import { addLineItemWithVersionWorkflow } from "../../../../../workflows/add-line-item-with-version"
import { CART_VERSIONING_MODULE } from "../../../../../modules/cart"
import type CartVersioningService from "../../../../../modules/cart/service"
import type { AddLineItemBody, AddLineItemQuery } from "./validators"

type LineItemsResponse = {
  cart: any
}

type CartConflictResponse = {
  code: "CART_VERSION_CONFLICT"
  message: string
  cart: any
}

// Витрина (storeRequest<StoreCartResponse>) ждёт от ЛЮБОЙ мутации корзины
// { cart: {...} } — так отвечает каждый core-маршрут Medusa (update quantity,
// create). Плоский { id, cart_id, variant_id, quantity, version } ломал
// normalizeCart на фронте: cart оказывался undefined, и успешный ответ 200
// обрабатывался как ошибка (баг найден live e2e-прогоном на qa-a).
async function retrieveCartForResponse(
  req: MedusaRequest,
  cart_id: string,
  version: number
) {
  const cartService = req.scope.resolve<ICartModuleService>(Modules.CART)
  const cart = (await cartService.retrieveCart(cart_id, {
    relations: ["items"],
  })) as any
  return {
    id: cart?.id,
    version,
    items: cart?.items || [],
    updated_at: cart?.updated_at,
    currency_code: cart?.currency_code,
    email: cart?.email,
  }
}

type InvalidDataResponse = {
  type: "invalid_data"
  message: string
}

export async function POST(
  req: MedusaRequest<AddLineItemBody, AddLineItemQuery>,
  res: MedusaResponse<
    LineItemsResponse | CartConflictResponse | InvalidDataResponse
  >
) {
  const { id: cart_id } = req.params
  const { variant_id, quantity } = req.validatedBody
  const versionHeader = req.headers["x-cart-version"]
  const version =
    typeof versionHeader === "string" && versionHeader.trim() !== ""
      ? Number(versionHeader)
      : Number.NaN

  if (!Number.isSafeInteger(version) || version < 0) {
    return res.status(400).json({
      type: "invalid_data",
      message: "X-Cart-Version must be a non-negative safe integer",
    })
  }

  try {
    const { result } = await addLineItemWithVersionWorkflow(req.scope).run({
      input: {
        cart_id,
        expected_version: version,
        variant_id,
        quantity,
      },
    })

    return res.status(200).json({
      cart: await retrieveCartForResponse(req, cart_id, result.version),
    })
  } catch (error) {
    // workflow-engine-redis хранит состояние транзакции через JSON.stringify
    // (см. workflow-orchestrator-storage.js), поэтому ошибка шага доходит сюда
    // как обычный объект, а не экземпляр MedusaError — instanceof всегда false.
    // Core-хендлер (error-handler.js) и так матчит по error?.type без instanceof;
    // здесь делаем то же самое, иначе конфликт уходит в generic-обработчик ядра.
    if ((error as { type?: string })?.type === MedusaError.Types.CONFLICT) {
      // version в ответе core Cart module не читается (см. комментарий в
      // checkCartVersionStep): подмешивается отдельным прямым SQL-чтением.
      const versioningService = req.scope.resolve<CartVersioningService>(
        CART_VERSIONING_MODULE
      )
      const version = await versioningService.getVersion(cart_id)
      return res.status(409).json({
        code: "CART_VERSION_CONFLICT",
        message: error.message,
        cart: await retrieveCartForResponse(req, cart_id, version as number),
      })
    }

    throw error
  }
}
