import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { listNormalizedPickupPoints } from "../../api/catalog/shipping/utils"

export type ResolvedPickupPoint = {
  id: string
  provider_key: string
  external_id: string
  name: string
  address: string
}

type CartForPickupPoint = {
  shipping_address?: { city?: string | null } | null
}

// Выбранный пункт выдачи приходит одним идентификатором: адрес и название живут
// в справочнике перевозчика и в заказ сами не попадают. Заказ обязан отвечать на
// вопросы «куда» и «каким способом» без похода в чужое API, поэтому точка
// резолвится здесь один раз — при выборе способа доставки — и дальше едет вместе
// со способом доставки. Список пунктов по городу кэширован, лишнего обращения к
// перевозчику этот шаг не создаёт.
export const resolveCatalogPickupPointStep = createStep(
  "resolve-catalog-pickup-point",
  async (
    input: { cart_id: string; point_id?: string },
    { container }
  ): Promise<StepResponse<ResolvedPickupPoint | null>> => {
    if (!input.point_id) return new StepResponse(null)

    const separatorIndex = input.point_id.indexOf(":")
    if (separatorIndex <= 0 || separatorIndex === input.point_id.length - 1) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Pickup point id is not recognized"
      )
    }
    const carrier = input.point_id.slice(0, separatorIndex)

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph(
      {
        entity: "cart",
        fields: ["id", "shipping_address.city"],
        filters: { id: input.cart_id },
      },
      { throwIfKeyNotFound: true }
    )

    const city = (data[0] as CartForPickupPoint | undefined)?.shipping_address?.city
    if (!city) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cart has no city to look the pickup point up in"
      )
    }

    const points = await listNormalizedPickupPoints(container, city, carrier)
    const point = points.find((candidate) => candidate.id === input.point_id)

    if (!point) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Selected pickup point is no longer available, please pick again"
      )
    }

    return new StepResponse({
      id: point.id,
      provider_key: point.provider_key,
      external_id: point.external_id,
      name: point.name,
      address: point.address,
    })
  }
)
