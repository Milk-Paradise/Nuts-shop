import { decryptShippingProviderCredentials } from "./credentials"
import { CDEK_PROVIDER_KEY, OZON_PROVIDER_KEY } from "./provider-keys"

export type StoredProviderConfig = {
  encrypted_credentials?: string | null
  configuration?: unknown
} | null

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/** Configuration is ready only when credentials can be decrypted and the adapter's required settings are valid. */
export function isShippingProviderConfigurationReady(
  providerKey: string,
  config: StoredProviderConfig
): boolean {
  if (!config?.encrypted_credentials || !isRecord(config.configuration)) return false

  try {
    const credentials = decryptShippingProviderCredentials(config.encrypted_credentials)
    if (!isNonEmptyString(credentials.client_id) || !isNonEmptyString(credentials.client_secret)) return false

    if (providerKey === CDEK_PROVIDER_KEY) {
      const sender = config.configuration.sender
      const tariffCodes = config.configuration.tariff_codes
      return isRecord(sender)
        && isNonEmptyString(sender.city)
        && isNonEmptyString(sender.street)
        && isNonEmptyString(sender.postal_code)
        && isNonEmptyString(sender.contact_name)
        && isNonEmptyString(sender.phone)
        && (config.configuration.contract_type === "online_store" || config.configuration.contract_type === "delivery")
        && Array.isArray(tariffCodes)
        && tariffCodes.length > 0
        && tariffCodes.every((code) => Number.isInteger(code) && Number(code) > 0)
    }

    if (providerKey === OZON_PROVIDER_KEY) {
      const sender = config.configuration.sender
      return sender === undefined || (isRecord(sender)
        && (sender.city === undefined || isNonEmptyString(sender.city))
        && (sender.postal_code === undefined || isNonEmptyString(sender.postal_code)))
    }
  } catch {
    // Readiness checks must not expose decryption details or stored secrets.
    return false
  }

  return false
}
