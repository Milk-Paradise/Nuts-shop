import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { baseline, seedAdmins, seedCatalog, seedPromotionCollection } from "./e2e-seed"

// Отдельно от e2e-seed.ts: тот сеет полный набор фикстур (клиент, корзины,
// заказы, настройки оплаты, CMS-главная) для одноразовой БД e2e-стенда. На
// живом окружении (qa-a) эти шаги задели бы настоящий payment-provider-config
// и настоящий снимок CMS — здесь только товары/категории/коллекция акций и
// тестовые админы (нужны почти всем сценариям: без них не пройти проверку
// доступа к разделу оплаты). Всё с префиксом handle/email "e2e" — безопасным
// для последующей выборочной очистки (см. e2e-cleanup-products.ts).
export default async function e2eSeedProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  logger.info("Seeding E2E product fixtures (live environment, products + admins)...")
  const base = await baseline(container)
  const products = await seedCatalog(container, base)
  await seedPromotionCollection(container, products)
  await seedAdmins(container)
  logger.info(`Finished seeding ${products.size} E2E product fixtures and admin accounts.`)
}
