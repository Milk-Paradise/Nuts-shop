import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  listShippingOptionsForCartWorkflow,
  listShippingOptionsForCartWithPricingWorkflow,
} from "@medusajs/medusa/core-flows"

import {
  resolveShippingSelection,
  shippingOptionIdFromNormalizedId,
} from "../../api/catalog/shipping/utils"
import {
  STORE_PICKUP_NORMALIZED_OPTION_ID,
  isStorePickupAvailable,
  isStorePickupShippingOption,
  retrieveStorePickupSettings,
  type StorePickupSettings,
} from "../../modules/store-pickup/utils"
import type { ResolvedPickupPoint } from "./resolve-catalog-pickup-point"

type AvailableShippingOption = {
  id: string
  provider_id?: string | null
  shipping_profile_id?: string | null
  data?: Record<string, unknown> | null
  calculated_price?: { data?: any } | null
}

export type PreparedCatalogShippingSelection = {
  selected_id: string
  options: Array<{ id: string; data?: Record<string, unknown> }>
}

export function resolveStorePickupSelection(
  settings: StorePickupSettings | null,
  requiredProfileIds: string[],
  availableOptions: AvailableShippingOption[]
): PreparedCatalogShippingSelection {
  if (!settings || !isStorePickupAvailable(settings)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Самовывоз больше недоступен. Выберите другой способ получения."
    )
  }

  const pickupByProfile = new Map<string, AvailableShippingOption>()
  for (const option of availableOptions) {
    if (
      option.id &&
      option.shipping_profile_id &&
      isStorePickupShippingOption(option) &&
      !pickupByProfile.has(option.shipping_profile_id)
    ) {
      pickupByProfile.set(option.shipping_profile_id, option)
    }
  }
  const options = requiredProfileIds.map((profileId) => {
    const option = pickupByProfile.get(profileId)
    if (!option?.id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Самовывоз недоступен для части товаров корзины. Обновите способы получения."
      )
    }

    return {
      id: option.id,
      data: {
        store_pickup: {
          address: settings.address.trim(),
          hours: settings.hours.trim(),
        },
      },
    }
  })

  if (!options.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "В корзине нет товаров, требующих получения."
    )
  }

  return {
    selected_id: STORE_PICKUP_NORMALIZED_OPTION_ID,
    options,
  }
}

async function requiredShippingProfileIds(
  container: MedusaContainer,
  cartId: string
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph(
    {
      entity: "cart",
      fields: [
        "id",
        "items.requires_shipping",
        "items.variant.product.shipping_profile.id",
      ],
      filters: { id: cartId },
    },
    { throwIfKeyNotFound: true }
  )
  const cart = data[0] as {
    items?: Array<{
      requires_shipping?: boolean | null
      variant?: { product?: { shipping_profile?: { id?: string | null } | null } | null } | null
    }> | null
  } | undefined

  return Array.from(new Set(
    (cart?.items ?? [])
      .filter((item) => item.requires_shipping !== false)
      .map((item) => item.variant?.product?.shipping_profile?.id)
      .filter((id): id is string => !!id)
  ))
}

export const prepareCatalogShippingSelectionStep = createStep(
  "prepare-catalog-shipping-selection",
  async (
    input: {
      cart_id: string
      option_id: string
      point_id?: string
      pickup_point: ResolvedPickupPoint | null
    },
    { container }
  ) => {
    if (input.option_id === STORE_PICKUP_NORMALIZED_OPTION_ID) {
      const [settings, profileIds, available] = await Promise.all([
        retrieveStorePickupSettings(container),
        requiredShippingProfileIds(container, input.cart_id),
        listShippingOptionsForCartWorkflow(container).run({
          input: { cart_id: input.cart_id },
        }),
      ])

      return new StepResponse(
        resolveStorePickupSelection(
          settings,
          profileIds,
          available.result as AvailableShippingOption[]
        )
      )
    }

    const shippingOptionId = shippingOptionIdFromNormalizedId(input.option_id)
    const { result: shippingOptions } =
      await listShippingOptionsForCartWithPricingWorkflow(container).run({
        input: {
          cart_id: input.cart_id,
          options: [{ id: shippingOptionId }],
        },
      })
    const selection = resolveShippingSelection(
      shippingOptions as AvailableShippingOption[],
      input.option_id,
      input.point_id,
      input.pickup_point
    )

    return new StepResponse({
      selected_id: selection.shippingOptionId,
      options: [{ id: selection.shippingOptionId, data: selection.data }],
    })
  }
)

export const retrieveCatalogShippingMethodIdsStep = createStep(
  "retrieve-catalog-shipping-method-ids",
  async (input: { cart_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph(
      {
        entity: "cart",
        fields: ["id", "shipping_methods.id"],
        filters: { id: input.cart_id },
      },
      { throwIfKeyNotFound: true }
    )
    const cart = data[0] as {
      shipping_methods?: Array<{ id?: string | null }> | null
    } | undefined

    return new StepResponse({
      ids: (cart?.shipping_methods ?? [])
        .map((method) => method.id)
        .filter((id): id is string => !!id),
    })
  }
)
