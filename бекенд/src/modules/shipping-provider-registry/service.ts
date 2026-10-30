import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import {
  CdekApiError,
  CdekClient,
  type CdekTariff,
  type CdekTariffListInput,
  type CdekDeliveryPoint,
} from "./cdek-client"
import { OzonApiError, OzonClient, type PickupPoint } from "./ozon-client"
import ShippingProviderVisibility from "./models/shipping-provider-visibility"
import ShippingProviderConfig from "./models/shipping-provider-config"
import ShippingReturnRequest from "./models/shipping-return-request"
import ShippingStorePackage from "./models/shipping-store-package"
import ShippingPickupPoint from "./models/shipping-pickup-point"
import ShippingCdekCityResolutionCache from "./models/shipping-cdek-city-resolution-cache"
import ShippingShipment from "./models/shipping-shipment"
import ShippingWebhookEvent from "./models/shipping-webhook-event"
import {
  decryptShippingProviderCredentials,
  encryptShippingProviderCredentials,
  readShippingProviderCredentials,
  type ShippingProviderCredentials,
} from "./credentials"
import { CDEK_PROVIDER_KEY, OZON_PROVIDER_KEY } from "./provider-keys"
import { CdekFulfillmentError } from "../../providers/fulfillment-cdek/service"
import { OzonFulfillmentError } from "../../providers/fulfillment-ozon/service"

const STORE_PACKAGE_ID = "default"

export type SaveShippingProviderConfigInput = {
  providerKey: string
  credentials?: ShippingProviderCredentials
  configuration: Record<string, unknown>
}

export type SaveShippingStorePackageInput = {
  weight_grams: number
  length_mm: number
  width_mm: number
  height_mm: number
}

export type ClaimShippingShipmentInput = {
  order_id: string
  provider_key: string
  business_action_id: string
  direction: "forward" | "return"
  destination_key: string
}

export type ShippingProviderKey =
  | typeof CDEK_PROVIDER_KEY
  | typeof OZON_PROVIDER_KEY

type CarrierReturnShipmentInput = {
  return_id: string
  forward_shipment_id: string
  reason: string
  order: {
    id: string
    display_id?: number | null
    shipping_address?: {
      city?: string | null
      postal_code?: string | null
      address_1?: string | null
      phone?: string | null
    } | null
    items?: Array<{
      id: string
      title?: string | null
      variant_sku?: string | null
      quantity?: number | null
    }> | null
    shipping_methods?: Array<{ data?: Record<string, unknown> | null }> | null
  }
}

type CreatedCarrierReturnShipment = {
  id: string
  tracking_number: string | null
  register_shipment: boolean
}

type CdekConfiguration = {
  sender?: {
    city?: string
    postal_code?: string
    street?: string
    contact_name?: string
    phone?: string
  }
  contract_type?: "online_store" | "delivery"
  tariff_codes?: number[]
}

