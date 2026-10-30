import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  listShippingOptionsForCartWorkflow,
  listShippingOptionsForCartWithPricingWorkflow,
} from "@medusajs/medusa/core-flows"
import { SHIPPING_PROVIDER_REGISTRY_MODULE } from "../../../modules/shipping-provider-registry"
import ShippingProviderRegistryModuleService from "../../../modules/shipping-provider-registry/service"
import { CDEK_PROVIDER_KEY, OZON_PROVIDER_KEY } from "../../../modules/shipping-provider-registry"
import { CdekClient, type CdekCalculatedTariff } from "../../../modules/shipping-provider-registry/cdek-client"
import { decryptShippingProviderCredentials } from "../../../modules/shipping-provider-registry/credentials"
import { isShippingProviderConfigurationReady } from "../../../modules/shipping-provider-registry/readiness"
import OzonFulfillmentService, {
  type TariffOption,
} from "../../../providers/fulfillment-ozon/service"
import {
  STORE_PICKUP_NORMALIZED_OPTION_ID,
  isStorePickupAvailable,
  isStorePickupShippingOption,
  retrieveStorePickupSettings,
  type StorePickupSettings,
} from "../../../modules/store-pickup/utils"
import {
  loadOrRebuildPickupPointSnapshot,
  pickupPointSnapshotRequest,
  type PickupPointSnapshotResult,
} from "../../../lib/pickup-point-snapshot-cache"

export type NormalizedShippingOptionType = "courier" | "pickup" | "store_pickup"

export type NormalizedShippingOption = {
  id: string
  name: string
  type: NormalizedShippingOptionType
  price: number
  days_min: number | null
  days_max: number | null
  provider: string
  carrier: string
  pickup_address?: string
  pickup_hours?: string
}

type OzonTariff = {
  code: string
  name: string
  price: number
  delivery_days_min: number | null
  delivery_days_max: number | null
  delivery_type: string | null
}

