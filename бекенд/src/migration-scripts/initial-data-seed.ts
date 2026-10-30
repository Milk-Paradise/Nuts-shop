import type { MedusaContainer } from "@medusajs/framework/types"

import { seedCommerceBaseline } from "../scripts/seed-commerce"

export default async function initial_data_seed({
  container,
}: {
  container: MedusaContainer
}) {
  await seedCommerceBaseline(container)
}
