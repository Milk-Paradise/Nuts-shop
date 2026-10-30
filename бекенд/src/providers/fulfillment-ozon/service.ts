import type {
  CalculateShippingOptionPriceDTO,
  CalculatedShippingOptionPrice,
  CreateFulfillmentResult,
  CreateShippingOptionDTO,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
  ICacheService,
  ILockingModule,
  ValidateFulfillmentDataContext,
} from "@medusajs/framework/types"
import {
  AbstractFulfillmentProviderService,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

import {
  OzonClient,
  OzonApiError,
  type PickupPoint,
  type Shipment,
  type Tariff,
} from "../../modules/shipping-provider-registry/ozon-client"
import {
  decryptShippingProviderCredentials,
  type ShippingProviderCredentials,
} from "../../modules/shipping-provider-registry/credentials"
import { OZON_PROVIDER_KEY } from "../../modules/shipping-provider-registry/provider-keys"
import type ShippingProviderRegistryModuleService from "../../modules/shipping-provider-registry/service"

export { OZON_PROVIDER_KEY }
const DEFAULT_PICKUP_POINT_CACHE_TTL_SECONDS = 60 * 60

export type TariffOption = {
  code: string
  name: string
  price: number
  type: string
  currency: string
  delivery_days_min: number | null
  delivery_days_max: number | null
}

export type Money = CalculatedShippingOptionPrice & {
  amount: number
  currency: string
  currency_code: string
  data: { tariffs: TariffOption[]; selected_tariff: TariffOption }
}

export type NormalizedPickupPoint = {
  id: string
  name: string
  address: string
  city: string | null
  latitude: number | null
  longitude: number | null
  working_hours: string | null
  max_weight_grams: number | null
}

export type OzonFulfillment = {
  id: string
  tracking_number: string | null
  status: string | null
  data: Record<string, unknown>
}

export class OzonFulfillmentError extends Error {
  readonly isShippingProviderError = true as const
  readonly status: number

  constructor(error: OzonApiError) {
    super(error.message)
    this.name = "OzonFulfillmentError"
    this.status = error.status
  }
}

type OzonConfiguration = {
  sender?: {
    city?: string
    postal_code?: string
  }
  max_weight_grams?: number
  pickup_point_cache_ttl_seconds?: number
}

type InjectedDependencies = {
  shippingProviderRegistry?: ShippingProviderRegistryModuleService
  cacheService?: ICacheService
  cache?: ICacheService
  locking?: ILockingModule
}

type ServiceOptions = {
  client?: OzonClient
  credentials?: ShippingProviderCredentials
  configuration?: OzonConfiguration
  pickupPointCacheTtlSeconds?: number
}

type CalculationInput = Partial<CalculateShippingOptionPriceDTO["context"]> & {
  city?: string
  postal_code?: string
  weight_grams?: number
  package?: {
    weight_grams?: number
    length_mm?: number
    width_mm?: number
    height_mm?: number
  }
}

type ValidationContext = Partial<ValidateFulfillmentDataContext> & {
  city?: string
  weight_grams?: number
  cart_id?: string
}

type CustomCreateFulfillmentInput = Record<string, unknown> & {
  idempotency_key?: string
  order_id?: string
  external_number?: string
}

type ForwardShipmentInput = {
  data: CustomCreateFulfillmentInput
  items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[]
  order: Partial<FulfillmentOrderDTO> | undefined
  fulfillment_id: string | null
  order_id: string
  point_id: string | null
  credentials: ShippingProviderCredentials
  idempotency_key: string
}

type ReturnShipmentInput = {
  return_id: string
  forward_shipment_id: string
  reason: string
}

type CreatedReturnShipment = {
  id: string
  tracking_number: null
  register_shipment: false
}

/**
 * High-level Ozon Delivery provider. Ozon-specific HTTP details stay in
 * OzonClient; this class owns Medusa validation, normalization and caching.
 */
export default class OzonFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "ozon"

  protected client_: OzonClient | undefined
  protected readonly registry_?: ShippingProviderRegistryModuleService
  protected readonly cache_: ICacheService
  protected readonly locking_?: ILockingModule
  protected readonly options_: ServiceOptions

  constructor(dependencies: InjectedDependencies, options: ServiceOptions = {}) {
    super()
    // Do not construct the HTTP client during Medusa boot: the test endpoint is
    // intentionally optional until Ozon is enabled and configured.
    this.client_ = options.client
    this.registry_ = dependencies.shippingProviderRegistry
    this.locking_ = dependencies[Modules.LOCKING]
    // Awilix throws when a missing cradle property is accessed, so resolve the
    // canonical Medusa module key first. The explicit cacheService alias is
    // retained for direct unit-test construction.
    const cache = dependencies[Modules.CACHE] ?? dependencies.cacheService
    this.options_ = options

    if (!cache) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Medusa cache service is required for Ozon fulfillment"
      )
    }
    this.cache_ = cache
  }

  async testCredentials(credentials: ShippingProviderCredentials): Promise<void> {
    await this.callCarrier(() => this.client().testAuthorization(credentials))
  }

  async listPickupPoints(credentials: ShippingProviderCredentials): Promise<PickupPoint[]> {
    return this.callCarrier(() => this.client().listPickupPoints(credentials))
  }

  verifyWebhook(
    rawBody: string | Buffer,
    headers: Headers | Record<string, string | string[] | undefined>,
    secret: string
  ) {
    return this.client().verifyWebhook(rawBody, headers, secret)
  }

  async createReturnShipment(input: ReturnShipmentInput): Promise<CreatedReturnShipment> {
    const { credentials } = await this.providerSettings()
    const created = await this.callCarrier(() => this.client().createReturn(
      credentials,
      {
        shipment_id: input.forward_shipment_id,
        external_number: `return-${input.return_id}`,
        reason: input.reason,
      },
      `return:${input.return_id}`
    ))
    return {
      id: created.id,
      tracking_number: null,
      // Ozon historically does not register a reverse shipping_shipment: the
      // former workflow returned before claimShippingShipment. This inherited
      // behavior is preserved; its business reason is not established.
      register_shipment: false,
    }
  }

  async getFulfillmentOptions(_input?: unknown): Promise<FulfillmentOption[]> {
    return [
      { id: "ozon-courier", name: "Ozon: курьер", delivery_type: "courier" },
      { id: "ozon-pickup", name: "Ozon: пункт выдачи", delivery_type: "pickup" },
    ]
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: ValidateFulfillmentDataContext
  ): Promise<Record<string, unknown>> {
    const valid = await this.validateOption({ ...optionData, ...data }, context)
    if (!valid) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Выбранный пункт выдачи Ozon недоступен для города или веса заказа."
      )
    }
    return data
  }

  async validateOption(
    option: Record<string, unknown>,
    context: ValidationContext = {}
  ): Promise<boolean> {
    const deliveryType = stringValue(option.delivery_type ?? option.type)
    if (deliveryType !== "pickup" && deliveryType !== "courier") return false
    if (deliveryType === "courier") return true

    const pointId = stringValue(
      option.pickup_point_id ?? option.delivery_point_id ?? option.point_id
    )
    const city = cityFrom(context)
    if (!pointId || !city) return false

    let weight: number
    try {
      const storePackage = await this.registry_?.getStorePackage()
      if (!storePackage) return false
      weight = await this.resolveWeight(context, storePackage.weight_grams)
    } catch (error) {
      if (error instanceof MedusaError) return false
      throw error
    }
    const { configuration } = await this.providerSettings()
    if (!isAllowedWeight(weight, configuration.max_weight_grams)) return false

    const points = await this.pickupPoints(city)
    const point = points.find((candidate) => candidate.id === pointId)
    if (!point || normalizeCity(point.city) !== normalizeCity(city)) return false
    if (!isAllowedWeight(weight, point.max_weight_grams)) return false

    const selectionKey = this.selectionCacheKey(context)
    if (selectionKey) {
      const previous = await this.cache_.get<{ point_id: string; city: string }>(selectionKey)
      if (previous && previous.point_id !== pointId) {
        await this.cache_.invalidate(this.pickupPointsCacheKey(previous.city))
        if (normalizeCity(previous.city) !== normalizeCity(city)) {
          await this.cache_.invalidate(this.pickupPointsCacheKey(city))
        }
      }
      await this.cache_.set(
        selectionKey,
        { point_id: pointId, city },
        this.pickupPointCacheTtl(configuration)
      )
    }

    return true
  }

  async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    return true
  }

  async calculateAvailableTariffs(input: CalculationInput): Promise<TariffOption[]> {
    return this.withMedusaError("Не удалось рассчитать тарифы Ozon.", async () => {
      const city = cityFrom(input)
      if (!city) return []

      const [{ credentials, configuration }, storePackage] = await Promise.all([
        this.providerSettings(),
        this.registry_?.getStorePackage() ?? Promise.resolve(null),
      ])
      if (!configuration.sender?.city) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Город отправителя обязателен для расчёта доставки Ozon."
        )
      }
      if (!storePackage) return []
      const weight = await this.resolveWeight(input, storePackage.weight_grams)
      if (!isAllowedWeight(weight, configuration.max_weight_grams)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Вес заказа недопустим для доставки Ozon."
        )
      }

      const tariffs = await this.client().calculateTariffs(credentials, {
        from: {
          city: configuration.sender?.city,
          postal_code: configuration.sender?.postal_code,
        },
        to: {
          city,
          postal_code: input.postal_code ?? input.shipping_address?.postal_code,
        },
        packages: [{
          weight_grams: weight,
          length_mm: storePackage.length_mm,
          width_mm: storePackage.width_mm,
          height_mm: storePackage.height_mm,
        }],
      })

      return tariffs.map(normalizeTariff).filter(validTariff)
    })
  }

  async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO["optionData"],
    dataOrInput: CalculateShippingOptionPriceDTO["data"] | CalculationInput,
    context?: CalculateShippingOptionPriceDTO["context"]
  ): Promise<Money> {
    const input = (context ?? dataOrInput) as CalculationInput
    const methodData = context ? dataOrInput as Record<string, unknown> : {}
    const tariffs = await this.calculateAvailableTariffs(input)
    const type = stringValue(optionData.delivery_type ?? optionData.type)
    const eligible = type
      ? tariffs.filter((tariff) => tariff.type === type)
      : tariffs
    const requestedCode = stringValue(
      methodData.tariff_code ?? optionData.tariff_code ??
      nestedValue(methodData.ozonData, "tariff_code")
    )
    const selected = requestedCode
      ? eligible.find((tariff) => tariff.code === requestedCode)
      : cheapestTariff(eligible)

    if (!selected) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Ozon не вернул доступный тариф для выбранного способа доставки."
      )
    }

    return {
      amount: selected.price,
      currency: selected.currency,
      currency_code: selected.currency,
      calculated_amount: selected.price,
      is_calculated_price_tax_inclusive: true,
      data: { tariffs: eligible, selected_tariff: selected },
    }
  }

  async createFulfillment(
    input: CustomCreateFulfillmentInput,
    idempotencyKey: string
  ): Promise<OzonFulfillment>
  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult>
  async createFulfillment(
    data: CustomCreateFulfillmentInput,
    itemsOrIdempotencyKey: string | Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order?: Partial<FulfillmentOrderDTO>,
    fulfillment?: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<OzonFulfillment | CreateFulfillmentResult> {
    return this.withMedusaError("Не удалось создать отправление Ozon.", async () => {
      const medusaCall = Array.isArray(itemsOrIdempotencyKey)
      const idempotencyKey = medusaCall
        ? stringValue(fulfillment?.id ?? order?.id)
        : itemsOrIdempotencyKey
      if (!idempotencyKey) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Idempotency key is required for Ozon fulfillment"
        )
      }

      const { credentials, configuration } = await this.providerSettings()
      const orderId = stringValue(data.external_number ?? data.order_id ?? order?.id)
      if (!orderId) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Order id is required for Ozon fulfillment"
        )
      }
      const pointId = stringValue(
        data.pickup_point_id ?? data.delivery_point_id ?? data.point_id ??
        nestedValue(data.ozonData, "pickup_point_id")
      )
      const city = stringValue(data.city ?? order?.shipping_address?.city)
      const weightInput = medusaCall
        ? { ...data, items: itemsOrIdempotencyKey, city } as unknown as CalculationInput
        : data as unknown as CalculationInput
      const weight = await this.resolveWeight(weightInput)
      if (!isAllowedWeight(weight, configuration.max_weight_grams)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Вес заказа недопустим для доставки Ozon."
        )
      }

      if (pointId) {
        const valid = await this.validateOption(
          { delivery_type: "pickup", pickup_point_id: pointId },
          {
            city: city ?? undefined,
            weight_grams: weight,
            cart_id: orderId ?? undefined,
          }
        )
        if (!valid) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "Выбранный пункт выдачи Ozon недоступен для города или веса заказа."
          )
        }
      }

      if (medusaCall) {
        return this.createForwardShipment({
          data,
          items: itemsOrIdempotencyKey,
          order,
          fulfillment_id: stringValue(fulfillment?.id),
          order_id: orderId,
          point_id: pointId,
          credentials,
          idempotency_key: idempotencyKey,
        })
      }

      const shipment = await this.client().createShipment(
        credentials,
        {
          ...data,
          external_number: orderId,
          delivery_point_id: pointId,
          items: medusaCall ? itemsOrIdempotencyKey : data.items,
          recipient: medusaCall ? order?.shipping_address : data.recipient,
        },
        idempotencyKey
      )
      const normalized = normalizeShipment(shipment, data)

      return normalized
    })
  }

  async cancelFulfillment(
    fulfillment: Record<string, unknown>,
    _reason?: string
  ): Promise<boolean> {
    return this.withMedusaError("Не удалось отменить отправление Ozon.", async () => {
      const shipmentId = stringValue(
        fulfillment.ozon_shipment_id ?? fulfillment.shipment_id ?? fulfillment.id
      )
      if (!shipmentId) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Ozon shipment id is required"
        )
      }
      const { credentials } = await this.providerSettings()
      return this.client().cancelShipment(credentials, shipmentId)
    })
  }

  private async createForwardShipment(input: ForwardShipmentInput): Promise<CreateFulfillmentResult> {
    if (!this.registry_) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Реестр отправлений обязателен для создания отправления Ozon."
      )
    }
    if (!input.fulfillment_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Fulfillment id is required for Ozon shipment identity"
      )
    }

    const create = async () => {
      const existing = await this.registry_!.listShippingShipments({
        order_id: input.order_id,
        provider_key: OZON_PROVIDER_KEY,
        direction: "forward",
      })
      const legacyShipment = existing.find(({ direction }) => direction === "forward") ??
        existing.find(({ direction }) => direction == null)
      let shipment = legacyShipment
      let claimedNow = false
      if (!shipment) {
        const destinationKey = input.order?.shipping_address?.id ?? `order:${input.order_id}`
        const claim = await this.registry_!.claimShippingShipment({
          order_id: input.order_id,
          provider_key: OZON_PROVIDER_KEY,
          business_action_id: input.fulfillment_id!,
          direction: "forward",
          destination_key: destinationKey,
        })
        shipment = claim.shipment
        claimedNow = claim.created
      }
      if (!shipment) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Не удалось закрепить отправление Ozon. Повторите попытку позже."
        )
      }
      if (shipment.status === "created" && shipment.provider_shipment_id) {
        return fulfillmentResult(input.data, {
          id: shipment.provider_shipment_id,
          tracking_number: shipment.tracking_number,
          status: null,
        })
      }

      // Persist the claim before the carrier call. A retried fulfillment then
      // reconciles by the external order number instead of creating a duplicate.
      if (!claimedNow && (shipment.status === "creating" || shipment.reconciliation_required)) {
        const recovered = await this.client().findShipmentByExternalNumber(
          input.credentials,
          input.order_id
        )
        if (recovered) {
          const normalized = normalizeShipment(recovered, input.data)
          await this.registry_!.updateShippingShipments({
            id: shipment.id,
            status: "created",
            provider_shipment_id: normalized.id,
            tracking_number: normalized.tracking_number,
            error_message: null,
            reconciliation_required: false,
          })
          return fulfillmentResult(input.data, normalized)
        }
        await this.registry_!.updateShippingShipments({
          id: shipment.id,
          status: "failed",
          error_message: "Ozon ещё не подтвердил ранее начатое создание. Повторите сверку позже.",
          reconciliation_required: true,
        })
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Ozon ещё не подтвердил ранее начатое создание. Повторите сверку позже."
        )
      }

      const state = await this.registry_!.updateShippingShipments({
        id: shipment.id,
        status: "creating",
        error_message: null,
        reconciliation_required: false,
      })
      try {
        await this.registry_!.updateShippingShipments({
          id: state.id,
          reconciliation_required: true,
        })
        const created = await this.client().createShipment(
          input.credentials,
          {
            ...input.data,
            external_number: input.order_id,
            delivery_point_id: input.point_id,
            items: input.items,
            recipient: input.order?.shipping_address,
          },
          input.idempotency_key
        )
        const normalized = normalizeShipment(created, input.data)
        await this.registry_!.updateShippingShipments({
          id: state.id,
          status: "created",
          provider_shipment_id: normalized.id,
          tracking_number: normalized.tracking_number,
          error_message: null,
          reconciliation_required: false,
        })
        return fulfillmentResult(input.data, normalized)
      } catch (error) {
        await this.registry_!.updateShippingShipments({
          id: state.id,
          status: "failed",
          error_message: describeError(error),
          reconciliation_required: error instanceof OzonApiError && error.mayHaveSucceeded,
        })
        throw error
      }
    }

    return this.locking_
      ? this.locking_.execute(`ozon-shipment:${input.order_id}`, create, { timeout: 15 })
      : create()
  }

  private async pickupPoints(city: string): Promise<NormalizedPickupPoint[]> {
    const cacheKey = this.pickupPointsCacheKey(city)
    const cached = await this.cache_.get<NormalizedPickupPoint[]>(cacheKey)
    if (cached) return cached

    return this.withMedusaError("Не удалось загрузить пункты выдачи Ozon.", async () => {
      const { credentials, configuration } = await this.providerSettings()
      const points = (await this.client().listPickupPoints(credentials))
        .map(normalizePickupPoint)
        .filter((point) => normalizeCity(point.city) === normalizeCity(city))
      await this.cache_.set(cacheKey, points, this.pickupPointCacheTtl(configuration))
      return points
    })
  }

  private async providerSettings(): Promise<{
    credentials: ShippingProviderCredentials
    configuration: OzonConfiguration
  }> {
    if (this.options_.credentials) {
      return {
        credentials: this.options_.credentials,
        configuration: this.options_.configuration ?? {},
      }
    }

    const stored = await this.registry_?.getProviderConfig(OZON_PROVIDER_KEY)
    if (!stored?.encrypted_credentials) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Конфигурация Ozon для доставки неполна."
      )
    }
    return {
      credentials: decryptShippingProviderCredentials(stored.encrypted_credentials),
      configuration: stored.configuration as OzonConfiguration,
    }
  }

  private client() {
    return this.client_ ?? (this.client_ = new OzonClient())
  }

  private async resolveWeight(input: CalculationInput, fallback?: number | null) {
    const direct = finitePositive(input.weight_grams ?? input.package?.weight_grams)
    if (direct) return direct

    let total = 0
    for (const item of input.items ?? []) {
      const quantity = Number(item.quantity)
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Количество товара должно быть положительным целым числом."
        )
      }
      const unitWeight = finitePositive(item.variant?.weight) ?? finitePositive(fallback)
      if (!unitWeight) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Вес товара обязателен для доставки Ozon."
        )
      }
      total += unitWeight * quantity
    }
    const resolved = finitePositive(total) ?? finitePositive(fallback)
    if (!resolved) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Вес заказа обязателен для доставки Ozon."
      )
    }
    return resolved
  }

  private pickupPointCacheTtl(configuration: OzonConfiguration) {
    return positiveInteger(
      this.options_.pickupPointCacheTtlSeconds ??
      configuration.pickup_point_cache_ttl_seconds,
      DEFAULT_PICKUP_POINT_CACHE_TTL_SECONDS
    )
  }

  private pickupPointsCacheKey(city: string) {
    return `ozon:pickup-points:${normalizeCity(city)}`
  }

  private selectionCacheKey(context: ValidationContext) {
    const owner = stringValue(context.cart_id ?? context.id)
    return owner ? `ozon:selected-pickup-point:${owner}` : null
  }

  private async withMedusaError<T>(message: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (error) {
      if (error instanceof MedusaError) throw error
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `${message} ${describeError(error)}`
      )
    }
  }

  private async callCarrier<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (error) {
      if (error instanceof OzonApiError) throw new OzonFulfillmentError(error)
      throw error
    }
  }
}