async function isProviderVisible(container: MedusaContainer, providerKey: string) {
  const registryService: ShippingProviderRegistryModuleService = container.resolve(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const [visibility] = await registryService.listShippingProviderVisibilities({
    provider_key: providerKey,
  })
  if (visibility?.provider_key !== providerKey || !visibility.is_visible) return false
  return isShippingProviderConfigurationReady(
    providerKey,
    await registryService.getProviderConfig(providerKey)
  )
}

export type NormalizedShippingService = {
  provider_key: string
  name: string
}

export type PublicShippingTariff = {
  provider_key: string
  carrier: string
  tariff_code: number | string
  name: string
  type: "courier" | "pickup"
  price: number
  currency_code: string
  delivery_days_min: number | null
  delivery_days_max: number | null
}

export type PublicShippingTariffsResult = {
  city: string
  tariffs: PublicShippingTariff[]
  unavailable_providers: string[]
}

type PublicShippingTariffRequest = {
  city: string
  postal_code?: string
}

type StorePackage = {
  weight_grams: number
  length_mm: number
  width_mm: number
  height_mm: number
}

type CdekConfiguration = {
  sender?: { city?: string; postal_code?: string }
  contract_type?: "online_store" | "delivery"
  tariff_codes?: number[]
}

export async function listConnectedShippingServices(
  container: MedusaContainer
): Promise<NormalizedShippingService[]> {
  const registryService: ShippingProviderRegistryModuleService = container.resolve(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const visibilities = await registryService.listShippingProviderVisibilities({ is_visible: true } as any)
  const ready = await Promise.all(visibilities.map(async (visibility) => ({
    visibility,
    configured: isShippingProviderConfigurationReady(
      visibility.provider_key,
      await registryService.getProviderConfig(visibility.provider_key)
    ),
  })))
  return ready
    .filter(({ configured }) => configured)
    .map(({ visibility }) => ({ provider_key: visibility.provider_key, name: visibility.provider_key }))
}

async function calculatePublicCdekTariffs(
  registryService: ShippingProviderRegistryModuleService,
  recipient: PublicShippingTariffRequest,
  storePackage: StorePackage
): Promise<PublicShippingTariff[]> {
  const config = await registryService.getProviderConfig(CDEK_PROVIDER_KEY)
  if (!config?.encrypted_credentials) return []

  const configuration = config.configuration as CdekConfiguration
  if (!configuration.sender?.city || !configuration.contract_type || !configuration.tariff_codes?.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "СДЭК включён, но его конфигурация тарификации неполна."
    )
  }

  const tariffs = await new CdekClient().calculateTariffs(
    decryptShippingProviderCredentials(config.encrypted_credentials),
    {
      contract_type: configuration.contract_type,
      sender: {
        city: configuration.sender.city,
        postal_code: configuration.sender.postal_code ?? "",
      },
      recipient,
      package: storePackage,
      tariff_codes: configuration.tariff_codes,
    }
  )

  return tariffs.flatMap((tariff: CdekCalculatedTariff): PublicShippingTariff[] => {
    if (tariff.delivery_mode !== 1 && tariff.delivery_mode !== 2) return []
    return [{
      provider_key: CDEK_PROVIDER_KEY,
      carrier: CDEK_PROVIDER_KEY,
      tariff_code: tariff.code,
      name: tariff.name,
      type: tariff.delivery_mode === 2 ? "pickup" : "courier",
      price: tariff.delivery_sum,
      currency_code: "RUB",
      delivery_days_min: tariff.period_min,
      delivery_days_max: tariff.period_max,
    }]
  })
}

async function calculatePublicOzonTariffs(
  container: MedusaContainer,
  registryService: ShippingProviderRegistryModuleService,
  recipient: PublicShippingTariffRequest,
  storePackage: StorePackage
): Promise<PublicShippingTariff[]> {
  const service = new OzonFulfillmentService({
    [SHIPPING_PROVIDER_REGISTRY_MODULE]: registryService,
    [Modules.CACHE]: container.resolve(Modules.CACHE),
  })
  const tariffs = await service.calculateAvailableTariffs({
    city: recipient.city,
    postal_code: recipient.postal_code,
    package: storePackage,
  })

  return tariffs.map((tariff: TariffOption) => ({
    provider_key: OZON_PROVIDER_KEY,
    carrier: OZON_PROVIDER_KEY,
    tariff_code: tariff.code,
    name: tariff.name,
    type: tariff.type === "pickup" ? "pickup" : "courier",
    price: tariff.price,
    currency_code: tariff.currency,
    delivery_days_min: tariff.delivery_days_min,
    delivery_days_max: tariff.delivery_days_max,
  }))
}

function describeRejection(reason: unknown): string {
  if (reason instanceof Error) return reason.stack ?? reason.message
  if (reason && typeof reason === "object") {
    try {
      return JSON.stringify(reason)
    } catch {
      // falls through to String() below
    }
  }
  return String(reason)
}

export async function listPublicShippingTariffs(
  container: MedusaContainer,
  recipient: PublicShippingTariffRequest
): Promise<PublicShippingTariffsResult> {
  const registryService: ShippingProviderRegistryModuleService = container.resolve(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const storePackage = await registryService.getStorePackage()
  if (!storePackage) {
    return { city: recipient.city, tariffs: [], unavailable_providers: [] }
  }

  const providerKeys = [CDEK_PROVIDER_KEY, OZON_PROVIDER_KEY]
  const visibilityChecks = await Promise.allSettled(
    providerKeys.map((providerKey) => isProviderVisible(container, providerKey))
  )
  const tariffs: PublicShippingTariff[] = []
  const unavailableProviders: string[] = []
  const availableProviderKeys = visibilityChecks.flatMap((check, index) => {
    if (check.status === "rejected") {
      unavailableProviders.push(providerKeys[index])
      return []
    }
    return check.value ? [providerKeys[index]] : []
  })

  const calculations = await Promise.allSettled(
    availableProviderKeys.map((providerKey) => (
      providerKey === CDEK_PROVIDER_KEY
        ? calculatePublicCdekTariffs(registryService, recipient, storePackage)
        : calculatePublicOzonTariffs(container, registryService, recipient, storePackage)
    ))
  )

  calculations.forEach((calculation, index) => {
    if (calculation.status === "rejected") {
      const providerKey = availableProviderKeys[index]
      unavailableProviders.push(providerKey)
      container.resolve(ContainerRegistrationKeys.LOGGER).error(
        `listPublicShippingTariffs: ${providerKey} calculation failed for city "${recipient.city}": ${describeRejection(calculation.reason)}`
      )
      return
    }
    tariffs.push(...calculation.value)
  })

  return {
    city: recipient.city,
    tariffs,
    unavailable_providers: unavailableProviders,
  }
}

// The normalized id is the only thing the buyer sends back on selection, so two
// entries sharing it are indistinguishable downstream — a carrier can return the
// same tariff several times with different prices, and rendering every copy makes
// several rows look selected at once. Cheapest wins, list stays sorted by price.
export function dedupeCheapestById(
  options: NormalizedShippingOption[]
): NormalizedShippingOption[] {
  const byId = new Map<string, NormalizedShippingOption>()
  for (const option of [...options].sort((left, right) => left.price - right.price)) {
    if (!byId.has(option.id)) byId.set(option.id, option)
  }
  return [...byId.values()]
}

export async function listNormalizedShippingOptions(
  container: MedusaContainer,
  cartId: string
): Promise<NormalizedShippingOption[]> {
  const result = await listNormalizedShippingOptionsWithErrors(container, cartId)
  return result.shipping_options
}

export type NormalizedShippingOptionsResult = {
  shipping_options: NormalizedShippingOption[]
  unavailable_providers: string[]
}

export function normalizeStorePickupOption(
  settings: StorePickupSettings | null,
  availableOptions: Array<{
    provider_id?: string | null
    data?: Record<string, unknown> | null
  }>
): NormalizedShippingOption | null {
  if (
    !settings ||
    !isStorePickupAvailable(settings) ||
    !availableOptions.some(isStorePickupShippingOption)
  ) {
    return null
  }

  return {
    id: STORE_PICKUP_NORMALIZED_OPTION_ID,
    name: "Самовывоз",
    type: "store_pickup",
    price: 0,
    days_min: null,
    days_max: null,
    provider: "store_pickup",
    carrier: "store",
    pickup_address: settings.address.trim(),
    pickup_hours: settings.hours.trim(),
  }
}

async function availableStorePickupSettings(container: MedusaContainer) {
  try {
    return await retrieveStorePickupSettings(container)
  } catch {
    // A missing row means the feature has never been configured. Keeping the
    // public delivery list available also makes rollout safe before the admin
    // saves the initial disabled settings record.
    return null
  }
}

export async function listNormalizedShippingOptionsWithErrors(
  container: MedusaContainer,
  cartId: string
): Promise<NormalizedShippingOptionsResult> {
  const [cdekVisible, ozonVisible, storePickupSettings] = await Promise.all([
    isProviderVisible(container, CDEK_PROVIDER_KEY),
    isProviderVisible(container, OZON_PROVIDER_KEY),
    availableStorePickupSettings(container),
  ])
  const storePickupEnabled = isStorePickupAvailable(storePickupSettings)
  if (!cdekVisible && !ozonVisible && !storePickupEnabled) {
    return { shipping_options: [], unavailable_providers: [] }
  }

  const { result: availableOptions } = await listShippingOptionsForCartWorkflow(container).run({
    input: { cart_id: cartId },
  })
  const storePickup = normalizeStorePickupOption(
    storePickupSettings,
    availableOptions as Array<Record<string, any>>
  )
  const visibleProviderIds = [
    ...(cdekVisible ? [CDEK_PROVIDER_KEY] : []),
    ...(ozonVisible ? [OZON_PROVIDER_KEY] : []),
  ]
  const optionsByProvider = visibleProviderIds.map((providerId) => ({
    providerId,
    options: (availableOptions as Array<Record<string, any>>).filter(
      (option) => option.provider_id === providerId
    ),
  }))
  const calculations = await Promise.allSettled(
    optionsByProvider.map(async ({ providerId, options }) => {
      if (!options.length) return [] as NormalizedShippingOption[]
      const { result } = await listShippingOptionsForCartWithPricingWorkflow(container).run({
        input: {
          cart_id: cartId,
          options: options.map((option) => ({ id: option.id })),
        },
      })
      const shippingOptions = (result as Array<Record<string, any>>).filter(
        (option) => option.provider_id === providerId
      )
      if (providerId === OZON_PROVIDER_KEY) {
        return shippingOptions.flatMap((option) => {
          const tariffs = option.calculated_price?.data?.tariffs
          if (!Array.isArray(tariffs)) {
            throw new MedusaError(MedusaError.Types.INVALID_DATA, "Ozon вернул некорректный ответ расчёта.")
          }
          return (tariffs as OzonTariff[]).map((tariff): NormalizedShippingOption => ({
            id: `${option.id}:${tariff.delivery_type ?? "courier"}:ozon:${tariff.code}`,
            name: tariff.name,
            type: tariff.delivery_type === "pickup" ? "pickup" : "courier",
            price: tariff.price,
            days_min: tariff.delivery_days_min,
            days_max: tariff.delivery_days_max,
            provider: "ozon",
            carrier: OZON_PROVIDER_KEY,
          }))
        })
      }
      return shippingOptions.flatMap((option): NormalizedShippingOption[] => {
        const type = option.data?.delivery_type
        if (type !== "courier" && type !== "pickup") return []
        const tariffs = option.calculated_price?.data?.tariff_codes
        if (!Array.isArray(tariffs)) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "СДЭК вернул некорректный ответ расчёта."
          )
        }
        return tariffs.map((tariff) => ({
          id: `${option.id}:${type}:cdek:${tariff.code}`,
          name: tariff.name,
          type,
          price: tariff.delivery_sum,
          days_min: tariff.period_min,
          days_max: tariff.period_max,
          provider: "cdek",
          carrier: CDEK_PROVIDER_KEY,
        }))
      })
    })
  )
  const options: NormalizedShippingOption[] = storePickup ? [storePickup] : []
  const unavailableProviders: string[] = []

  calculations.forEach((calculation, index) => {
    const providerId = optionsByProvider[index].providerId
    if (calculation.status === "rejected") {
      unavailableProviders.push(providerId)
      container.resolve(ContainerRegistrationKeys.LOGGER).error(
        `listNormalizedShippingOptionsWithErrors: ${providerId} calculation failed for cart ${cartId}: ${describeRejection(calculation.reason)}`
      )
      return
    }
    options.push(...calculation.value)
  })

  return {
    shipping_options: dedupeCheapestById(options),
    unavailable_providers: unavailableProviders,
  }
}