class ShippingProviderRegistryModuleService extends MedusaService({
  ShippingProviderVisibility,
  ShippingProviderConfig,
  ShippingReturnRequest,
  ShippingStorePackage,
  ShippingPickupPoint,
  ShippingCdekCityResolutionCache,
  ShippingShipment,
  ShippingWebhookEvent,
}) {
  private cdekClient_?: CdekClient
  private ozonClient_?: OzonClient

  async listCdekTariffs(
    credentials: ShippingProviderCredentials,
    input: CdekTariffListInput
  ): Promise<CdekTariff[]> {
    try {
      return await (this.cdekClient_ ??= new CdekClient())
        .listAvailableTariffs(credentials, input)
    } catch (error) {
      const carrierError = error instanceof CdekApiError
        ? error
        : new CdekApiError(describeError(error), 502)
      throw new CdekFulfillmentError(carrierError)
    }
  }

  async testProviderCredentials(
    providerKey: ShippingProviderKey,
    credentials: ShippingProviderCredentials
  ): Promise<void> {
    if (providerKey === CDEK_PROVIDER_KEY) {
      try {
        await (this.cdekClient_ ??= new CdekClient()).testAuthorization(credentials)
        return
      } catch (error) {
        const carrierError = error instanceof CdekApiError
          ? error
          : new CdekApiError(describeError(error), 502)
        throw new CdekFulfillmentError(carrierError)
      }
    }

    if (providerKey === OZON_PROVIDER_KEY) {
      try {
        await (this.ozonClient_ ??= new OzonClient()).testAuthorization(credentials)
        return
      } catch (error) {
        const carrierError = error instanceof OzonApiError
          ? error
          : new OzonApiError(
              describeError(error),
              502,
              "CLIENT_ERROR",
              true,
              false
            )
        throw new OzonFulfillmentError(carrierError)
      }
    }

    throw new MedusaError(
      MedusaError.Types.INVALID_ARGUMENT,
      `Unsupported shipping provider: ${providerKey}`
    )
  }

  async createCarrierReturnShipment(
    providerKey: ShippingProviderKey,
    input: CarrierReturnShipmentInput
  ): Promise<CreatedCarrierReturnShipment> {
    if (providerKey === CDEK_PROVIDER_KEY) {
      const stored = await this.getProviderConfig(CDEK_PROVIDER_KEY)
      const storePackage = await this.getStorePackage()
      if (!stored?.encrypted_credentials || !storePackage) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Конфигурация СДЭК неполна."
        )
      }

      const configuration = stored.configuration as CdekConfiguration
      const customer = input.order.shipping_address
      const customerCity = customer?.city
      const customerPhone = customer?.phone
      const senderCity = configuration.sender?.city
      const senderPostalCode = configuration.sender?.postal_code
      const senderStreet = configuration.sender?.street
      const senderContactName = configuration.sender?.contact_name
      const senderPhone = configuration.sender?.phone
      const cdekData = input.order.shipping_methods
        ?.find((method) => method.data?.cdekData)?.data
        ?.cdekData as Record<string, unknown> | undefined
      const tariffCode = Number(cdekData?.tariff_code)
      if (!senderCity || !senderContactName || !senderPhone ||
        !customerCity || !customerPhone || !Number.isInteger(tariffCode)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Для обратной отправки не хватает адреса, контактов или тарифа."
        )
      }

      const credentials = decryptShippingProviderCredentials(stored.encrypted_credentials)
      const returnNumber = `return-${input.return_id}`
      try {
        const client = this.cdekClient_ ??= new CdekClient()
        const recovered = await client.findOrderByNumber(credentials, returnNumber)
        const created = recovered ?? await client.createOrder(credentials, {
          type: configuration.contract_type === "online_store" ? 1 : 2,
          number: returnNumber,
          tariff_code: tariffCode,
          is_return: true,
          from_location: {
            city: customerCity,
            ...(customer?.postal_code ? { postal_code: customer.postal_code } : {}),
            ...(customer?.address_1 ? { address: customer.address_1 } : {}),
          },
          to_location: {
            city: senderCity,
            ...(senderPostalCode ? { postal_code: senderPostalCode } : {}),
            ...(senderStreet ? { address: senderStreet } : {}),
          },
          recipient: {
            name: senderContactName,
            phones: [{ number: senderPhone }],
          },
          packages: [{
            number: `return-order-${input.order.display_id ?? input.order.id}`,
            weight: storePackage.weight_grams,
            length: Math.ceil(storePackage.length_mm / 10),
            width: Math.ceil(storePackage.width_mm / 10),
            height: Math.ceil(storePackage.height_mm / 10),
            items: (input.order.items ?? []).map((item, index) => ({
              name: item.title ?? `Товар ${index + 1}`,
              ware_key: item.variant_sku ?? item.id,
              payment: { value: 0 },
              cost: 0,
              amount: Number(item.quantity ?? 1),
              weight: Math.max(
                1,
                Math.floor(
                  storePackage.weight_grams /
                  Math.max(1, input.order.items?.length ?? 1)
                )
              ),
              return_item_detail: {
                direct_order_uuid: input.forward_shipment_id,
                direct_package_number:
                  `order-${input.order.display_id ?? input.order.id}`,
              },
            })),
          }],
        })

        return {
          id: created.uuid,
          tracking_number: created.cdek_number,
          register_shipment: true,
        }
      } catch (error) {
        const carrierError = error instanceof CdekApiError
          ? error
          : new CdekApiError(describeError(error), 502)
        throw new CdekFulfillmentError(carrierError)
      }
    }

    if (providerKey === OZON_PROVIDER_KEY) {
      const stored = await this.getProviderConfig(OZON_PROVIDER_KEY)
      if (!stored?.encrypted_credentials) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Конфигурация Ozon для доставки неполна."
        )
      }
      const credentials = decryptShippingProviderCredentials(stored.encrypted_credentials)

      try {
        const created = await (this.ozonClient_ ??= new OzonClient()).createReturn(
          credentials,
          {
            shipment_id: input.forward_shipment_id,
            external_number: `return-${input.return_id}`,
            reason: input.reason,
          },
          `return:${input.return_id}`
        )
        return {
          id: created.id,
          tracking_number: null,
          register_shipment: false,
        }
      } catch (error) {
        const carrierError = error instanceof OzonApiError
          ? error
          : new OzonApiError(
              describeError(error),
              502,
              "CLIENT_ERROR",
              true,
              false
            )
        throw new OzonFulfillmentError(carrierError)
      }
    }

    throw new MedusaError(
      MedusaError.Types.INVALID_ARGUMENT,
      `Unsupported shipping provider: ${providerKey}`
    )
  }

  async verifyOzonWebhookSignature(
    rawBody: string | Buffer,
    headers: Headers | Record<string, string | string[] | undefined>,
    secret: string
  ): Promise<boolean> {
    return (this.ozonClient_ ??= new OzonClient()).verifyWebhook(
      rawBody,
      headers,
      secret
    )
  }

  async listCdekPickupPoints(
    credentials: ShippingProviderCredentials
  ): Promise<CdekDeliveryPoint[]> {
    try {
      return await (this.cdekClient_ ??= new CdekClient()).listDeliveryPoints(
        credentials
      )
    } catch (error) {
      const carrierError = error instanceof CdekApiError
        ? error
        : new CdekApiError(describeError(error), 502)
      throw new CdekFulfillmentError(carrierError)
    }
  }

  async listOzonPickupPoints(
    credentials: ShippingProviderCredentials
  ): Promise<PickupPoint[]> {
    try {
      return await (this.ozonClient_ ??= new OzonClient()).listPickupPoints(
        credentials
      )
    } catch (error) {
      const carrierError = error instanceof OzonApiError
        ? error
        : new OzonApiError(
            describeError(error),
            502,
            "CLIENT_ERROR",
            true,
            false
          )
      throw new OzonFulfillmentError(carrierError)
    }
  }

  async requestCdekFulfillmentLabel(
    credentials: ShippingProviderCredentials,
    shipmentId: string
  ) {
    try {
      return await (this.cdekClient_ ??= new CdekClient()).requestBarcodeLabel(
        credentials,
        shipmentId
      )
    } catch (error) {
      const carrierError = error instanceof CdekApiError
        ? error
        : new CdekApiError(describeError(error), 502)
      throw new CdekFulfillmentError(carrierError)
    }
  }

  async downloadCdekFulfillmentLabel(
    credentials: ShippingProviderCredentials,
    requestId: string
  ) {
    try {
      return await (this.cdekClient_ ??= new CdekClient()).downloadBarcodeLabel(
        credentials,
        requestId
      )
    } catch (error) {
      const carrierError = error instanceof CdekApiError
        ? error
        : new CdekApiError(describeError(error), 502)
      throw new CdekFulfillmentError(carrierError)
    }
  }


  async getProviderConfig(providerKey: string) {
    const [config] = await this.listShippingProviderConfigs({
      provider_key: providerKey,
    })

    if (!config?.encrypted_credentials) return config ?? null

    const { reencryptedCredentials } = readShippingProviderCredentials(
      config.encrypted_credentials
    )

    if (!reencryptedCredentials) return config

    await this.updateShippingProviderConfigs({
      id: config.id,
      encrypted_credentials: reencryptedCredentials,
    })

    return { ...config, encrypted_credentials: reencryptedCredentials }
  }

  async saveProviderConfig(input: SaveShippingProviderConfigInput) {
    const existing = await this.getProviderConfig(input.providerKey)
    const encryptedCredentials = input.credentials
      ? encryptShippingProviderCredentials(input.credentials)
      : existing?.encrypted_credentials ?? null

    if (existing) {
      return this.updateShippingProviderConfigs({
        id: existing.id,
        configuration: input.configuration,
        encrypted_credentials: encryptedCredentials,
      })
    }

    return this.createShippingProviderConfigs({
      provider_key: input.providerKey,
      configuration: input.configuration,
      encrypted_credentials: encryptedCredentials,
    })
  }

  async getStorePackage() {
    const [storePackage] = await this.listShippingStorePackages({
      id: STORE_PACKAGE_ID,
    })

    return storePackage ?? null
  }

  async saveStorePackage(input: SaveShippingStorePackageInput) {
    const existing = await this.getStorePackage()

    if (existing) {
      return this.updateShippingStorePackages({ id: STORE_PACKAGE_ID, ...input })
    }

    return this.createShippingStorePackages({ id: STORE_PACKAGE_ID, ...input })
  }

  async claimShippingShipment(input: ClaimShippingShipmentInput) {
    const identity = {
      business_action_id: input.business_action_id,
      direction: input.direction,
      destination_key: input.destination_key,
    }
    const findExisting = async () => {
      const [shipment] = await this.listShippingShipments(identity)
      return shipment ?? null
    }
    const existing = await findExisting()
    if (existing) return { shipment: existing, created: false as const }

    try {
      const shipment = await this.createShippingShipments({
        ...input,
        status: "creating",
      })
      return { shipment, created: true as const }
    } catch (error) {
      // A concurrent transaction may have won the unique identity claim.
      const concurrent = await findExisting()
      if (concurrent) return { shipment: concurrent, created: false as const }
      throw error
    }
  }
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export default ShippingProviderRegistryModuleService
