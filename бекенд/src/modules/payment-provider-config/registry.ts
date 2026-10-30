import { verifyYooKassaCredentials } from "../../providers/payment-yookassa-runtime/credentials"
import type {
  PaymentProviderAvailabilityRecord,
  PaymentProviderConfigRecord,
} from "./storage"

export type PaymentProviderRegistryEntry = {
  id: string
  name: string
  medusa_id: string
}

export type AdminPaymentProvider = Omit<
  PaymentProviderRegistryEntry,
  "medusa_id"
> & {
  is_enabled: boolean
  is_configured: boolean
  configuration_status: "configured" | "requires_configuration"
  shop_id: string | null
  mode: "test" | "live"
  secret_key_set: boolean
  updated_at: Date | null
}

export function paymentProviderRegistryForEnvironment(e2eRun: boolean) {
  return [
    {
      id: "yookassa",
      name: "ЮKassa",
      medusa_id: "pp_yookassa_yookassa",
    },
    ...(e2eRun
      ? [
          {
            id: "e2e",
            name: "E2E тестовая оплата",
            medusa_id: "pp_e2e_e2e",
          },
        ]
      : []),
  ] satisfies PaymentProviderRegistryEntry[]
}

export const paymentProviderRegistry = paymentProviderRegistryForEnvironment(
  process.env.E2E_RUN === "true"
)

export function getRegisteredPaymentProvider(providerId: string) {
  return paymentProviderRegistry.find((provider) => provider.id === providerId)
}

export function isRegisteredPaymentProvider(providerId: string) {
  return Boolean(getRegisteredPaymentProvider(providerId))
}

export async function verifyPaymentProviderCredentials(input: {
  provider_id: string
  shop_id: string
  secret_key: string
}) {
  if (input.provider_id === "yookassa") {
    await verifyYooKassaCredentials(input)
  }
}

export function listAdminPaymentProviders(
  configurations: PaymentProviderConfigRecord[]
): AdminPaymentProvider[] {
  const configurationsByProvider = new Map(
    configurations.map((config) => [config.provider_id, config])
  )

  return paymentProviderRegistry.map((provider) => {
    const config = configurationsByProvider.get(provider.id)
    const isConfigured = Boolean(
      config?.shop_id?.trim() && config.encrypted_secret_key
    )

    return {
      id: provider.id,
      name: provider.name,
      is_enabled: isConfigured && (config?.is_enabled ?? false),
      is_configured: isConfigured,
      configuration_status: isConfigured
        ? "configured"
        : "requires_configuration",
      shop_id: config?.shop_id ?? null,
      mode: config?.mode ?? "test",
      secret_key_set: Boolean(config?.encrypted_secret_key),
      updated_at: config?.updated_at ?? null,
    }
  })
}

export function listAvailablePaymentProviders(
  configurations: PaymentProviderConfigRecord[],
  availability: PaymentProviderAvailabilityRecord[],
  providers: PaymentProviderRegistryEntry[] = paymentProviderRegistry
) {
  const enabledProviderIds = new Set(
    availability
      .filter((entry) => entry.is_enabled)
      .map((entry) => entry.provider_id)
  )
  const configuredProviderIds = new Set(
    configurations
      .filter(
        (config) =>
          config.is_enabled &&
          Boolean(config.shop_id?.trim() && config.encrypted_secret_key)
      )
      .map((config) => config.provider_id)
  )

  return providers
    .filter(
      (provider) =>
        enabledProviderIds.has(provider.id) &&
        configuredProviderIds.has(provider.id)
    )
    .map(({ id, name }) => ({ id, name }))
}