function normalizeTariff(input: Tariff | Record<string, unknown>): TariffOption {
  const raw = input as Tariff & Record<string, unknown>
  const priceObject = isRecord(raw.price) ? raw.price : null
  return {
    code: String(raw.code ?? raw.tariff_id ?? ""),
    name: String(raw.name ?? raw.tariff_name ?? ""),
    price: Number(priceObject?.amount ?? raw.price),
    type: String(raw.delivery_type ?? raw.type ?? ""),
    currency: String(priceObject?.currency ?? raw.currency ?? "RUB"),
    delivery_days_min: nullableNumber(raw.delivery_days_min ?? raw.period_min),
    delivery_days_max: nullableNumber(raw.delivery_days_max ?? raw.period_max),
  }
}

function normalizePickupPoint(input: PickupPoint | Record<string, unknown>): NormalizedPickupPoint {
  const raw = input as PickupPoint & Record<string, unknown>
  const address = isRecord(raw.address) ? raw.address : null
  const location = isRecord(raw.location) ? raw.location : null
  return {
    id: String(raw.id ?? raw.map_point_id ?? raw.point_id ?? ""),
    name: String(raw.name ?? ""),
    address: String(address?.full_address ?? raw.address ?? ""),
    city: stringValue(address?.city ?? raw.city),
    latitude: nullableNumber(location?.lat ?? raw.latitude ?? raw.lat),
    longitude: nullableNumber(location?.lon ?? raw.longitude ?? raw.lng),
    working_hours: stringValue(raw.working_hours ?? raw.schedule),
    max_weight_grams: nullableNumber(raw.max_weight_grams ?? raw.max_weight),
  }
}