export type NormalizedPickupPoint = {
  id: string
  /** Stable provider-neutral identity. `id` remains for existing consumers. */
  provider_key: string
  external_id: string
  name: string
  address: string
  lat: number | null
  lng: number | null
  schedule: string | null
  provider: string
  carrier: string
}

export type PickupPointSourceStatus = "available" | "partial" | "unavailable"

export type PickupPointSource = {
  provider_key: string
  status: PickupPointSourceStatus
}

export type NormalizedPickupPointsResult = {
  /** Complete directory; coordinate validity must not affect this collection. */
  points: NormalizedPickupPoint[]
  /** A subset of `points` suitable for rendering on a map. */
  map_points: NormalizedPickupPoint[]
  /** Per-source operational status. It deliberately contains no exception text. */
  sources: PickupPointSource[]
}

const PICKUP_POINT_PAGE_SIZE = 1_000

type StoredPickupPoint = {
  provider_key: string
  external_id: string
  name: string
  address: string
  lat: number | null
  lng: number | null
  schedule: string | null
}

function matchesProvider(carrier: string | undefined, providerKey: string) {
  // `cdek` was emitted by the first version of the endpoint. Keep it accepted
  // while all new identities use the registry provider key.
  return !carrier || carrier === providerKey || (providerKey === CDEK_PROVIDER_KEY && carrier === "cdek")
}

