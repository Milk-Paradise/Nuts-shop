import {
  decryptShippingProviderCredentials,
  maskShippingProviderSecret,
} from "../../../modules/shipping-provider-registry/credentials"

type ProviderConfig = {
  configuration?: unknown
  encrypted_credentials?: string | null
}

export function serializeCdekProviderConfig(config: ProviderConfig | null) {
  const credentials = config?.encrypted_credentials
    ? decryptShippingProviderCredentials(config.encrypted_credentials)
    : null

  return {
    configured: !!config,
    credentials: credentials
      ? {
          client_id: maskShippingProviderSecret(credentials.client_id),
          client_secret: maskShippingProviderSecret(credentials.client_secret),
        }
      : null,
    configuration: config?.configuration ?? null,
  }
}

export function serializeOzonProviderConfig(config: ProviderConfig | null) {
  return serializeCdekProviderConfig(config)
}

export function serializeStorePackage(storePackage: unknown) {
  return storePackage ?? null
}
