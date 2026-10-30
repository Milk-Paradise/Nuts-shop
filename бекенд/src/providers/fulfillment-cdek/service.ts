import type {
  CalculateShippingOptionPriceDTO,
  CalculatedShippingOptionPrice,
  CreateFulfillmentResult,
  CreateShippingOptionDTO,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
  ValidateFulfillmentDataContext,
} from "@medusajs/framework/types"
import {
  AbstractFulfillmentProviderService,
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { ILockingModule, Logger } from "@medusajs/framework/types"

import { CDEK_PROVIDER_KEY } from "../../modules/shipping-provider-registry/provider-keys"
import {
  CdekClient,
  CdekApiError,
  type CdekCalculatedTariff,
  type CdekCity,
  type CdekDeliveryPoint,
  type CdekLabelRequest,
  type CdekTariff,
  type CdekTariffListInput,
} from "../../modules/shipping-provider-registry/cdek-client"
import {
  normalizeCdekCacheKey,
  type CdekCacheKey,
} from "../../modules/shipping-provider-registry/models/shipping-cdek-city-resolution-cache"
import {
  decryptShippingProviderCredentials,
  type ShippingProviderCredentials,
} from "../../modules/shipping-provider-registry/credentials"
import type ShippingProviderRegistryModuleService from "../../modules/shipping-provider-registry/service"

type InjectedDependencies = {
  shippingProviderRegistry: ShippingProviderRegistryModuleService
  [Modules.LOCKING]: ILockingModule
  [ContainerRegistrationKeys.LOGGER]: Logger
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

type ReturnShipmentInput = {
  return_id: string
  forward_shipment_id: string
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

type CreatedReturnShipment = {
  id: string
  tracking_number: string | null
  register_shipment: true
}

export type CdekCalculationContext = CalculateShippingOptionPriceDTO["context"]

export type CdekCityResolution =
  | { status: "resolved"; code: number; candidate: CdekCity }
  | { status: "not_found" }

type CdekCityResolutionAddress = {
  country_code: string
  city: string
  region?: string | null
  postal_code?: string | null
}

type CachedCdekCityResolution = {
  city_code: number
  candidate: unknown
}

type CdekLogEvent =
  | "cdek_city_resolve_cache_hit"
  | "cdek_city_resolve_cache_miss"
  | "cdek_city_resolve_not_found"
  | "cdek_city_resolve_ambiguous"
  | "cdek_city_resolve_directory_error"
  | "cdek_calculator_error"
  | "cdek_tariff_calculated"

type CdekLogInput = {
  level: "INFO" | "WARN" | "ERROR"
  event: CdekLogEvent
  fields: Record<string, string | number>
  message: string
}

const inProcessCityResolutions = new Map<string, Promise<CdekCityResolution>>()

export function formatCdekLog(input: CdekLogInput): string {
  const fields = Object.entries(input.fields)
    .map(([key, value]) => `${key}=${formatCdekLogValue(value)}`)
    .join(" ")

  return (
    `[catalog] level=${input.level} event=${input.event} ` +
    `${fields} message=${JSON.stringify(input.message)}`
  )
}

function formatCdekLogValue(value: string | number): string {
  const stringValue = String(value)
  return /[\s"\\]/u.test(stringValue) ? JSON.stringify(stringValue) : stringValue
}

function cityResolutionLogFields(key: CdekCacheKey): Record<string, string> {
  return {
    country_code: key.country_code,
    city: key.city,
    region: key.region || "-",
    postal_code: key.postal_code || "-",
  }
}

class CityResolutionLockUnavailableError extends Error {
  constructor(readonly cause: unknown) {
    super("CDEK city resolution lock is unavailable")
  }
}

export class CdekFulfillmentError extends Error {
  readonly isShippingProviderError = true as const
  readonly status: number | undefined

  constructor(error: CdekApiError) {
    super(error.message)
    this.name = "CdekFulfillmentError"
    this.status = error.status
  }
}

export default class CdekFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "cdek"

  protected readonly registry_: ShippingProviderRegistryModuleService
  protected readonly client_: CdekClient
  protected readonly locking_: ILockingModule
  protected readonly logger_: Logger

  constructor(dependencies: InjectedDependencies, options?: { client?: CdekClient }) {
    super()
    this.registry_ = dependencies.shippingProviderRegistry
    this.locking_ = dependencies[Modules.LOCKING]
    this.logger_ = dependencies[ContainerRegistrationKeys.LOGGER]
    this.client_ = options?.client ?? new CdekClient()
  }

  async testCredentials(credentials: { client_id: string; client_secret: string }) {
    return this.callCarrier(() => this.client_.testAuthorization(credentials))
  }

  async listPickupPoints(
    credentials: { client_id: string; client_secret: string }
  ): Promise<CdekDeliveryPoint[]> {
    return this.callCarrier(() => this.client_.listDeliveryPoints(credentials))
  }

  async listAvailableTariffs(
    credentials: { client_id: string; client_secret: string },
    input: CdekTariffListInput
  ): Promise<CdekTariff[]> {
    return this.callCarrier(() => this.client_.listAvailableTariffs(credentials, input))
  }

  async resolveCityCode(
    credentials: ShippingProviderCredentials,
    address: CdekCityResolutionAddress
  ): Promise<CdekCityResolution> {
    const key = normalizeCdekCacheKey(address)
    const cached = await this.findCachedCityResolution(key)
    if (cached?.status === "resolved") {
      this.logger_.info(formatCdekLog({
        level: "INFO",
        event: "cdek_city_resolve_cache_hit",
        fields: { ...cityResolutionLogFields(key), city_code: cached.code },
        message: "Город СДЭК найден в кэше.",
      }))
      return cached
    }

    const lockKey = `cdek-city-resolve:${key.country_code}:${key.city}:${key.region}:${key.postal_code}`
    try {
      return await this.withCityResolutionLock(lockKey, async () => {
        const afterLock = await this.findCachedCityResolution(key)
        if (afterLock) return afterLock

        let candidates: CdekCity[]
        try {
          candidates = await this.findCities(credentials, key)
        } catch (error) {
          this.logger_.error(formatCdekLog({
            level: "ERROR",
            event: "cdek_city_resolve_directory_error",
            fields: { ...cityResolutionLogFields(key), error_message: describeError(error) },
            message: "Не удалось получить города из справочника СДЭК.",
          }))
          throw error
        }
        const candidate = candidates[0]
        if (!candidate) {
          this.logger_.warn(formatCdekLog({
            level: "WARN",
            event: "cdek_city_resolve_not_found",
            fields: cityResolutionLogFields(key),
            message: "Город не найден в справочнике СДЭК.",
          }))
          return { status: "not_found" }
        }

        if (candidates.length > 1) {
          this.logger_.warn(formatCdekLog({
            level: "WARN",
            event: "cdek_city_resolve_ambiguous",
            fields: {
              ...cityResolutionLogFields(key),
              total_candidates: candidates.length,
              city_code: candidate.code,
            },
            message: "Справочник СДЭК вернул несколько городов; выбран первый кандидат.",
          }))
        } else {
          this.logger_.info(formatCdekLog({
            level: "INFO",
            event: "cdek_city_resolve_cache_miss",
            fields: {
              ...cityResolutionLogFields(key),
              status: "resolved",
              city_code: candidate.code,
            },
            message: "Город СДЭК разрешён через справочник.",
          }))
        }

        return this.persistCityResolution(key, candidate)
      })
    } catch (error) {
      if (!(error instanceof CityResolutionLockUnavailableError)) throw error

      const afterContention = await this.findCachedCityResolution(key)
      if (afterContention) return afterContention
      throw new CdekFulfillmentError(new CdekApiError(
        "Не удалось получить блокировку резолва города СДЭК. Повторите попытку позже.",
        502
      ))
    }
  }

  async requestFulfillmentLabel(
    credentials: { client_id: string; client_secret: string },
    shipmentId: string
  ): Promise<CdekLabelRequest> {
    return this.callCarrier(() => this.client_.requestBarcodeLabel(credentials, shipmentId))
  }

  async downloadFulfillmentLabel(
    credentials: { client_id: string; client_secret: string },
    requestId: string
  ): Promise<Buffer> {
    return this.callCarrier(() => this.client_.downloadBarcodeLabel(credentials, requestId))
  }

  async createReturnShipment(input: ReturnShipmentInput): Promise<CreatedReturnShipment> {
    const stored = await this.registry_.getProviderConfig(CDEK_PROVIDER_KEY)
    const storePackage = await this.registry_.getStorePackage()
    if (!stored?.encrypted_credentials || !storePackage) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Конфигурация СДЭК неполна.")
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
    const cdekData = input.order.shipping_methods?.find((method) => method.data?.cdekData)?.data
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
    const recovered = await this.callCarrier(() =>
      this.client_.findOrderByNumber(credentials, returnNumber)
    )
    const created = recovered ?? await this.callCarrier(() => this.client_.createOrder(credentials, {
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
            Math.floor(storePackage.weight_grams / Math.max(1, input.order.items?.length ?? 1))
          ),
          return_item_detail: {
            direct_order_uuid: input.forward_shipment_id,
            direct_package_number: `order-${input.order.display_id ?? input.order.id}`,
          },
        })),
      }],
    }))

    return {
      id: created.uuid,
      tracking_number: created.cdek_number,
      register_shipment: true,
    }
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      { id: "cdek-courier", name: "СДЭК: курьер", delivery_type: "courier" },
      { id: "cdek-pickup", name: "СДЭК: пункт выдачи", delivery_type: "pickup" },
    ]
  }

  async validateFulfillmentData(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: ValidateFulfillmentDataContext
  ) {
    return data
  }

  async validateOption(data: Record<string, unknown>) {
    return data.delivery_type === "courier" || data.delivery_type === "pickup"
  }

  async canCalculate(_data: CreateShippingOptionDTO) {
    return true
  }

  async calculateAvailableTariffs(
    context: CdekCalculationContext
  ): Promise<CdekCalculatedTariff[]> {
    const [visibility] = await this.registry_.listShippingProviderVisibilities({
      provider_key: CDEK_PROVIDER_KEY,
    })
    if (!visibility?.is_visible) return []

    const [stored, storePackage] = await Promise.all([
      this.registry_.getProviderConfig(CDEK_PROVIDER_KEY),
      this.registry_.getStorePackage(),
    ])
    if (!stored?.encrypted_credentials) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "СДЭК включён, но его конфигурация доставки неполна."
      )
    }
    if (!storePackage) return []

    const configuration = stored.configuration as CdekConfiguration
    const city = context.shipping_address?.city
    const countryCode = context.shipping_address?.country_code
    if (!city || !countryCode) return []
    if (
      !configuration.sender?.city ||
      !configuration.contract_type ||
      !configuration.tariff_codes?.length
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "СДЭК включён, но его конфигурация тарификации неполна."
      )
    }

    const weight = (context.items ?? []).reduce((sum, item) => {
      const quantity = Number(item.quantity)
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Количество товара для расчёта доставки должно быть положительным целым числом."
        )
      }
      const variantWeight = Number(item.variant?.weight)
      const unitWeight = Number.isFinite(variantWeight) && variantWeight > 0
        ? variantWeight
        : storePackage.weight_grams
      return sum + unitWeight * quantity
    }, 0)

    const credentials = decryptShippingProviderCredentials(stored.encrypted_credentials)
    const cityResolution = await this.resolveCityCode(credentials, {
      country_code: countryCode,
      city,
      postal_code: context.shipping_address?.postal_code,
    })
    if (cityResolution.status === "not_found") return []

    try {
      return await this.client_.calculateTariffs(
        credentials,
        {
          contract_type: configuration.contract_type,
          sender: {
            city: configuration.sender.city,
            postal_code: configuration.sender.postal_code ?? "",
          },
          recipient: {
            code: cityResolution.code,
            postal_code: context.shipping_address?.postal_code,
          },
          package: {
            weight_grams: weight > 0 ? weight : storePackage.weight_grams,
            length_mm: storePackage.length_mm,
            width_mm: storePackage.width_mm,
            height_mm: storePackage.height_mm,
          },
          tariff_codes: configuration.tariff_codes,
        }
      )
    } catch (error) {
      this.logger_.error(formatCdekLog({
        level: "ERROR",
        event: "cdek_calculator_error",
        fields: { error_message: describeError(error) },
        message: "Расчёт тарифов СДЭК завершился ошибкой.",
      }))
      throw error
    }
  }

  async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO["optionData"],
    _data: CalculateShippingOptionPriceDTO["data"],
    context: CalculateShippingOptionPriceDTO["context"]
  ): Promise<CalculatedShippingOptionPrice> {
    const tariffs = await this.calculateAvailableTariffs(context)
    const deliveryMode = optionData.delivery_type === "pickup" ? 2 : 1
    const eligible = tariffs.filter((tariff) => tariff.delivery_mode === deliveryMode)
    const selectedCode = Number(((_data?.cdekData as Record<string, unknown> | undefined)?.tariff_code))
    const selected = Number.isInteger(selectedCode)
      ? eligible.find((tariff) => tariff.code === selectedCode) ?? null
      : null
    const cheapest = selected ?? eligible.reduce<CdekCalculatedTariff | null>(
      (current, tariff) => !current || tariff.delivery_sum < current.delivery_sum ? tariff : current,
      null
    )
    if (!cheapest) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "СДЭК не вернул доступный тариф для выбранного способа доставки."
      )
    }

    this.logger_.info(formatCdekLog({
      level: "INFO",
      event: "cdek_tariff_calculated",
      fields: { delivery_mode: deliveryMode },
      message: "Тариф СДЭК успешно рассчитан для способа доставки.",
    }))

    return {
      calculated_amount: cheapest.delivery_sum,
      is_calculated_price_tax_inclusive: true,
      data: { tariff_codes: eligible },
    } as CalculatedShippingOptionPrice
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    if (!order?.id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Order id is required for CDEK fulfillment")
    }
    const orderId = order.id

    return this.locking_.execute(`cdek-shipment:${orderId}`, async () => {
      const existing = await this.registry_.listShippingShipments({
        order_id: orderId,
        provider_key: CDEK_PROVIDER_KEY,
        direction: "forward",
      })
      const legacyShipment = existing.find(({ direction }) => direction === "forward") ??
        existing.find(({ direction }) => direction == null)
      let shipment = legacyShipment
      let claimedNow = false
      if (!shipment) {
        if (!fulfillment.id) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "Fulfillment id is required for CDEK shipment identity"
          )
        }
        // Medusa's core fulfillment workflow removes the address id before
        // passing the order to the provider. The order itself is still the
        // stable destination for a forward shipment, so use it as the
        // deterministic fallback identity.
        const destinationKey = order.shipping_address?.id ?? `order:${orderId}`
        const claim = await this.registry_.claimShippingShipment({
          order_id: orderId,
          provider_key: CDEK_PROVIDER_KEY,
          business_action_id: fulfillment.id,
          direction: "forward",
          destination_key: destinationKey,
        })
        shipment = claim.shipment
        claimedNow = claim.created
      }
      if (!shipment) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Не удалось закрепить отправление СДЭК. Повторите попытку позже."
        )
      }
      if (shipment?.status === "created" && shipment.provider_shipment_id) {
        return {
          data: {
            ...data,
            cdek_uuid: shipment.provider_shipment_id,
            tracking_number: shipment.tracking_number,
          },
          labels: [],
        }
      }

      const stored = await this.registry_.getProviderConfig(CDEK_PROVIDER_KEY)
      if (!stored?.encrypted_credentials) {
        const failure = {
          status: "failed" as const,
          error_message: "Конфигурация СДЭК для создания отправки неполна.",
          reconciliation_required: false,
        }
        await this.registry_.updateShippingShipments({ id: shipment.id, ...failure })
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Конфигурация СДЭК для создания отправки неполна."
        )
      }
      const credentials = decryptShippingProviderCredentials(stored.encrypted_credentials)

      // A process can stop after CDEK accepted POST /orders but before the UUID
      // reached Postgres. Never blindly repeat such an ambiguous operation:
      // reconcile it by our stable order number first.
      if (!claimedNow && (shipment.status === "creating" || shipment.reconciliation_required)) {
        const recovered = await this.client_.findOrderByNumber(credentials, orderId)
        if (recovered) {
          await this.registry_.updateShippingShipments({
            id: shipment.id,
            status: "created",
            provider_shipment_id: recovered.uuid,
            tracking_number: recovered.cdek_number,
            error_message: null,
            reconciliation_required: false,
          })
          return {
            data: {
              ...data,
              cdek_uuid: recovered.uuid,
              tracking_number: recovered.cdek_number,
            },
            labels: [],
          }
        }
        await this.registry_.updateShippingShipments({
          id: shipment.id,
          status: "failed",
          error_message: "СДЭК ещё не подтвердил ранее начатое создание. Повторите сверку позже.",
          reconciliation_required: true,
        })
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "СДЭК ещё не подтвердил ранее начатое создание. Повторите сверку позже."
        )
      }

      const state = await this.registry_.updateShippingShipments({
        id: shipment.id,
        status: "creating",
        error_message: null,
        reconciliation_required: false,
      })

      try {
        const storePackage = await this.registry_.getStorePackage()
        if (!storePackage) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "Конфигурация СДЭК для создания отправки неполна."
          )
        }
        const configuration = stored.configuration as CdekConfiguration
        const address = order.shipping_address
        const cdekData = data.cdekData as Record<string, unknown> | undefined
        const tariffCode = Number(cdekData?.tariff_code)
        if (!configuration.sender?.city || !configuration.contract_type || !address?.city ||
          !Number.isInteger(tariffCode)) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "Данные заказа для создания отправки СДЭК неполны."
          )
        }
        const recipientName = [address.first_name, address.last_name].filter(Boolean).join(" ").trim()
        if (!recipientName || !address.phone) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "Для отправки СДЭК нужны имя и телефон получателя."
          )
        }
        const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)
        const unitWeight = Math.max(1, Math.floor(storePackage.weight_grams / Math.max(1, totalQuantity)))
        // From this point until UUID persistence, any process/transport failure
        // is ambiguous. Persist the intent before POST so a later retry only
        // reconciles by the stable order number and never blindly posts twice.
        await this.registry_.updateShippingShipments({
          id: state.id,
          reconciliation_required: true,
        })
        const deliveryPoint = typeof cdekData?.point_code === "string" ? cdekData.point_code : null
        const created = await this.client_.createOrder(
          credentials,
          {
            type: configuration.contract_type === "online_store" ? 1 : 2,
            number: orderId,
            tariff_code: tariffCode,
            ...(deliveryPoint ? { delivery_point: deliveryPoint } : {}),
            from_location: {
              city: configuration.sender.city,
              ...(configuration.sender.postal_code
                ? { postal_code: configuration.sender.postal_code }
                : {}),
            },
            // СДЭК отвергает запрос, где заданы одновременно delivery_point и
            // to_location (любое наличие адреса получателя, не только address) —
            // при доставке на ПВЗ место назначения определяется только кодом точки.
            ...(deliveryPoint ? {} : {
              to_location: {
                city: address.city,
                ...(address.postal_code ? { postal_code: address.postal_code } : {}),
                ...(address.address_1 ? { address: address.address_1 } : {}),
              },
            }),
            recipient: { name: recipientName, phones: [{ number: address.phone }] },
            packages: [{
              number: `order-${order.display_id ?? order.id}`,
              weight: storePackage.weight_grams,
              length: Math.ceil(storePackage.length_mm / 10),
              width: Math.ceil(storePackage.width_mm / 10),
              height: Math.ceil(storePackage.height_mm / 10),
              items: items.map((item, index) => ({
                name: item.title ?? `Товар ${index + 1}`,
                ware_key: item.sku ?? item.line_item_id ?? `item-${index + 1}`,
                payment: { value: 0 },
                cost: 0,
                amount: Number(item.quantity ?? 0),
                weight: unitWeight,
              })),
            }],
          }
        )
        // The POST only queues the order; CDEK validates it afterwards. Confirm
        // before calling the shipment created, otherwise an order CDEK rejected
        // would be stored as a real shipment that nobody can notice or delete.
        const confirmed = await this.client_.confirmOrderCreation(credentials, created.uuid)
        const trackingNumber = confirmed.cdek_number ?? created.cdek_number
        await this.registry_.updateShippingShipments({
          id: state.id,
          status: "created",
          provider_shipment_id: created.uuid,
          tracking_number: trackingNumber,
          error_message: null,
          reconciliation_required: false,
        })
        return {
          data: { ...data, cdek_uuid: created.uuid, tracking_number: trackingNumber },
          labels: [],
        }
      } catch (error) {
        await this.registry_.updateShippingShipments({
          id: state.id,
          status: "failed",
          error_message: describeError(error),
          reconciliation_required: error instanceof CdekApiError && error.mayHaveSucceeded,
        })
        throw error
      }
    }, { timeout: 15 })
  }

  async cancelFulfillment(data: Record<string, unknown>) {
    const orderUuid = typeof data.cdek_uuid === "string" ? data.cdek_uuid : null
    if (!orderUuid) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "CDEK shipment id is required")
    }
    const [shipment] = await this.registry_.listShippingShipments({
      provider_key: CDEK_PROVIDER_KEY,
      provider_shipment_id: orderUuid,
    })
    if (!shipment || shipment.simplified_status !== "placed") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Отправка уже принята перевозчиком и не может быть отменена."
      )
    }
    const stored = await this.registry_.getProviderConfig(CDEK_PROVIDER_KEY)
    if (!stored?.encrypted_credentials) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Конфигурация СДЭК для отмены отправки неполна."
      )
    }
    await this.client_.deleteOrder(
      decryptShippingProviderCredentials(stored.encrypted_credentials),
      orderUuid
    )
    await this.registry_.updateShippingShipments({
      id: shipment.id,
      simplified_status: "cancelled",
      status_event_at: new Date(),
    })
    return data
  }

  async createReturnFulfillment(_fulfillment: Record<string, unknown>) {
    return { data: {}, labels: [] }
  }

  private async callCarrier<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (error) {
      if (error instanceof CdekApiError) throw new CdekFulfillmentError(error)
      throw error
    }
  }

  private async findCachedCityResolution(
    key: CdekCacheKey
  ): Promise<CdekCityResolution | null> {
    const [cached] = await this.registry_.listShippingCdekCityResolutionCaches(key) as
      CachedCdekCityResolution[]
    if (!cached) return null

    return {
      status: "resolved",
      code: cached.city_code,
      candidate: cached.candidate as CdekCity,
    }
  }

  private async findCities(
    credentials: ShippingProviderCredentials,
    key: CdekCacheKey
  ): Promise<CdekCity[]> {
    try {
      return await this.client_.findCities(credentials, {
        country_code: key.country_code,
        city: key.city,
        ...(key.region ? { region: key.region } : {}),
      })
    } catch (error) {
      throw new CdekFulfillmentError(
        error instanceof CdekApiError
          ? error
          : new CdekApiError(describeError(error), 502)
      )
    }
  }

  private async persistCityResolution(
    key: CdekCacheKey,
    candidate: CdekCity
  ): Promise<CdekCityResolution> {
    const fetchedAt = new Date()
    try {
      await this.registry_.createShippingCdekCityResolutionCaches({
        ...key,
        city_code: candidate.code,
        candidate,
        fetched_at: fetchedAt,
        expires_at: new Date(fetchedAt.getTime() + 30 * 24 * 60 * 60 * 1_000),
      })
      return { status: "resolved", code: candidate.code, candidate }
    } catch (error) {
      // A concurrent process may have inserted the same normalized key before
      // this transaction reached the unique index. Its result is authoritative.
      const concurrent = await this.findCachedCityResolution(key)
      if (concurrent) return concurrent
      throw error
    }
  }

  private async withCityResolutionLock(
    key: string,
    work: () => Promise<CdekCityResolution>
  ): Promise<CdekCityResolution> {
    if (this.locking_ && typeof this.locking_.execute === "function") {
      let callbackStarted = false
      try {
        return await this.locking_.execute(key, async () => {
          callbackStarted = true
          return work()
        }, { timeout: 10 })
      } catch (error) {
        if (callbackStarted) throw error
        throw new CityResolutionLockUnavailableError(error)
      }
    }

    const existing = inProcessCityResolutions.get(key)
    if (existing) return existing
    const pending = work().finally(() => inProcessCityResolutions.delete(key))
    inProcessCityResolutions.set(key, pending)
    return pending
  }
}

function describeError(error: unknown) {
  if (error instanceof Error) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