function normalizePickupPoint(point: StoredPickupPoint): NormalizedPickupPoint {
  return {
    id: `${point.provider_key}:${point.external_id}`,
    provider_key: point.provider_key,
    external_id: point.external_id,
    name: point.name,
    address: point.address,
    lat: point.lat,
    lng: point.lng,
    schedule: point.schedule,
    provider: point.provider_key === CDEK_PROVIDER_KEY ? "cdek" : "ozon",
    // Keep the formerly exposed carrier values stable for existing clients.
    carrier: point.provider_key === CDEK_PROVIDER_KEY ? "cdek" : OZON_PROVIDER_KEY,
  }
}

function hasMapCoordinates(point: NormalizedPickupPoint) {
  return typeof point.lat === "number" && typeof point.lng === "number"
    && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && point.lat >= -90 && point.lat <= 90
    && point.lng >= -180 && point.lng <= 180
}

async function listAllProviderPickupPoints(
  service: ShippingProviderRegistryModuleService,
  providerKey: string,
  city: string,
  address?: string
): Promise<StoredPickupPoint[]> {
  const points: StoredPickupPoint[] = []
  const filters = {
    provider_key: providerKey,
    city: { $ilike: city },
    ...(address ? { address: { $ilike: `%${address}%` } } : {}),
  } as any

  for (let skip = 0; ; skip += PICKUP_POINT_PAGE_SIZE) {
    const page = await service.listShippingPickupPoints(filters, {
      take: PICKUP_POINT_PAGE_SIZE,
      skip,
    } as any) as StoredPickupPoint[]
    points.push(...page)
    if (page.length < PICKUP_POINT_PAGE_SIZE) return points
  }
}

