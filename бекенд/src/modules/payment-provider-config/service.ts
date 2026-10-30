import { MedusaService } from "@medusajs/framework/utils"

import { readPaymentProviderSecret } from "./crypto"
import PaymentProviderConfig from "./models/payment-provider-config"
import PaymentProviderAvailability from "./models/payment-provider-availability"
import {
  listAdminPaymentProviders,
  listAvailablePaymentProviders,
} from "./registry"
import {
  buildPaymentProviderConfigWriteData,
  toAdminPaymentProviderConfig,
  type PaymentProviderAvailabilityRecord,
  type PaymentProviderConfigRecord,
  type SavePaymentProviderConfigInput,
} from "./storage"

class PaymentProviderConfigModuleService extends MedusaService({
  PaymentProviderConfig,
  PaymentProviderAvailability,
}) {
  async savePaymentProviderConfig(input: SavePaymentProviderConfigInput) {
    const [existing] = (await this.listPaymentProviderConfigs({
      provider_id: input.provider_id,
    })) as PaymentProviderConfigRecord[]
    const writeData = buildPaymentProviderConfigWriteData(input, existing ?? null)

    if (existing) {
      return this.updatePaymentProviderConfigs({
        id: existing.id,
        ...writeData,
      })
    }

    return this.createPaymentProviderConfigs(writeData)
  }

  async retrieveAdminPaymentProviderConfig(providerId: string) {
    const [config] = (await this.listPaymentProviderConfigs({
      provider_id: providerId,
    })) as PaymentProviderConfigRecord[]

    return config ? toAdminPaymentProviderConfig(config) : null
  }

  async listAdminPaymentProviders() {
    const configurations = (await this.listPaymentProviderConfigs(
      {}
    )) as PaymentProviderConfigRecord[]

    return listAdminPaymentProviders(configurations)
  }

  async listStorePaymentProviders(input: {
    store_id: string
    region_id: string
  }) {
    const configurations = (await this.listPaymentProviderConfigs(
      {}
    )) as PaymentProviderConfigRecord[]
    const availability = (await this.listPaymentProviderAvailabilities({
      store_id: input.store_id,
      region_id: input.region_id,
      is_enabled: true,
    })) as PaymentProviderAvailabilityRecord[]

    return listAvailablePaymentProviders(configurations, availability)
  }

  async isPaymentProviderAvailable(
    providerId: string,
    input: { store_id: string; region_id: string }
  ) {
    const [availability] = (await this.listPaymentProviderAvailabilities({
      provider_id: providerId,
      store_id: input.store_id,
      region_id: input.region_id,
      is_enabled: true,
    })) as PaymentProviderAvailabilityRecord[]

    return Boolean(availability)
  }

  async setPaymentProviderAvailability(input: {
    provider_id: string
    store_id: string
    region_id: string
    is_enabled: boolean
  }) {
    const [existing] = (await this.listPaymentProviderAvailabilities({
      provider_id: input.provider_id,
      store_id: input.store_id,
      region_id: input.region_id,
    })) as PaymentProviderAvailabilityRecord[]

    if (existing) {
      return this.updatePaymentProviderAvailabilities({
        id: existing.id,
        is_enabled: input.is_enabled,
      })
    }

    return this.createPaymentProviderAvailabilities(input)
  }

  async retrieveRuntimePaymentProviderConfig(providerId: string) {
    const [config] = (await this.listPaymentProviderConfigs({
      provider_id: providerId,
    })) as PaymentProviderConfigRecord[]

    if (!config?.shop_id?.trim() || !config.encrypted_secret_key) {
      return null
    }

    if (providerId === "e2e" && process.env.E2E_RUN === "true") {
      return {
        provider_id: config.provider_id,
        shop_id: config.shop_id,
        secret_key: "e2e-stub-does-not-use-secrets",
        mode: config.mode,
        is_enabled: config.is_enabled,
      }
    }

    const decryptedSecret = readPaymentProviderSecret(
      config.encrypted_secret_key
    )

    if (decryptedSecret.reencrypted) {
      await this.updatePaymentProviderConfigs({
        id: config.id,
        encrypted_secret_key: decryptedSecret.reencrypted,
      })
    }

    return {
      provider_id: config.provider_id,
      shop_id: config.shop_id,
      secret_key: decryptedSecret.plaintext,
      mode: config.mode,
      is_enabled: config.is_enabled,
    }
  }
}

export default PaymentProviderConfigModuleService
