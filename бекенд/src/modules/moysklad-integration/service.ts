import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import {
  MoyskladCredentialsReentryError,
  type MoyskladCredentials,
  encryptMoyskladCredentials,
  readMoyskladCredentials,
} from "./credentials"
import MoyskladConnectionConfig from "./models/moysklad-connection-config"
import MoyskladOrderSync from "./models/moysklad-order-sync"
import { MAX_ORDER_SYNC_ATTEMPTS } from "./retry-schedule"
import type { MoyskladUnmatchedItem } from "./stock-sync-report"

const CONNECTION_CONFIG_ID = "default"

export type SaveMoyskladConnectionConfigInput = {
  credentials: MoyskladCredentials
  isActive?: boolean
}

export type MoyskladOrderSyncStatus = "pending" | "synced" | "error" | "syncing"

export type RecordMoyskladOrderSyncAttemptInput = {
  orderId: string
  status: MoyskladOrderSyncStatus
  moyskladOrderId?: string | null
  lastError?: string | null
  retryable?: boolean
}

export type RecordMoyskladCancellationAttemptInput = {
  orderId: string
  status: MoyskladOrderSyncStatus
  lastError?: string | null
}

export type RecordMoyskladPaymentAttemptInput = {
  orderId: string
  status: MoyskladOrderSyncStatus
  paidAt?: Date
  externalCode?: string
  moyskladPaymentId?: string | null
  lastError?: string | null
}

export type RecordMoyskladFulfillmentAttemptInput = {
  orderId: string
  status: MoyskladOrderSyncStatus
  moyskladDemandId?: string | null
  lastError?: string | null
}

