import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  catalogOrderFixationFingerprint,
  CatalogOrderFixationConflictError,
  type CatalogOrderFixationInput,
} from "../../lib/catalog-order-fixation"
import { ORDER_FIXATION_MODULE } from "../../modules/order-fixation"
import type OrderFixationModuleService from "../../modules/order-fixation/service"

type OrderFixationRecord = {
  id: string
  cart_id: string
  request_fingerprint: string
  order_id: string | null
}

type OrderCartLink = {
  order_id: string
  cart_id: string
}

async function orderForCart(container: MedusaContainer, cartId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph(
    {
      entity: "order_cart",
      fields: ["order_id", "cart_id"],
      filters: { cart_id: cartId },
    },
    { throwIfKeyNotFound: false }
  )

  return (data as OrderCartLink[])[0]?.order_id ?? null
}

function assertFingerprintMatches(
  record: OrderFixationRecord,
  fingerprint: string
) {
  if (record.request_fingerprint !== fingerprint) {
    throw new CatalogOrderFixationConflictError()
  }
}

async function existingCatalogOrderFixation(
  container: MedusaContainer,
  input: CatalogOrderFixationInput
) {
  const service = container.resolve(
    ORDER_FIXATION_MODULE
  ) as OrderFixationModuleService
  const fingerprint = catalogOrderFixationFingerprint(input)
  const [existing] = (await service.listOrderFixations({
    cart_id: input.cart_id,
  })) as OrderFixationRecord[]

  if (!existing) return null

  assertFingerprintMatches(existing, fingerprint)
  if (existing.order_id) {
    return { fixation_id: existing.id, order_id: existing.order_id }
  }

  const relatedOrderId = await orderForCart(container, input.cart_id)
  if (relatedOrderId) {
    await service.updateOrderFixations({
      id: existing.id,
      order_id: relatedOrderId,
    })
    return { fixation_id: existing.id, order_id: relatedOrderId }
  }

  return { fixation_id: existing.id, order_id: null }
}

export async function prepareCatalogOrderFixation(
  container: MedusaContainer,
  input: CatalogOrderFixationInput
) {
  const existing = await existingCatalogOrderFixation(container, input)
  return existing ?? { fixation_id: null, order_id: null }
}

export async function claimCatalogOrderFixation(
  container: MedusaContainer,
  input: CatalogOrderFixationInput
) {
  const service = container.resolve(
    ORDER_FIXATION_MODULE
  ) as OrderFixationModuleService
  const fingerprint = catalogOrderFixationFingerprint(input)
  const existing = await existingCatalogOrderFixation(container, input)
  if (existing) return { fixation_id: existing.fixation_id }

  try {
    const created = (await service.createOrderFixations({
      cart_id: input.cart_id,
      request_fingerprint: fingerprint,
      order_id: null,
    })) as OrderFixationRecord

    return { fixation_id: created.id }
  } catch (error) {
    const concurrent = await existingCatalogOrderFixation(container, input)
    if (!concurrent) throw error
    return { fixation_id: concurrent.fixation_id }
  }
}

export const prepareCatalogOrderFixationStep = createStep(
  "prepare-catalog-order-fixation",
  async (input: CatalogOrderFixationInput, { container }) =>
    new StepResponse(await prepareCatalogOrderFixation(container, input))
)

export const claimCatalogOrderFixationStep = createStep(
  "claim-catalog-order-fixation",
  async (input: CatalogOrderFixationInput, { container }) =>
    new StepResponse(await claimCatalogOrderFixation(container, input))
)

export const completeCatalogOrderFixationStep = createStep(
  "complete-catalog-order-fixation",
  async (input: { fixation_id: string; order_id: string }, { container }) => {
    const service = container.resolve(
      ORDER_FIXATION_MODULE
    ) as OrderFixationModuleService
    await service.updateOrderFixations({
      id: input.fixation_id,
      order_id: input.order_id,
    })
    return new StepResponse(input)
  }
)
