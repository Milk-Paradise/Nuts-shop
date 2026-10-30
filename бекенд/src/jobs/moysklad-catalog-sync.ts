import type { MedusaContainer } from "@medusajs/framework/types"

import { isCronDue } from "../lib/cron-schedule"
import {
  MedusaCatalogReader,
  MedusaCatalogWriter,
  runCatalogImport,
} from "../scripts/import-moysklad-catalog"
import { MOYSKLAD_INTEGRATION_MODULE } from "../modules/moysklad-integration"
import {
  createMoyskladRateLimiter,
  isMoyskladCredentialsFailure,
} from "../modules/moysklad-integration/client"
import { decryptMoyskladCredentials } from "../modules/moysklad-integration/credentials"
import type MoyskladIntegrationService from "../modules/moysklad-integration/service"

let catalogSyncInProgress = false

export async function runMoyskladCatalogSyncJob(
  container: MedusaContainer,
  now = new Date()
) {
  if (catalogSyncInProgress) {
    container.resolve<any>("logger").info(
      "MoySklad catalog sync skipped: previous cycle is still running."
    )
    return false
  }

  const logger = container.resolve<any>("logger")
  const service = container.resolve<MoyskladIntegrationService>(
    MOYSKLAD_INTEGRATION_MODULE
  )
  const config = await service.getConnectionConfig()

  if (!config?.is_active || !config.encrypted_credentials) return false
  if (!isCronDue(config.catalog_sync_schedule ?? "0 * * * *", now)) return false

  catalogSyncInProgress = true
  try {
    const reader = new MedusaCatalogReader(container)
    const context = await reader.loadApplyContext()
    const throttle = createMoyskladRateLimiter()
    const credentials = decryptMoyskladCredentials(config.encrypted_credentials)
    const writer = new MedusaCatalogWriter(
      container,
      reader,
      await import("@medusajs/medusa/core-flows"),
      context,
      credentials,
      globalThis.fetch as never,
      throttle,
      async () => undefined
    )
    const report = await runCatalogImport({
      apply: true,
      credentials,
      reader,
      writer,
      logger,
      throttle,
    })

    if (report.processingErrors.length || report.imageFailures.length) {
      throw new Error(
        `Каталог синхронизирован с ошибками: обработка ${report.processingErrors.length}, изображения ${report.imageFailures.length}.`
      )
    }

    await service.recordCatalogSyncSuccess()
    logger.info(
      `MoySklad catalog sync completed: created ${report.created}, updated ${report.updated}.`
    )
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await service.recordCatalogSyncFailure(message)
    if (isMoyskladCredentialsFailure(error)) {
      await service.markCredentialsReentryRequired(message)
    }
    logger.error(`MoySklad catalog sync failed: ${message}`)
    return false
  } finally {
    catalogSyncInProgress = false
  }
}

export default async function moyskladCatalogSyncJob(
  container: MedusaContainer
) {
  if (process.env.E2E_RUN === "true") return
  await runMoyskladCatalogSyncJob(container)
}

export const config = {
  name: "moysklad-catalog-sync",
  schedule: "* * * * *",
}