class MoyskladIntegrationService extends MedusaService({
  MoyskladConnectionConfig,
  MoyskladOrderSync
}) {
  async getConnectionConfig(decryptCredentials = true) {
    const [config] = await this.listMoyskladConnectionConfigs({
      id: CONNECTION_CONFIG_ID
    })

    if (
      !decryptCredentials ||
      !config?.encrypted_credentials ||
      config.credentials_status === "needs_reentry"
    ) {
      return config?.credentials_status === "needs_reentry"
        ? { ...config, encrypted_credentials: undefined }
        : config ?? null
    }

    try {
      const { reencryptedCredentials } = readMoyskladCredentials(
        config.encrypted_credentials
      )

      if (!reencryptedCredentials) return config

      await this.updateMoyskladConnectionConfigs({
        id: config.id,
        encrypted_credentials: reencryptedCredentials,
      })

      return { ...config, encrypted_credentials: reencryptedCredentials }
    } catch (error) {
      if (!(error instanceof MoyskladCredentialsReentryError)) {
        throw error
      }

      await this.markCredentialsReentryRequired(error.message)
      return {
        ...config,
        encrypted_credentials: undefined,
        credentials_status: "needs_reentry",
        credentials_attention_reason: error.message,
      }
    }
  }

  async saveConnectionConfig(input: SaveMoyskladConnectionConfigInput) {
    const config = await this.getConnectionConfig(false)
    const encryptedCredentials = encryptMoyskladCredentials(input.credentials)
    const isActive = input.isActive ?? config?.is_active ?? false

    if (config && isActive && !config.is_active) {
      await this.rearmExhaustedOrderSyncs()
    }

    if (config) {
      return this.updateMoyskladConnectionConfigs({
        id: CONNECTION_CONFIG_ID,
        encrypted_credentials: encryptedCredentials,
        is_active: isActive,
        credentials_status: "configured",
        credentials_attention_reason: null,
        stock_sync_schedule: config.stock_sync_schedule ?? "*/15 * * * *",
        catalog_sync_schedule: config.catalog_sync_schedule ?? "0 * * * *",
        order_sync_retry_schedule: config.order_sync_retry_schedule ?? "* * * * *"
      })
    }

    return this.createMoyskladConnectionConfigs({
      id: CONNECTION_CONFIG_ID,
      encrypted_credentials: encryptedCredentials,
      is_active: isActive,
      credentials_status: "configured",
      credentials_attention_reason: null,
      stock_sync_schedule: "*/15 * * * *",
      catalog_sync_schedule: "0 * * * *",
      order_sync_retry_schedule: "* * * * *"
    })
  }

  async markCredentialsReentryRequired(reason: string) {
    const config = await this.getConnectionConfig(false)

    if (!config || config.credentials_status === "needs_reentry") {
      return config ?? null
    }

    return this.updateMoyskladConnectionConfigs({
      id: CONNECTION_CONFIG_ID,
      credentials_status: "needs_reentry",
      credentials_attention_reason: reason,
    })
  }

  async setConnectionActive(isActive: boolean) {
    const config = await this.getConnectionConfig(false)

    if (!config) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "MoySklad connection configuration was not found.")
    }

    if (isActive && !config.is_active) {
      await this.rearmExhaustedOrderSyncs()
    }

    return this.updateMoyskladConnectionConfigs({
      id: CONNECTION_CONFIG_ID,
      is_active: isActive
    })
  }

  private async rearmExhaustedOrderSyncs() {
    const orderSyncs = await this.listMoyskladOrderSyncs({})
    const exhaustedOrderSyncs = orderSyncs.filter(
      (orderSync) =>
        (orderSync.status === "pending" || orderSync.status === "error") &&
        orderSync.retryable !== false &&
        orderSync.attempts >= MAX_ORDER_SYNC_ATTEMPTS
    )

    for (const orderSync of exhaustedOrderSyncs) {
      // Re-arm the existing retry schedule. The regular minute job will
      // claim this row after its first one-minute delay; no second retry
      // mechanism is introduced for reactivation.
      await this.updateMoyskladOrderSyncs({
        id: orderSync.id,
        attempts: 1
      })
    }

    const exhaustedCancellations = orderSyncs.filter(
      (orderSync) =>
        (orderSync.cancellation_status === "pending" || orderSync.cancellation_status === "error") &&
        orderSync.cancellation_attempts >= MAX_ORDER_SYNC_ATTEMPTS
    )

    for (const orderSync of exhaustedCancellations) {
      await this.updateMoyskladOrderSyncs({
        id: orderSync.id,
        cancellation_attempts: 1,
        cancellation_updated_at: new Date()
      })
    }


    const exhaustedPayments = orderSyncs.filter(
      (orderSync) =>
        (orderSync.payment_status === "pending" || orderSync.payment_status === "error") &&
        orderSync.payment_attempts >= MAX_ORDER_SYNC_ATTEMPTS
    )

    for (const orderSync of exhaustedPayments) {
      await this.updateMoyskladOrderSyncs({
        id: orderSync.id,
        payment_attempts: 1,
        payment_updated_at: new Date()
      })
    }
  }

  async getConnectionAttentionReason() {
    const config = await this.getConnectionConfig()

    if (!config) {
      return null
    }

    if (config.credentials_status === "needs_reentry") {
      return config.credentials_attention_reason ??
        "МойСклад требует повторного ввода реквизитов."
    }

    const orderSyncs = await this.listMoyskladOrderSyncs({})
    const orderFailures = orderSyncs.flatMap((orderSync) => [
      ...(orderSync.status === "error" && orderSync.last_error
        ? [{ reason: orderSync.last_error, at: orderSync.updated_at }]
        : []),
      ...(orderSync.cancellation_status === "error" && orderSync.cancellation_last_error
        ? [
            {
              reason: orderSync.cancellation_last_error,
              at: orderSync.cancellation_updated_at ?? orderSync.updated_at
            }
          ]
        : []),
      ...(orderSync.payment_status === "error" && orderSync.payment_last_error
        ? [{ reason: orderSync.payment_last_error, at: orderSync.payment_updated_at ?? orderSync.updated_at }]
        : [])
    ])
    const latestOrderFailure = orderFailures.sort(
      (left, right) => new Date(right.at).getTime() - new Date(left.at).getTime()
    )[0]
    const stockFailure = config.stock_sync_last_error
      ? {
          reason: config.stock_sync_last_error,
          at: config.stock_sync_last_attempt_at ?? new Date(0)
        }
      : null

    if (
      stockFailure &&
      (!latestOrderFailure || new Date(stockFailure.at).getTime() >= new Date(latestOrderFailure.at).getTime())
    ) {
      return stockFailure.reason
    }

    return latestOrderFailure?.reason ?? null
  }

  async recordStockSyncSuccess(unmatched: MoyskladUnmatchedItem[]) {
    const config = await this.getConnectionConfig()

    if (!config) {
      return null
    }

    return this.updateMoyskladConnectionConfigs({
      id: CONNECTION_CONFIG_ID,
      stock_sync_last_error: null,
      stock_sync_last_attempt_at: new Date(),
      stock_sync_last_success_at: new Date(),
      stock_sync_unmatched: { items: unmatched }
    })
  }

  async recordStockSyncFailure(lastError: string) {
    const config = await this.getConnectionConfig()

    if (!config) {
      return null
    }

    return this.updateMoyskladConnectionConfigs({
      id: CONNECTION_CONFIG_ID,
      stock_sync_last_error: lastError,
      stock_sync_last_attempt_at: new Date()
    })
  }

  async recordCatalogSyncSuccess() {
    const config = await this.getConnectionConfig(false)
    if (!config) return null

    return this.updateMoyskladConnectionConfigs({
      id: CONNECTION_CONFIG_ID,
      catalog_sync_last_error: null,
      catalog_sync_last_attempt_at: new Date(),
      catalog_sync_last_success_at: new Date(),
    })
  }

  async recordCatalogSyncFailure(lastError: string) {
    const config = await this.getConnectionConfig(false)
    if (!config) return null

    return this.updateMoyskladConnectionConfigs({
      id: CONNECTION_CONFIG_ID,
      catalog_sync_last_error: lastError,
      catalog_sync_last_attempt_at: new Date(),
    })
  }

  async getOrderSyncStatus(orderId: string) {
    const [orderSync] = await this.listMoyskladOrderSyncs({
      order_id: orderId
    })

    return orderSync ?? null
  }

  /**
   * Claims a retry slot before the actual MoySklad call, without incrementing
   * `attempts` — a fresh `updated_at` makes the retry job's due-check treat
   * this order as not-due again, so a slow in-flight attempt can't overlap
   * with the next scheduled tick and create a second MoySklad document.
   */
  async claimOrderSyncForRetry(orderId: string, statuses: Array<"pending" | "error" | "syncing">) {
    const updated = await this.updateMoyskladOrderSyncs({
      selector: { order_id: orderId, status: statuses },
      data: { status: "syncing" }
    } as never)

    return Array.isArray(updated) ? (updated[0] ?? null) : (updated ?? null)
  }

  async recordOrderSyncAttempt(input: RecordMoyskladOrderSyncAttemptInput) {
    const existing = await this.getOrderSyncStatus(input.orderId)

    if (!existing) {
      return this.createMoyskladOrderSyncs({
        order_id: input.orderId,
        status: input.status,
        moysklad_order_id: input.moyskladOrderId ?? null,
        last_error: input.lastError ?? null,
        retryable: input.retryable ?? true,
        attempts: 1
      })
    }

    return this.updateMoyskladOrderSyncs({
      id: existing.id,
      status: input.status,
      moysklad_order_id: input.moyskladOrderId ?? existing.moysklad_order_id,
      last_error: input.lastError ?? null,
      retryable: input.retryable ?? true,
      attempts: existing.attempts + 1
    })
  }

  /**
   * Claims a cancellation-mark retry slot before the actual MoySklad call.
   * Same purpose as `claimOrderSyncForRetry` above, kept on the separate
   * `cancellation_*` columns so it can't interfere with the create-sync
   * retry timeline on the same row.
   */
  async claimCancellationForRetry(orderId: string, statuses: Array<"pending" | "error" | "syncing">) {
    const updated = await this.updateMoyskladOrderSyncs({
      selector: { order_id: orderId, cancellation_status: statuses },
      data: {
        cancellation_status: "syncing",
        cancellation_updated_at: new Date()
      }
    } as never)

    return Array.isArray(updated) ? (updated[0] ?? null) : (updated ?? null)
  }

  async recordCancellationAttempt(input: RecordMoyskladCancellationAttemptInput) {
    const existing = await this.getOrderSyncStatus(input.orderId)

    if (!existing) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `MoySklad order sync for order ${input.orderId} was not found.`
      )
    }

    return this.updateMoyskladOrderSyncs({
      id: existing.id,
      cancellation_status: input.status,
      cancellation_last_error: input.lastError ?? null,
      cancellation_attempts: existing.cancellation_attempts + 1,
      cancellation_updated_at: new Date()
    })
  }

  async rememberCancellation(orderId: string) {
    const existing = await this.getOrderSyncStatus(orderId)

    if (!existing) {
      return this.createMoyskladOrderSyncs({
        order_id: orderId,
        status: "pending",
        attempts: 0,
        cancellation_status: "pending",
        cancellation_attempts: 0,
      })
    }

    if (existing.cancellation_status == null) {
      return this.updateMoyskladOrderSyncs({
        id: existing.id,
        cancellation_status: "pending",
        cancellation_updated_at: new Date(),
      })
    }

    return existing
  }


  async rememberPayment(orderId: string, paidAt: Date, externalCode: string, amount?: number, currencyCode?: string) {
    const existing = await this.getOrderSyncStatus(orderId)

    if (!existing) {
      return this.createMoyskladOrderSyncs({
        order_id: orderId,
        status: "pending",
        attempts: 0,
        payment_status: "pending",
        payment_attempts: 0,
        payment_last_error: null,
        payment_paid_at: paidAt,
        payment_amount: amount ?? null,
        payment_currency_code: currencyCode ?? null,
        payment_updated_at: new Date(),
        payment_external_code: externalCode,
        moysklad_payment_id: null
      })
    }

    if (existing.payment_status) return existing

    return this.updateMoyskladOrderSyncs({
      id: existing.id,
      payment_status: "pending",
      payment_attempts: 0,
      payment_last_error: null,
      payment_paid_at: paidAt,
      payment_amount: amount ?? null,
      payment_currency_code: currencyCode ?? null,
      payment_updated_at: new Date(),
      payment_external_code: externalCode,
      moysklad_payment_id: null
    })
  }

  async claimPaymentForRetry(orderId: string, statuses: Array<"pending" | "error" | "syncing">, expectedUpdatedAt?: Date) {
    const updated = await this.updateMoyskladOrderSyncs({
      selector: {
        order_id: orderId,
        payment_status: statuses,
        ...(expectedUpdatedAt ? { payment_updated_at: expectedUpdatedAt } : {})
      },
      data: { payment_status: "syncing", payment_updated_at: new Date() }
    } as never)

    return Array.isArray(updated) ? (updated[0] ?? null) : (updated ?? null)
  }

  async recordPaymentAttempt(input: RecordMoyskladPaymentAttemptInput) {
    const existing = await this.getOrderSyncStatus(input.orderId)

    if (!existing) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `MoySklad order sync for order ${input.orderId} was not found.`)
    }

    return this.updateMoyskladOrderSyncs({
      id: existing.id,
      payment_status: input.status,
      payment_attempts: (existing.payment_attempts ?? 0) + 1,
      payment_last_error: input.lastError ?? null,
      payment_paid_at: input.paidAt ?? existing.payment_paid_at,
      payment_updated_at: new Date(),
      payment_external_code: input.externalCode ?? existing.payment_external_code,
      moysklad_payment_id: input.moyskladPaymentId ?? existing.moysklad_payment_id
    })
  }

  async claimFulfillment(orderId: string) {
    const existing = await this.getOrderSyncStatus(orderId)
    if (!existing) return null
    if (existing.fulfillment_status === "synced") return existing
    return this.updateMoyskladOrderSyncs({
      id: existing.id,
      fulfillment_status: "syncing",
      fulfillment_updated_at: new Date(),
    })
  }

  async recordFulfillmentAttempt(input: RecordMoyskladFulfillmentAttemptInput) {
    const existing = await this.getOrderSyncStatus(input.orderId)
    if (!existing) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `MoySklad order sync for order ${input.orderId} was not found.`
      )
    }

    return this.updateMoyskladOrderSyncs({
      id: existing.id,
      fulfillment_status: input.status,
      fulfillment_attempts: (existing.fulfillment_attempts ?? 0) + 1,
      fulfillment_last_error: input.lastError ?? null,
      fulfillment_updated_at: new Date(),
      moysklad_demand_id: input.moyskladDemandId ?? existing.moysklad_demand_id,
    })
  }
}

export default MoyskladIntegrationService
