import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import type { SyncCatalogShippingAddressWorkflowInput } from "../sync-catalog-shipping-address"

type CartForCountryCode = {
  shipping_address?: { country_code?: string | null } | null
  region?: { countries?: Array<{ iso_2?: string | null }> | null } | null
}

// Pure and synthetic-data-testable on purpose (see __tests__): building
// "undefined, undefined" into address_1 for a city-only (ПВЗ) sync would
// silently corrupt the cart's shipping address instead of leaving it blank.
export function buildCatalogShippingAddressFields(input: {
  city: string
  street?: string
  house?: string
  apartment?: string
}): { city: string; address_1?: string; address_2?: string } {
  return {
    city: input.city,
    address_1: input.street && input.house ? `${input.street}, ${input.house}` : undefined,
    address_2: input.apartment || undefined,
  }
}

export async function prepareSyncCatalogShippingAddressUpdate(
  container: MedusaContainer,
  input: SyncCatalogShippingAddressWorkflowInput
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph(
    {
      entity: "cart",
      fields: ["id", "shipping_address.country_code", "region.countries.iso_2"],
      filters: { id: input.cart_id },
    },
    { throwIfKeyNotFound: true }
  )
  const cart = data[0] as CartForCountryCode | undefined
  const countryCode =
    cart?.shipping_address?.country_code ??
    cart?.region?.countries?.find((country) => country.iso_2)?.iso_2 ??
    null

  if (!countryCode) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Cart region does not include a country"
    )
  }

  return {
    id: input.cart_id,
    shipping_address: {
      ...buildCatalogShippingAddressFields(input),
      country_code: countryCode,
    },
  }
}

export const prepareSyncCatalogShippingAddressStep = createStep(
  "prepare-sync-catalog-shipping-address",
  async (input: SyncCatalogShippingAddressWorkflowInput, { container }) =>
    new StepResponse(await prepareSyncCatalogShippingAddressUpdate(container, input))
)
