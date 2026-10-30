import MoyskladIntegrationService from "../service"
import { decryptMoyskladCredentials, encryptMoyskladCredentials } from "../credentials"

const tokenCredentials = {
  type: "token" as const,
  token: "moysklad-token-that-must-not-be-stored-as-plain-text"
}

describe("MoyskladIntegrationService", () => {
  beforeEach(() => {
    process.env.MOYSKLAD_ENCRYPTION_KEY = "test-moysklad-encryption-key"
  })

  it("encrypts credentials when creating the singleton configuration", async () => {
    const createConnectionConfigs = jest.fn(async (input) => input)
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "getConnectionConfig").mockResolvedValue(null as never)
    jest.spyOn(service, "createMoyskladConnectionConfigs").mockImplementation(createConnectionConfigs)

    await service.saveConnectionConfig({
      credentials: tokenCredentials,
      isActive: true
    })

    expect(createConnectionConfigs).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "default",
        is_active: true,
        encrypted_credentials: expect.not.stringContaining(tokenCredentials.token)
      })
    )
  })

  it("updates encrypted credentials instead of creating a second configuration", async () => {
    const updateConnectionConfigs = jest.fn(async (input) => input)
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "getConnectionConfig").mockResolvedValue({ id: "default" } as never)
    jest.spyOn(service, "updateMoyskladConnectionConfigs").mockImplementation(updateConnectionConfigs)

    await service.saveConnectionConfig({
      credentials: {
        type: "basic",
        login: "manager@example.com",
        password: "new-password"
      }
    })

    expect(updateConnectionConfigs).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "default",
        encrypted_credentials: expect.not.stringContaining("new-password")
      })
    )
  })

  it("replaces credentials that cannot be decrypted with the legacy key", async () => {
    process.env.SECRET_ENCRYPTION_KEY =
      "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg="
    process.env.MOYSKLAD_ENCRYPTION_KEY = "wrong-legacy-moysklad-key"
    const updateConnectionConfigs = jest.fn(async (input) => input)
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "listMoyskladConnectionConfigs").mockResolvedValue([
      {
        id: "default",
        encrypted_credentials:
          "v1.AwMDAwMDAwMDAwMD.njAt0c5mBU7bui16IhernQ.rFcAQcmW5nAaVPPSCbsqeJNBbJwKdt2B4EK4fbvLHzHGO51TNazg-B1yZqEkDBlY",
        is_active: false,
      },
    ] as never)
    jest
      .spyOn(service, "updateMoyskladConnectionConfigs")
      .mockImplementation(updateConnectionConfigs)

    await expect(
      service.saveConnectionConfig({
        credentials: { type: "token", token: "replacement-token" },
      })
    ).resolves.toEqual(
      expect.objectContaining({
        encrypted_credentials: expect.stringMatching(/^v2:/),
      })
    )
  })

  it("re-arms exhausted failed order syncs when the integration is re-enabled", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    const updateOrderSyncs = jest.fn().mockResolvedValue({})

    jest.spyOn(service, "getConnectionConfig").mockResolvedValue({
      id: "default",
      encrypted_credentials: "v1.encrypted",
      is_active: false
    } as never)
    jest.spyOn(service, "listMoyskladOrderSyncs").mockResolvedValue([
      { id: "sync_exhausted", status: "error", attempts: 6 },
      {
        id: "sync_data_error",
        status: "error",
        retryable: false,
        attempts: 6
      },
      { id: "sync_pending", status: "pending", attempts: 2 },
      { id: "sync_done", status: "synced", attempts: 6 },
      {
        id: "sync_cancel",
        status: "synced",
        attempts: 1,
        cancellation_status: "error",
        cancellation_attempts: 6
      }
    ] as never)
    jest.spyOn(service, "updateMoyskladOrderSyncs").mockImplementation(updateOrderSyncs)
    jest.spyOn(service, "updateMoyskladConnectionConfigs").mockResolvedValue({ is_active: true } as never)

    await service.setConnectionActive(true)

    expect(updateOrderSyncs).toHaveBeenCalledTimes(2)
    expect(updateOrderSyncs).toHaveBeenNthCalledWith(1, {
      id: "sync_exhausted",
      attempts: 1
    })
    expect(updateOrderSyncs).toHaveBeenNthCalledWith(2, {
      id: "sync_cancel",
      cancellation_attempts: 1,
      cancellation_updated_at: expect.any(Date)
    })
  })

  it("reports an order authentication failure as the connection attention reason", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "getConnectionConfig").mockResolvedValue({
      stock_sync_last_error: null
    } as never)
    jest.spyOn(service, "listMoyskladOrderSyncs").mockResolvedValue([
      {
        status: "error",
        last_error: "Ошибка аутентификации МойСклад",
        updated_at: new Date("2026-08-20T12:00:00Z")
      }
    ] as never)

    await expect(service.getConnectionAttentionReason()).resolves.toBe("Ошибка аутентификации МойСклад")
  })

  it("replaces the unmatched snapshot atomically after a complete stock cycle", async () => {
    const service = Object.create(
      MoyskladIntegrationService.prototype
    ) as MoyskladIntegrationService
    const updateConnectionConfigs = jest.fn(async (input) => input)
    const unmatched = [
      {
        source: "medusa_variant" as const,
        source_id: "variant_1",
        code: null,
        sku: "SKU-1",
        name: "Краска — 1 л",
        reason: "missing_moysklad_match" as const,
      },
    ]

    jest.spyOn(service, "getConnectionConfig").mockResolvedValue({
      id: "default",
    } as never)
    jest
      .spyOn(service, "updateMoyskladConnectionConfigs")
      .mockImplementation(updateConnectionConfigs)

    await service.recordStockSyncSuccess(unmatched)

    expect(updateConnectionConfigs).toHaveBeenCalledWith({
      id: "default",
      stock_sync_last_error: null,
      stock_sync_last_attempt_at: expect.any(Date),
      stock_sync_last_success_at: expect.any(Date),
      stock_sync_unmatched: { items: unmatched },
    })
  })

  it("records a failed attempt without replacing the last complete snapshot", async () => {
    const service = Object.create(
      MoyskladIntegrationService.prototype
    ) as MoyskladIntegrationService
    const updateConnectionConfigs = jest.fn(async (input) => input)

    jest.spyOn(service, "getConnectionConfig").mockResolvedValue({
      id: "default",
      stock_sync_unmatched: { items: [{ source_id: "previous" }] },
    } as never)
    jest
      .spyOn(service, "updateMoyskladConnectionConfigs")
      .mockImplementation(updateConnectionConfigs)

    await service.recordStockSyncFailure("МойСклад недоступен")

    expect(updateConnectionConfigs).toHaveBeenCalledWith({
      id: "default",
      stock_sync_last_error: "МойСклад недоступен",
      stock_sync_last_attempt_at: expect.any(Date),
    })
    expect(updateConnectionConfigs.mock.calls[0][0]).not.toHaveProperty(
      "stock_sync_unmatched"
    )
    expect(updateConnectionConfigs.mock.calls[0][0]).not.toHaveProperty(
      "stock_sync_last_success_at"
    )
  })

  it("changes activity without exposing or replacing stored credentials", async () => {
    const updateConnectionConfigs = jest.fn(async (input) => input)
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "getConnectionConfig").mockResolvedValue({
      id: "default",
      encrypted_credentials: "v1.encrypted",
      is_active: false
    } as never)
    jest.spyOn(service, "updateMoyskladConnectionConfigs").mockImplementation(updateConnectionConfigs)
    jest.spyOn(service, "listMoyskladOrderSyncs").mockResolvedValue([] as never)

    await service.setConnectionActive(true)

    expect(updateConnectionConfigs).toHaveBeenCalledWith({
      id: "default",
      is_active: true
    })
  })

  it("does not change activity when no saved connection exists", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    const updateConnectionConfigs = jest.fn()

    jest.spyOn(service, "getConnectionConfig").mockResolvedValue(null as never)
    jest.spyOn(service, "updateMoyskladConnectionConfigs").mockImplementation(updateConnectionConfigs)

    await expect(service.setConnectionActive(false)).rejects.toThrow("MoySklad connection configuration was not found.")
    expect(updateConnectionConfigs).not.toHaveBeenCalled()
  })

  it("conditionally claims a pending or failed order sync before retrying", async () => {
    const updateOrderSyncs = jest.fn(async (input) => [input])
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "updateMoyskladOrderSyncs").mockImplementation(updateOrderSyncs)

    await service.claimOrderSyncForRetry("order_1", ["pending", "error"])

    expect(updateOrderSyncs).toHaveBeenCalledWith({
      selector: { order_id: "order_1", status: ["pending", "error"] },
      data: { status: "syncing" }
    })
  })

  it("claims payment independently without changing order or cancellation state", async () => {
    const updateOrderSyncs = jest.fn(async (input) => [input])
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    jest.spyOn(service, "updateMoyskladOrderSyncs").mockImplementation(updateOrderSyncs)

    await service.claimPaymentForRetry("order_1", ["pending", "error"])

    expect(updateOrderSyncs).toHaveBeenCalledWith({
      selector: { order_id: "order_1", payment_status: ["pending", "error"] },
      data: { payment_status: "syncing", payment_updated_at: expect.any(Date) }
    })
    expect(updateOrderSyncs.mock.calls[0][0].data).not.toHaveProperty("status")
    expect(updateOrderSyncs.mock.calls[0][0].data).not.toHaveProperty("cancellation_status")
  })

  it("allows only one concurrent reclaim of the same stale payment lease", async () => {
    const staleAt = new Date("2026-09-10T10:00:00Z")
    let currentUpdatedAt = staleAt
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    jest.spyOn(service, "updateMoyskladOrderSyncs").mockImplementation(async (input: any) => {
      if (input.selector.payment_updated_at?.getTime() !== currentUpdatedAt.getTime()) return [] as never
      currentUpdatedAt = input.data.payment_updated_at
      return [{ id: "sync_1" }] as never
    })

    const claims = await Promise.all([
      service.claimPaymentForRetry("order_1", ["syncing"], staleAt),
      service.claimPaymentForRetry("order_1", ["syncing"], staleAt)
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
  })

  it("claims a failed sync for manual retry only while it is still failed", async () => {
    const updateOrderSyncs = jest.fn().mockResolvedValue([])
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "updateMoyskladOrderSyncs").mockImplementation(updateOrderSyncs)

    await expect(service.claimOrderSyncForRetry("order_1", ["error"])).resolves.toBeNull()
    expect(updateOrderSyncs).toHaveBeenCalledWith({
      selector: { order_id: "order_1", status: ["error"] },
      data: { status: "syncing" }
    })
  })

  it("does nothing when the conditional retry claim matches no order", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    const updateOrderSyncs = jest.fn().mockResolvedValue([])

    jest.spyOn(service, "updateMoyskladOrderSyncs").mockImplementation(updateOrderSyncs)

    await expect(service.claimOrderSyncForRetry("order_1", ["error"])).resolves.toBeNull()
    expect(updateOrderSyncs).toHaveBeenCalledTimes(1)
  })

  it("creates the first sync attempt for an order with no prior status", async () => {
    const createOrderSyncs = jest.fn(async (input) => input)
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "getOrderSyncStatus").mockResolvedValue(null as never)
    jest.spyOn(service, "createMoyskladOrderSyncs").mockImplementation(createOrderSyncs)

    await service.recordOrderSyncAttempt({
      orderId: "order_1",
      status: "pending"
    })

    expect(createOrderSyncs).toHaveBeenCalledWith({
      order_id: "order_1",
      status: "pending",
      moysklad_order_id: null,
      last_error: null,
      retryable: true,
      attempts: 1
    })
  })

  it("reads back the current sync status for an order", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    const orderSync = { id: "mso_1", order_id: "order_1", status: "error" }

    jest.spyOn(service, "listMoyskladOrderSyncs").mockResolvedValue([orderSync] as never)

    await expect(service.getOrderSyncStatus("order_1")).resolves.toEqual(orderSync)
  })

  it("returns null when no sync status exists for an order", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "listMoyskladOrderSyncs").mockResolvedValue([] as never)

    await expect(service.getOrderSyncStatus("order_1")).resolves.toBeNull()
  })

  it("increments attempts and updates status on a repeated attempt", async () => {
    const updateOrderSyncs = jest.fn(async (input) => input)
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "getOrderSyncStatus").mockResolvedValue({
      id: "mso_1",
      order_id: "order_1",
      status: "pending",
      moysklad_order_id: null,
      last_error: "timeout",
      attempts: 2
    } as never)
    jest.spyOn(service, "updateMoyskladOrderSyncs").mockImplementation(updateOrderSyncs)

    await service.recordOrderSyncAttempt({
      orderId: "order_1",
      status: "synced",
      moyskladOrderId: "ms_42"
    })

    expect(updateOrderSyncs).toHaveBeenCalledWith({
      id: "mso_1",
      status: "synced",
      moysklad_order_id: "ms_42",
      last_error: null,
      retryable: true,
      attempts: 3
    })
  })

  it("preserves the existing MoySklad order link when a later attempt errors without one", async () => {
    const updateOrderSyncs = jest.fn(async (input) => input)
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "getOrderSyncStatus").mockResolvedValue({
      id: "mso_1",
      order_id: "order_1",
      status: "synced",
      moysklad_order_id: "ms_42",
      last_error: null,
      attempts: 1
    } as never)
    jest.spyOn(service, "updateMoyskladOrderSyncs").mockImplementation(updateOrderSyncs)

    await service.recordOrderSyncAttempt({
      orderId: "order_1",
      status: "error",
      lastError: "boom"
    })

    expect(updateOrderSyncs).toHaveBeenCalledWith({
      id: "mso_1",
      status: "error",
      moysklad_order_id: "ms_42",
      last_error: "boom",
      retryable: true,
      attempts: 2
    })
  })

  it("conditionally claims a pending or failed cancellation mark before retrying", async () => {
    const updateOrderSyncs = jest.fn(async (input) => [input])
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "updateMoyskladOrderSyncs").mockImplementation(updateOrderSyncs)

    await service.claimCancellationForRetry("order_1", ["pending", "error"])

    expect(updateOrderSyncs).toHaveBeenCalledWith({
      selector: {
        order_id: "order_1",
        cancellation_status: ["pending", "error"]
      },
      data: {
        cancellation_status: "syncing",
        cancellation_updated_at: expect.any(Date)
      }
    })
  })

  it("does nothing when the conditional cancellation retry claim matches no order", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    const updateOrderSyncs = jest.fn().mockResolvedValue([])

    jest.spyOn(service, "updateMoyskladOrderSyncs").mockImplementation(updateOrderSyncs)

    await expect(service.claimCancellationForRetry("order_1", ["error"])).resolves.toBeNull()
  })

  it("throws when recording a cancellation attempt for an order with no sync record", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "getOrderSyncStatus").mockResolvedValue(null as never)

    await expect(
      service.recordCancellationAttempt({
        orderId: "order_1",
        status: "synced"
      })
    ).rejects.toThrow("MoySklad order sync for order order_1 was not found.")
  })

  it("increments cancellation_attempts and updates the cancellation status", async () => {
    const updateOrderSyncs = jest.fn(async (input) => input)
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "getOrderSyncStatus").mockResolvedValue({
      id: "mso_1",
      order_id: "order_1",
      status: "synced",
      moysklad_order_id: "ms_42",
      cancellation_status: "error",
      cancellation_attempts: 1,
      cancellation_last_error: "boom"
    } as never)
    jest.spyOn(service, "updateMoyskladOrderSyncs").mockImplementation(updateOrderSyncs)

    await service.recordCancellationAttempt({
      orderId: "order_1",
      status: "synced"
    })

    expect(updateOrderSyncs).toHaveBeenCalledWith({
      id: "mso_1",
      cancellation_status: "synced",
      cancellation_last_error: null,
      cancellation_attempts: 2,
      cancellation_updated_at: expect.any(Date)
    })
  })

  it("round-trips credentials and rejects a modified ciphertext", () => {
    const encryptedCredentials = encryptMoyskladCredentials(tokenCredentials)
    const [version, iv, authTag, ciphertext] = encryptedCredentials.split(":")
    const corruptedCredentials = [
      version,
      iv,
      authTag,
      `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`
    ].join(":")

    expect(decryptMoyskladCredentials(encryptedCredentials)).toEqual(tokenCredentials)
    expect(() => decryptMoyskladCredentials(corruptedCredentials)).toThrow(
      "Stored secret cannot be decrypted with SECRET_ENCRYPTION_KEY"
    )
  })

  it("tells the operator to enter MoySklad credentials again when a legacy key cannot decrypt them", () => {
    process.env.MOYSKLAD_ENCRYPTION_KEY = "wrong-legacy-moysklad-key"

    expect(() =>
      decryptMoyskladCredentials(
        "v1.AwMDAwMDAwMDAwMD.njAt0c5mBU7bui16IhernQ.rFcAQcmW5nAaVPPSCbsqeJNBbJwKdt2B4EK4fbvLHzHGO51TNazg-B1yZqEkDBlY"
      )
    ).toThrow(
      "Stored MoySklad credentials cannot be decrypted with MOYSKLAD_ENCRYPTION_KEY. Enter the credentials again."
    )
  })

  it("returns the singleton connection configuration or null", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    const list = jest.spyOn(service, "listMoyskladConnectionConfigs")
    list.mockResolvedValueOnce([{ id: "default" }] as never)
    await expect(service.getConnectionConfig()).resolves.toEqual({ id: "default" })
    expect(list).toHaveBeenCalledWith({ id: "default" })
    list.mockResolvedValueOnce([])
    await expect(service.getConnectionConfig()).resolves.toBeNull()
  })

  it("persists a re-entry state when stored credentials cannot be read", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    const update = jest.fn().mockImplementation(async (input) => input)

    jest.spyOn(service, "listMoyskladConnectionConfigs").mockResolvedValue([
      {
        id: "default",
        encrypted_credentials: "v2.invalid",
        is_active: true,
        credentials_status: "configured"
      }
    ] as never)
    jest.spyOn(service, "updateMoyskladConnectionConfigs").mockImplementation(update)

    await expect(service.getConnectionConfig()).resolves.toMatchObject({
      id: "default",
      credentials_status: "needs_reentry",
      encrypted_credentials: undefined
    })
    expect(update).toHaveBeenCalledWith({
      id: "default",
      credentials_status: "needs_reentry",
      credentials_attention_reason: expect.stringContaining("encryption format")
    })
  })

  it("re-encrypts legacy MoySklad credentials when the configuration is read", async () => {
    process.env.SECRET_ENCRYPTION_KEY =
      "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg="
    process.env.MOYSKLAD_ENCRYPTION_KEY = "legacy-moysklad-key"
    const service = Object.create(
      MoyskladIntegrationService.prototype
    ) as MoyskladIntegrationService
    jest.spyOn(service, "listMoyskladConnectionConfigs").mockResolvedValue([
      {
        id: "default",
        encrypted_credentials:
          "v1.AwMDAwMDAwMDAwMD.njAt0c5mBU7bui16IhernQ.rFcAQcmW5nAaVPPSCbsqeJNBbJwKdt2B4EK4fbvLHzHGO51TNazg-B1yZqEkDBlY",
      },
    ] as never)
    const update = jest
      .spyOn(service, "updateMoyskladConnectionConfigs")
      .mockImplementation(async (input) => input as never)

    await expect(service.getConnectionConfig()).resolves.toEqual(
      expect.objectContaining({
        encrypted_credentials: expect.stringMatching(/^v2:/),
      })
    )
    expect(update).toHaveBeenCalledWith({
      id: "default",
      encrypted_credentials: expect.stringMatching(/^v2:/),
    })
  })

  it("inherits activity on credential rotation and defaults a first config to inactive", async () => {
    const existing = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    jest.spyOn(existing, "getConnectionConfig").mockResolvedValue({ id: "default", is_active: true } as never)
    const update = jest.spyOn(existing, "updateMoyskladConnectionConfigs").mockImplementation(async value => value as never)
    await existing.saveConnectionConfig({ credentials: tokenCredentials })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ is_active: true }))

    const fresh = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    jest.spyOn(fresh, "getConnectionConfig").mockResolvedValue(null as never)
    const create = jest.spyOn(fresh, "createMoyskladConnectionConfigs").mockImplementation(async value => value as never)
    await fresh.saveConnectionConfig({ credentials: tokenCredentials })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }))
  })

  it("does not re-arm retries when saving or setting an already active connection", async () => {
    for (const action of ["save", "set"] as const) {
      const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
      jest.spyOn(service, "getConnectionConfig").mockResolvedValue({ id: "default", is_active: true } as never)
      const list = jest.spyOn(service, "listMoyskladOrderSyncs")
      jest.spyOn(service, "updateMoyskladConnectionConfigs").mockImplementation(async value => value as never)
      if (action === "save") await service.saveConnectionConfig({ credentials: tokenCredentials, isActive: true })
      else await service.setConnectionActive(false)
      expect(list).not.toHaveBeenCalled()
    }
  })

  it("re-arms pending and error retry boundaries but not ineligible records", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    jest.spyOn(service, "getConnectionConfig").mockResolvedValue({ id: "default", is_active: false } as never)
    jest.spyOn(service, "listMoyskladOrderSyncs").mockResolvedValue([
      { id: "pending", status: "pending", attempts: 6, cancellation_status: "none", cancellation_attempts: 0 },
      { id: "error", status: "error", attempts: 6, cancellation_status: "pending", cancellation_attempts: 6 },
      { id: "cancel-error", status: "synced", attempts: 6, cancellation_status: "error", cancellation_attempts: 6 },
      { id: "below", status: "error", attempts: 5, cancellation_status: "error", cancellation_attempts: 5 },
    ] as never)
    const updateSync = jest.spyOn(service, "updateMoyskladOrderSyncs").mockResolvedValue({} as never)
    jest.spyOn(service, "updateMoyskladConnectionConfigs").mockResolvedValue({} as never)
    await service.setConnectionActive(true)
    expect(updateSync.mock.calls.map(([value]: any[]) => value.id)).toEqual([
      "pending", "error", "error", "cancel-error",
    ])
  })

  it("chooses the newest attention reason across order, cancellation, and stock failures", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    const config = { stock_sync_last_error: "stock", stock_sync_last_attempt_at: new Date("2026-01-03") }
    jest.spyOn(service, "getConnectionConfig").mockResolvedValue(config as never)
    jest.spyOn(service, "listMoyskladOrderSyncs").mockResolvedValue([
      { status: "error", last_error: "order-old", updated_at: new Date("2026-01-01") },
      { status: "synced", cancellation_status: "error", cancellation_last_error: "cancel-new", cancellation_updated_at: new Date("2026-01-04"), updated_at: new Date("2026-01-02") },
      { status: "error", last_error: null, cancellation_status: "error", cancellation_last_error: null, updated_at: new Date("2026-01-05") },
    ] as never)
    await expect(service.getConnectionAttentionReason()).resolves.toBe("cancel-new")

    config.stock_sync_last_attempt_at = new Date("2026-01-05")
    await expect(service.getConnectionAttentionReason()).resolves.toBe("stock")
  })

  it("returns no attention reason without configuration or failures", async () => {
    const missing = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    jest.spyOn(missing, "getConnectionConfig").mockResolvedValue(null as never)
    await expect(missing.getConnectionAttentionReason()).resolves.toBeNull()

    const clean = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    jest.spyOn(clean, "getConnectionConfig").mockResolvedValue({ stock_sync_last_error: null } as never)
    jest.spyOn(clean, "listMoyskladOrderSyncs").mockResolvedValue([] as never)
    await expect(clean.getConnectionAttentionReason()).resolves.toBeNull()
  })

  it("does not record stock outcomes before a connection exists", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    jest.spyOn(service, "getConnectionConfig").mockResolvedValue(null as never)
    const update = jest.spyOn(service, "updateMoyskladConnectionConfigs")
    await expect(service.recordStockSyncSuccess([])).resolves.toBeNull()
    await expect(service.recordStockSyncFailure("failure")).resolves.toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it("returns both singular and array-shaped conditional update results", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    const update = jest.spyOn(service, "updateMoyskladOrderSyncs")
    update.mockResolvedValueOnce({ id: "sync_1" } as never)
    await expect(service.claimOrderSyncForRetry("order_1", ["pending"])).resolves.toEqual({ id: "sync_1" })
    update.mockResolvedValueOnce({ id: "sync_2" } as never)
    await expect(service.claimCancellationForRetry("order_1", ["pending"])).resolves.toEqual({ id: "sync_2" })
  })

  it("persists explicit first-attempt identifiers and cancellation errors", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService
    jest.spyOn(service, "getOrderSyncStatus")
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: "sync_1", cancellation_attempts: 0 } as never)
    const create = jest.spyOn(service, "createMoyskladOrderSyncs").mockImplementation(async value => value as never)
    const update = jest.spyOn(service, "updateMoyskladOrderSyncs").mockImplementation(async value => value as never)
    await service.recordOrderSyncAttempt({
      orderId: "order_1", status: "error", moyskladOrderId: "ms_1", lastError: "failure",
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ moysklad_order_id: "ms_1", last_error: "failure" }))
    await service.recordCancellationAttempt({ orderId: "order_1", status: "error", lastError: "cancel failure" })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ cancellation_last_error: "cancel failure" }))
  })
})
