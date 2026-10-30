import type { ExecArgs, IRbacModuleService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  deleteCollectionsWorkflow,
  deleteProductCategoriesWorkflow,
  deleteProductsWorkflow,
  deleteRbacRolesWorkflow,
  deleteUsersWorkflow,
} from "@medusajs/medusa/core-flows"

import { CATEGORIES } from "./e2e-seed"
import {
  E2E_ADMIN_WITH_ACCESS,
  E2E_ADMIN_WITHOUT_ACCESS,
  E2E_PROMOTION_COLLECTION,
  E2E_RESTRICTED_ADMIN_ROLE_NAME,
} from "./e2e-seed-fixtures"

// Обратная сторона e2e-seed-products.ts: удаляет ровно то, что тот скрипт мог
// создать на живом окружении — товары и категории с handle, начинающимся на
// "e2e-", плюс их коллекцию акций. Выборка идёт по handle, а не по списку из
// e2e-seed.ts, поэтому находит и чистит фикстуры и в сценарии, где товар был
// заведён вручную с тем же префиксом. Реальный каталог МойСклад (handle без
// этого префикса) не задевается.
function query(container: MedusaContainer) {
  return container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph(input: { entity: string; fields: string[]; filters?: Record<string, unknown> }): Promise<{ data: Record<string, any>[] }>
  }
}

export default async function e2eCleanupProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const q = query(container)

  const { data: products } = await q.graph({
    entity: "product",
    fields: ["id", "handle"],
    filters: { handle: { $like: "e2e-%" } },
  })
  if (products.length) {
    await deleteProductsWorkflow(container).run({ input: { ids: products.map((p) => p.id) } })
  }
  logger.info(`Deleted ${products.length} E2E product fixtures.`)

  const { data: collections } = await q.graph({
    entity: "product_collection",
    fields: ["id", "handle"],
    filters: { handle: E2E_PROMOTION_COLLECTION.handle },
  })
  if (collections.length) {
    await deleteCollectionsWorkflow(container).run({ input: { ids: collections.map((c) => c.id) } })
  }

  // Категории удаляются от листьев к корню: родитель с живыми детьми не
  // уходит, а порядок в CATEGORIES уже объявлен родитель-перед-детьми.
  const { data: categories } = await q.graph({
    entity: "product_category",
    fields: ["id", "handle"],
    filters: { handle: { $like: "e2e-%" } },
  })
  const byHandle = new Map(categories.map((c) => [c.handle, c.id] as const))
  const orderedHandles = [...CATEGORIES.map((c) => c.handle)].reverse()
  for (const handle of orderedHandles) {
    const id = byHandle.get(handle)
    if (!id) continue
    await deleteProductCategoriesWorkflow(container).run({ input: [id] })
    byHandle.delete(handle)
  }
  // Любые оставшиеся e2e-категории вне известного списка — тоже под нож.
  const leftoverIds = [...byHandle.values()]
  if (leftoverIds.length) {
    await deleteProductCategoriesWorkflow(container).run({ input: leftoverIds })
  }
  logger.info(`Deleted ${categories.length} E2E category fixtures.`)

  // Пользователи — до роли: deleteRbacRolesWorkflow не трогает роли, ещё
  // назначенные пользователю. Снёсший только User (не AuthIdentity — для
  // неё нет delete-workflow) не мешает ни логину, ни очистке: без User вход
  // невозможен независимо от того, жива ли запись AuthIdentity. Единственное
  // следствие — повторный seed той же почты упадёт на regenerateIdentity,
  // если AuthIdentity не удалить руками через БД; на разовых ручных прогонах
  // это не встречалось.
  const { data: admins } = await q.graph({
    entity: "user",
    fields: ["id", "email"],
    filters: { email: [E2E_ADMIN_WITH_ACCESS.email, E2E_ADMIN_WITHOUT_ACCESS.email] },
  })
  if (admins.length) {
    await deleteUsersWorkflow(container).run({ input: { ids: admins.map((a) => a.id) } })
  }
  logger.info(`Deleted ${admins.length} E2E admin fixtures.`)

  const rbac = container.resolve(Modules.RBAC) as IRbacModuleService
  const [role] = await rbac.listRbacRoles({ name: E2E_RESTRICTED_ADMIN_ROLE_NAME })
  if (role) {
    await deleteRbacRolesWorkflow(container).run({ input: { ids: [role.id] } })
    logger.info("Deleted E2E restricted admin role.")
  }
}