function validTariff(tariff: TariffOption) {
  return !!tariff.code && !!tariff.name && !!tariff.type &&
    Number.isFinite(tariff.price) && tariff.price >= 0
}

function normalizeShipment(
  shipment: Shipment | Record<string, unknown>,
  data: Record<string, unknown>
): OzonFulfillment {
  const raw = shipment as Shipment & Record<string, unknown>
  return {
    id: String(raw.id ?? raw.shipment_id ?? ""),
    tracking_number: stringValue(raw.tracking_number ?? raw.track_number),
    status: stringValue(raw.status ?? raw.state),
    data: {
      ...data,
      ozon_shipment_id: String(raw.id ?? raw.shipment_id ?? ""),
      tracking_number: stringValue(raw.tracking_number ?? raw.track_number),
    },
  }
}

function fulfillmentResult(
  data: Record<string, unknown>,
  shipment: Pick<OzonFulfillment, "id" | "tracking_number" | "status">
): CreateFulfillmentResult {
  return {
    data: {
      ...data,
      ozon_shipment_id: shipment.id,
      tracking_number: shipment.tracking_number,
      status: shipment.status,
    },
    labels: [],
  }
}

function cityFrom(input: ValidationContext | CalculationInput) {
  return stringValue(input.city ?? input.shipping_address?.city)
}

function cheapestTariff(tariffs: TariffOption[]) {
  return tariffs.reduce<TariffOption | undefined>(
    (current, tariff) => !current || tariff.price < current.price ? tariff : current,
    undefined
  )
}

function isAllowedWeight(weight: number, maximum?: number | null) {
  const max = finitePositive(maximum)
  return weight > 0 && (!max || weight <= max)
}

function finitePositive(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function nullableNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeCity(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("ru-RU") ?? ""
}

function nestedValue(value: unknown, key: string) {
  return isRecord(value) ? value[key] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
