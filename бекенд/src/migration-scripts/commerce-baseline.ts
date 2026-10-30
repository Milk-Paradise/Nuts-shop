import type { MedusaContainer } from "@medusajs/framework/types"

import { seedCommerceBaseline } from "../scripts/seed-commerce"

export default async function commerce_baseline({
  container,
}: {
  container: MedusaContainer
}) {
  await seedCommerceBaseline(container)
}
