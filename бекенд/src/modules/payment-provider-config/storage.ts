import {
  encryptPaymentProviderSecret,
  readPaymentProviderSecret,
} from "./crypto"

export type PaymentProviderConfigRecord = {
  id: string
  provider_id: string
  shop_id: string | null
  encrypted_secret_key: string | null
  mode: "test" | "live"
  is_enabled: boolean
  created_by_user_id: string | null
  updated_by_user_id: string | null
  created_at: Date
  updated_at: Date
}

export type PaymentProviderAvailabilityRecord = {
  id: string
  provider_id: string
  store_id: string
  region_id: string
  is_enabled: boolean
  created_at: Date
  updated_at: Date
}

export type SavePaymentProviderConfigInput = {
  provider_id: string
  shop_id?: string | null
  secret_key?: string | null
  mode?: "test" | "live"
  is_enabled?: boolean
  actor_id: string
}

type PaymentProviderConfigWriteData = Omit<
  PaymentProviderConfigRecord,
  "id" | "created_at" | "updated_at"
>

export type AdminPaymentProviderConfig = Omit<
  PaymentProviderConfigRecord,
  "encrypted_secret_key"
> & {
  secret_key_set: boolean
}

function actorId(actorId: string) {
  const normalized = actorId.trim()

  if (!normalized) {
    throw new Error("A payment provider configuration change requires an actor")
  }

  return normalized
}

function encryptedSecretKeyForWrite(
  secretKey: string | null | undefined,
  existing: PaymentProviderConfigRecord | null
) {
  // Explicit deletion (null passed)
  if (secretKey === null) {
    return null
  }

  // Unchanged (undefined passed or empty string) - try to reencrypt existing secret
  if (secretKey === undefined || secretKey.trim() === "") {
    if (!existing?.encrypted_secret_key) return null

    return (
      readPaymentProviderSecret(existing.encrypted_secret_key).reencrypted ??
      existing.encrypted_secret_key
    )
  }

  // Actual new value
  return encryptPaymentProviderSecret(secretKey)
}

export function buildPaymentProviderConfigWriteData(
  input: SavePaymentProviderConfigInput,
  existing: PaymentProviderConfigRecord | null
): PaymentProviderConfigWriteData {
  const changedBy = actorId(input.actor_id)
  const encryptedSecretKey = encryptedSecretKeyForWrite(
    input.secret_key,
    existing
  )
  const clearsShopId =
    input.shop_id !== undefined && !input.shop_id?.trim()
  const clearsSecretKey = input.secret_key === null
  const clearsRequiredConfiguration = clearsShopId || clearsSecretKey
  const replacesShopId = Boolean(
    existing &&
      input.shop_id?.trim() &&
      input.shop_id.trim() !== existing.shop_id?.trim()
  )
  const replacesSecretKey = Boolean(existing && input.secret_key?.trim())
  const changesCredentials =
    clearsRequiredConfiguration || replacesShopId || replacesSecretKey
  const shopId =
    input.shop_id === undefined || (existing !== null && clearsShopId)
      ? existing?.shop_id ?? null
      : input.shop_id
  const hasValidConfiguration = Boolean(shopId?.trim() && encryptedSecretKey)

  return {
    provider_id: input.provider_id,
    shop_id: shopId,
    encrypted_secret_key: encryptedSecretKey,
    mode: input.mode ?? existing?.mode ?? "test",
    is_enabled: hasValidConfiguration && !changesCredentials
      ? input.is_enabled ?? existing?.is_enabled ?? false
      : false,
    created_by_user_id: existing?.created_by_user_id ?? changedBy,
    updated_by_user_id: changedBy,
  }
}

export function toAdminPaymentProviderConfig(
  config: PaymentProviderConfigRecord
): AdminPaymentProviderConfig {
  const { encrypted_secret_key: _, ...safeConfig } = config

  return {
    ...safeConfig,
    secret_key_set: Boolean(config.encrypted_secret_key),
  }
}
