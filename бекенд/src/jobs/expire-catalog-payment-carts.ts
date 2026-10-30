import type {
  IPaymentModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

import { paymentProviderRegistry } from "../modules/payment-provider-config/registry"
import { expireCatalogPaymentCartWorkflow } from "../workflows/expire-catalog-payment-cart"
import { CATALOG_PAYMENT_EXPIRATION_HOURS } from "../workflows/steps/expire-catalog-payment-cart"

const PAGE_SIZE = 100

export async function expireAbandonedCatalogPaymentCarts(
  container: MedusaContainer,
  now = new Date()
) {
  const paymentService = container.resolve(
    Modules.PAYMENT
  ) as IPaymentModuleService
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const providerIds = paymentProviderRegistry.map(
    (provider) => provider.medusa_id
  )
  const cutoff = new Date(
    now.getTime() - CATALOG_PAYMENT_EXPIRATION_HOURS * 60 * 60 * 1000
  ).toISOString()
  const cartIds = new Set<string>()
  let skip = 0

  while (true) {
    const sessions = await paymentService.listPaymentSessions(
      {
        provider_id: providerIds,
        updated_at: { $lte: cutoff },
      },
      {
        select: ["payment_collection_id"],
        take: PAGE_SIZE,
        skip,
      }
    )
    const paymentCollectionIds = Array.from(
      new Set(sessions.map((session) => session.payment_collection_id))
    )

    if (paymentCollectionIds.length) {
      const { data: links } = await query.graph({
        entity: "cart_payment_collection",
        fields: ["cart_id"],
        filters: { payment_collection_id: paymentCollectionIds },
      })

      for (const link of links) {
        if (typeof link.cart_id === "string" && link.cart_id) {
          cartIds.add(link.cart_id)
        }
      }
    }

    if (sessions.length < PAGE_SIZE) {
      break
    }

    skip += PAGE_SIZE
  }

  let expired = 0

  for (const cartId of cartIds) {
    const { result } = await expireCatalogPaymentCartWorkflow(container).run({
      input: { cart_id: cartId, now: now.toISOString() },
    })

    if (result.expired) {
      expired += 1
    }
  }

  return expired
}

export default async function expireCatalogPaymentCartsJob(
  container: MedusaContainer
) {
  if (process.env.E2E_RUN === "true") return
  await expireAbandonedCatalogPaymentCarts(container)
}

export const config = {
  name: "expire-catalog-payment-carts",
  schedule: "*/5 * * * *",
}