async function readPickupPointSource(
  container: MedusaContainer,
  providerKey: string,
  city: string,
  address?: string
): Promise<{ source: PickupPointSource; points: NormalizedPickupPoint[] }> {
  try {
    const service = container.resolve<ShippingProviderRegistryModuleService>(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    const [visibility] = await service.listShippingProviderVisibilities({ provider_key: providerKey })
    const configured = isShippingProviderConfigurationReady(
      providerKey,
      await service.getProviderConfig(providerKey)
    )
    if (!visibility?.is_visible || !configured) {
      return { source: { provider_key: providerKey, status: "unavailable" }, points: [] }
    }
    const stored = await listAllProviderPickupPoints(service, providerKey, city, address)
    return {
      source: { provider_key: providerKey, status: "available" },
      points: stored.map((point) => normalizePickupPoint({ ...point, provider_key: providerKey })),
    }
  } catch {
    // The catalogue must remain useful if one provider's directory is down.
    // Do not put error messages here: they can include credentials or upstream details.
    return { source: { provider_key: providerKey, status: "partial" }, points: [] }
  }
}

export async function listNormalizedPickupPointCatalog(
  container: MedusaContainer,
  city: string,
  carrier?: string,
  address?: string
): Promise<NormalizedPickupPointsResult> {
  const requestedProviderKeys = [CDEK_PROVIDER_KEY, OZON_PROVIDER_KEY].filter((providerKey) =>
    matchesProvider(carrier, providerKey)
  )
  const enabled = await Promise.all(requestedProviderKeys.map(async (providerKey) => ({
    providerKey,
    enabled: await isProviderVisible(container, providerKey),
  })))
  const providerKeys = enabled.filter(({ enabled }) => enabled).map(({ providerKey }) => providerKey)
  const loadFromDatabase = async (): Promise<PickupPointSnapshotResult> => {
    const results = await Promise.all(
      providerKeys.map((providerKey) => readPickupPointSource(container, providerKey, city, address))
    )
    const unique = new Map<string, NormalizedPickupPoint>()
    for (const result of results) {
      for (const point of result.points) {
        unique.set(`${point.provider_key}:${point.external_id}`, point)
      }
    }
    const points = [...unique.values()]
    return {
      points,
      map_points: points.filter(hasMapCoordinates),
      sources: results.map((result) => result.source),
    }
  }
  const result = await loadOrRebuildPickupPointSnapshot(
    container,
    pickupPointSnapshotRequest(city, carrier, address, providerKeys),
    loadFromDatabase,
    loadFromDatabase
  )
  const unavailableSources = enabled
    .filter(({ enabled: isEnabled }) => !isEnabled)
    .map(({ providerKey }) => ({ provider_key: providerKey, status: "unavailable" as const }))
  return unavailableSources.length
    ? { ...result, sources: [...result.sources, ...unavailableSources] }
    : result
}

export async function listNormalizedPickupPoints(
  container: MedusaContainer,
  city: string,
  carrier?: string,
  address?: string
): Promise<NormalizedPickupPoint[]> {
  return (await listNormalizedPickupPointCatalog(container, city, carrier, address)).points
}

const NORMALIZED_OPTION_ID_PATTERN =
  /^(.+):(courier|pickup):([^:]+):([^:]+)$/

type ParsedNormalizedOptionId = {
  shippingOptionId: string
  type: NormalizedShippingOptionType
  carrier: string
  tariffId: string
}

function parseNormalizedOptionId(optionId: string): ParsedNormalizedOptionId {
  const match = NORMALIZED_OPTION_ID_PATTERN.exec(optionId)

  if (!match) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Shipping option id is not recognized"
    )
  }

  const [, shippingOptionId, type, carrier, tariffId] = match

  return {
    shippingOptionId,
    type: type as NormalizedShippingOptionType,
    carrier,
    tariffId,
  }
}

export function shippingOptionIdFromNormalizedId(optionId: string): string {
  return parseNormalizedOptionId(optionId).shippingOptionId
}

function parseNormalizedPointId(pointId: string): { carrier: string; rawPointId: string } {
  const separatorIndex = pointId.indexOf(":")

  if (separatorIndex <= 0 || separatorIndex === pointId.length - 1) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Pickup point id is not recognized"
    )
  }

  return {
    carrier: pointId.slice(0, separatorIndex),
    rawPointId: pointId.slice(separatorIndex + 1),
  }
}

// Провайдер-нейтральная копия выбранного пункта выдачи. У провайдеров разные
// формы `data`, и обе несут только идентификатор точки — а заказу нужен её адрес.
// Отдельный ключ рядом с ними избавляет потребителей (оформление, админка) от
// знания обеих форм.
export type SelectedPickupPoint = {
  id: string
  provider_key: string
  external_id: string
  name: string
  address: string
}

export type ShippingMethodSelection = OzonShippingMethodSelection | {
  shippingOptionId: string
  data: {
    cdekData: {
      tariff_code: number
      point_code?: string
    }
    pickup_point?: SelectedPickupPoint
  }
}

export type OzonShippingMethodSelection = {
  shippingOptionId: string
  data: {
    ozonData: {
      tariff_code: string
      delivery_type: "courier" | "pickup"
      pickup_point_id?: string
    }
    pickup_point?: SelectedPickupPoint
  }
}

export function resolveShippingSelection(
  shippingOptions: Array<{
    id: string
    provider_id?: string | null
    calculated_price?: { data?: any } | null
  }>,
  optionId: string,
  pointId?: string,
  pickupPoint?: SelectedPickupPoint | null
): ShippingMethodSelection {
  const parsed = parseNormalizedOptionId(optionId)
  const option = shippingOptions.find((candidate) => candidate.id === parsed.shippingOptionId)
  if (option?.provider_id === OZON_PROVIDER_KEY) {
    const tariffs = option.calculated_price?.data?.tariffs
    const tariff = Array.isArray(tariffs)
      ? (tariffs as OzonTariff[]).find((candidate) => String(candidate.code) === parsed.tariffId)
      : null
    if (!tariff) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Selected delivery tariff is no longer available, please pick again")
    }
    const parsedPoint = validateSelectionPickupPoint(
      parsed.type,
      OZON_PROVIDER_KEY,
      pointId,
      pickupPoint
    )
    return {
      shippingOptionId: parsed.shippingOptionId,
      data: {
        ozonData: {
          tariff_code: parsed.tariffId,
          delivery_type: parsed.type === "pickup" ? "pickup" : "courier",
          ...(parsedPoint ? { pickup_point_id: parsedPoint.rawPointId } : {}),
        },
        ...(pickupPoint ? { pickup_point: pickupPoint } : {}),
      },
    }
  }
  if (option?.provider_id !== CDEK_PROVIDER_KEY) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Shipping provider is no longer available")
  }

  const tariffs = option.calculated_price?.data?.tariff_codes
  const tariff = Array.isArray(tariffs)
    ? tariffs.find((candidate) => String(candidate.code) === parsed.tariffId)
    : null
  if (!tariff) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Selected delivery tariff is no longer available, please pick again"
    )
  }
  const parsedPoint = validateSelectionPickupPoint(
    parsed.type,
    CDEK_PROVIDER_KEY,
    pointId,
    pickupPoint
  )

  return {
    shippingOptionId: parsed.shippingOptionId,
    data: {
      cdekData: {
        tariff_code: Number(parsed.tariffId),
        ...(parsedPoint ? { point_code: parsedPoint.rawPointId } : {}),
      },
      ...(pickupPoint ? { pickup_point: pickupPoint } : {}),
    },
  }
}

function validateSelectionPickupPoint(
  type: NormalizedShippingOptionType,
  providerKey: string,
  pointId?: string,
  pickupPoint?: SelectedPickupPoint | null
) {
  if (type === "courier") {
    if (pointId || pickupPoint) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Pickup point data is not allowed for a courier delivery option"
      )
    }

    return null
  }

  if (!pointId || !pickupPoint) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "point_id is required for a pickup delivery option"
    )
  }

  const parsedPoint = parseNormalizedPointId(pointId)
  if (
    parsedPoint.carrier !== providerKey ||
    pickupPoint.id !== pointId ||
    pickupPoint.provider_key !== providerKey ||
    pickupPoint.external_id !== parsedPoint.rawPointId
  ) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Pickup point provider does not match")
  }

  return parsedPoint
}
