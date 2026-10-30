import { defineRouteConfig } from "@medusajs/admin-sdk"
import { TriangleRightMini, TruckFast } from "@medusajs/icons"
import {
  Badge,
  Button,
  Checkbox,
  Container,
  FocusModal,
  Heading,
  Input,
  Label,
  Select,
  Skeleton,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FormEvent, useEffect, useState } from "react"
import { Link } from "react-router-dom"

import { sdk } from "../../lib/sdk"
import { CDEK_PROVIDER_KEY, OZON_PROVIDER_KEY } from "../../../modules/shipping-provider-registry/provider-keys"

type ShippingProvider = {
  provider_key: string
  label: string
  is_visible: boolean
  implemented: boolean
  configured: boolean
  settings_path: string | null
}

type StorePackage = {
  weight_grams: number
  length_mm: number
  width_mm: number
  height_mm: number
}

type StorePickupSettings = {
  id: string
  address: string
  hours: string
  is_enabled: boolean
}

type CdekConfiguration = {
  sender: {
    city: string
    street: string
    postal_code: string
    contact_name: string
    phone: string
  }
  contract_type: "online_store" | "delivery"
  tariff_codes: number[]
}

type CdekConfigResponse = {
  configured: boolean
  credentials: { client_id: string; client_secret: string } | null
  configuration: CdekConfiguration | null
}

type CdekTariff = { code: number; name: string }

type CdekForm = {
  clientId: string
  clientSecret: string
  city: string
  street: string
  postalCode: string
  contactName: string
  phone: string
  contractType: CdekConfiguration["contract_type"]
  tariffCodes: number[]
}

type OzonConfiguration = {
  sender?: { city?: string; postal_code?: string }
  max_weight_grams?: number
  pickup_point_cache_ttl_seconds?: number
}

type OzonConfigResponse = {
  configured: boolean
  credentials: { client_id: string; client_secret: string } | null
  configuration: OzonConfiguration | null
}

type OzonForm = {
  clientId: string
  clientSecret: string
  city: string
  postalCode: string
  maxWeightGrams: string
  pickupPointCacheTtlSeconds: string
}

const SHIPPING_PROVIDERS_QUERY_KEY = ["shipping-providers"] as const
const STORE_PACKAGE_QUERY_KEY = ["shipping-store-package"] as const
const CDEK_CONFIG_QUERY_KEY = ["shipping-provider-cdek"] as const
const OZON_CONFIG_QUERY_KEY = ["shipping-provider-ozon"] as const
const STORE_PICKUP_QUERY_KEY = ["store-pickup-settings"] as const
const EMPTY_CDEK_FORM: CdekForm = {
  clientId: "",
  clientSecret: "",
  city: "",
  street: "",
  postalCode: "",
  contactName: "",
  phone: "",
  contractType: "online_store",
  tariffCodes: [],
}
const EMPTY_OZON_FORM: OzonForm = {
  clientId: "",
  clientSecret: "",
  city: "",
  postalCode: "",
  maxWeightGrams: "",
  pickupPointCacheTtlSeconds: "",
}

function messageFromError(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function isMaskedSecret(value: string) {
  return value.includes("*")
}

function useShippingProviders() {
  return useQuery({
    queryKey: SHIPPING_PROVIDERS_QUERY_KEY,
    queryFn: () =>
      sdk.client.fetch<{ shipping_providers: ShippingProvider[] }>(
        "/admin/shipping-providers"
      ),
  })
}

function ProviderRowsSkeleton() {
  return (
    <div className="divide-y">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3 px-6 py-4">
          {row < 2 ? <Skeleton className="h-[18px] w-8 rounded-full" /> : null}
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  )
}

function ShippingProviderRow({
  provider,
  onConfigureCdek,
  onConfigureOzon,
}: {
  provider: ShippingProvider
  onConfigureCdek: () => void
  onConfigureOzon: () => void
}) {
  const queryClient = useQueryClient()
  const toggleVisibility = useMutation({
    mutationFn: (is_visible: boolean) =>
      sdk.client.fetch("/admin/shipping-providers", {
        method: "POST",
        body: { provider_key: provider.provider_key, is_visible },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SHIPPING_PROVIDERS_QUERY_KEY })
    },
    onError: (error) => {
      toast.error(messageFromError(error, "Не удалось изменить статус провайдера"))
    },
  })
  const isCdek = provider.provider_key === CDEK_PROVIDER_KEY
  const isOzon = provider.provider_key === OZON_PROVIDER_KEY
  const needsConfiguration = isCdek || isOzon
  const description = !provider.implemented
    ? "Интеграция ещё не реализована"
    : provider.configured
      ? provider.is_visible
        ? "Настроен и доступен покупателям"
        : "Настроен, но выключен"
      : isCdek
        ? "Требуется настройка доступа и тарифов"
        : "Требуется настройка доступа"

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {provider.implemented ? (
          <Switch
            checked={provider.is_visible}
            disabled={toggleVisibility.isPending || (needsConfiguration && !provider.configured)}
            onCheckedChange={(checked) => toggleVisibility.mutate(checked)}
            aria-label={`${provider.is_visible ? "Выключить" : "Включить"} ${provider.label}`}
          />
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <Text size="small" leading="compact" weight="plus">
            {provider.label}
          </Text>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            {description}
          </Text>
        </div>
      </div>
      {!provider.implemented ? (
        <Badge color="grey">Скоро</Badge>
      ) : isCdek ? (
        <Button size="small" variant="transparent" onClick={onConfigureCdek}>
          Настроить <TriangleRightMini />
        </Button>
      ) : isOzon ? (
        <Button size="small" variant="transparent" onClick={onConfigureOzon}>
          Настроить <TriangleRightMini />
        </Button>
      ) : provider.settings_path ? (
        <Button size="small" variant="transparent" asChild>
          <Link to={provider.settings_path}>
            Настроить <TriangleRightMini />
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

function StorePickupCard() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ address: "", hours: "", is_enabled: false })
  const pickupQuery = useQuery({
    queryKey: STORE_PICKUP_QUERY_KEY,
    queryFn: () =>
      sdk.client.fetch<{ store_pickup: StorePickupSettings }>(
        "/admin/store-pickup"
      ),
  })

  useEffect(() => {
    const value = pickupQuery.data?.store_pickup
    if (!value) return
    setForm({
      address: value.address,
      hours: value.hours,
      is_enabled: value.is_enabled,
    })
  }, [pickupQuery.data])

  const savePickup = useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ store_pickup: StorePickupSettings }>(
        "/admin/store-pickup",
        {
          method: "POST",
          body: form,
        }
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: STORE_PICKUP_QUERY_KEY })
      toast.success("Настройки самовывоза сохранены")
    },
    onError: (error) =>
      toast.error(messageFromError(error, "Не удалось сохранить самовывоз")),
  })

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <div>
          <Heading level="h2">Самовывоз из магазина</Heading>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Бесплатный способ получения без участия службы доставки.
          </Text>
        </div>
        <Switch
          checked={form.is_enabled}
          disabled={pickupQuery.isLoading || savePickup.isPending}
          onCheckedChange={(checked) =>
            setForm((current) => ({ ...current, is_enabled: checked }))
          }
          aria-label={form.is_enabled ? "Выключить самовывоз" : "Включить самовывоз"}
        />
      </div>
      {pickupQuery.isLoading ? (
        <div className="flex flex-col gap-3 px-6 py-4">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : pickupQuery.isError ? (
        <Text size="small" className="px-6 py-4 text-ui-fg-error">
          Не удалось загрузить настройки самовывоза.
        </Text>
      ) : (
        <form
          className="flex flex-col gap-4 px-6 py-4"
          onSubmit={(event) => {
            event.preventDefault()
            savePickup.mutate()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="store-pickup-address">Адрес точки выдачи</Label>
            <Input
              id="store-pickup-address"
              value={form.address}
              disabled={savePickup.isPending}
              onChange={(event) =>
                setForm((current) => ({ ...current, address: event.target.value }))
              }
            />
            {!form.address.trim() ? (
              <Text size="small" className="text-ui-fg-subtle">
                Пока адрес пуст, самовывоз не показывается покупателям.
              </Text>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="store-pickup-hours">Часы работы</Label>
            <Input
              id="store-pickup-hours"
              value={form.hours}
              disabled={savePickup.isPending}
              onChange={(event) =>
                setForm((current) => ({ ...current, hours: event.target.value }))
              }
            />
          </div>
          <div className="flex justify-end">
            <Button
              size="small"
              type="submit"
              isLoading={savePickup.isPending}
              disabled={savePickup.isPending}
            >
              Сохранить самовывоз
            </Button>
          </div>
        </form>
      )}
    </Container>
  )
}

function StorePackageCard() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ length: "", width: "", height: "", weight: "" })
  const packageQuery = useQuery({
    queryKey: STORE_PACKAGE_QUERY_KEY,
    queryFn: () =>
      sdk.client.fetch<{ store_package: StorePackage | null }>(
        "/admin/shipping-providers/package"
      ),
  })

  useEffect(() => {
    const value = packageQuery.data?.store_package
    if (!value) return
    setForm({
      length: String(value.length_mm / 10),
      width: String(value.width_mm / 10),
      height: String(value.height_mm / 10),
      weight: String(value.weight_grams),
    })
  }, [packageQuery.data])

  const savePackage = useMutation({
    mutationFn: (value: StorePackage) =>
      sdk.client.fetch("/admin/shipping-providers/package", {
        method: "POST",
        body: value,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: STORE_PACKAGE_QUERY_KEY })
      toast.success("Коробка магазина сохранена")
    },
    onError: (error) =>
      toast.error(messageFromError(error, "Не удалось сохранить коробку магазина")),
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = {
      length_mm: Math.round(Number(form.length) * 10),
      width_mm: Math.round(Number(form.width) * 10),
      height_mm: Math.round(Number(form.height) * 10),
      weight_grams: Math.round(Number(form.weight)),
    }
    if (Object.values(parsed).some((value) => !Number.isFinite(value) || value <= 0)) {
      toast.error("Укажите положительные габариты и вес коробки")
      return
    }
    savePackage.mutate(parsed)
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Коробка магазина</Heading>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Габариты и вес по умолчанию для расчёта доставки. Одна настройка для всех провайдеров.
        </Text>
      </div>
      {packageQuery.isLoading ? (
        <div className="grid grid-cols-4 gap-3 px-6 py-4">
          {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-8" />)}
        </div>
      ) : packageQuery.isError ? (
        <Text size="small" className="px-6 py-4 text-ui-fg-error">
          Не удалось загрузить коробку магазина.
        </Text>
      ) : (
        <form className="px-6 py-4" onSubmit={submit}>
          <div className="grid grid-cols-4 gap-3">
            {([
              ["length", "Длина", "см"],
              ["width", "Ширина", "см"],
              ["height", "Высота", "см"],
              ["weight", "Вес", "г"],
            ] as const).map(([key, label, unit]) => (
              <div key={key} className="flex flex-col gap-2">
                <Label htmlFor={`store-package-${key}`}>{label} · {unit}</Label>
                <Input
                  id={`store-package-${key}`}
                  type="number"
                  min="0.1"
                  step={unit === "г" ? "1" : "0.1"}
                  value={form[key]}
                  disabled={savePackage.isPending}
                  onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button size="small" type="submit" isLoading={savePackage.isPending} disabled={savePackage.isPending}>
              Сохранить коробку
            </Button>
          </div>
        </form>
      )}
    </Container>
  )
}

function CdekConfigurationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CdekForm>(EMPTY_CDEK_FORM)
  const [tariffs, setTariffs] = useState<CdekTariff[] | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const configQuery = useQuery({
    queryKey: CDEK_CONFIG_QUERY_KEY,
    queryFn: () => sdk.client.fetch<CdekConfigResponse>("/admin/shipping-providers/cdek"),
    enabled: open,
  })

  useEffect(() => {
    if (!open || !configQuery.data) return
    const saved = configQuery.data
    setForm({
      clientId: saved.credentials?.client_id ?? "",
      clientSecret: saved.credentials?.client_secret ?? "",
      city: saved.configuration?.sender.city ?? "",
      street: saved.configuration?.sender.street ?? "",
      postalCode: saved.configuration?.sender.postal_code ?? "",
      contactName: saved.configuration?.sender.contact_name ?? "",
      phone: saved.configuration?.sender.phone ?? "",
      contractType: saved.configuration?.contract_type ?? "online_store",
      tariffCodes: saved.configuration?.tariff_codes ?? [],
    })
    setTariffs(null)
    setFormError(null)
  }, [open, configQuery.data])

  function credentialsPayload() {
    return {
      ...(form.clientId && !isMaskedSecret(form.clientId) ? { client_id: form.clientId.trim() } : {}),
      ...(form.clientSecret && !isMaskedSecret(form.clientSecret) ? { client_secret: form.clientSecret } : {}),
    }
  }

  function setField<K extends keyof CdekForm>(field: K, value: CdekForm[K]) {
    setForm((current) => ({ ...current, [field]: value }))
    if (["clientId", "clientSecret", "city", "postalCode", "contractType"].includes(field)) {
      setTariffs(null)
    }
    setFormError(null)
  }

  function validateBaseFields() {
    if (!form.clientId || !form.clientSecret || !form.city.trim() || !form.postalCode.trim()) {
      setFormError("Заполните реквизиты доступа, город и индекс склада.")
      return false
    }
    return true
  }

  const loadTariffs = useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ tariffs: CdekTariff[] }>("/admin/shipping-providers/cdek/tariffs", {
        method: "POST",
        body: {
          ...credentialsPayload(),
          contract_type: form.contractType,
          sender: { city: form.city.trim(), postal_code: form.postalCode.trim() },
        },
      }),
    onSuccess: ({ tariffs: availableTariffs }) => {
      setTariffs(availableTariffs)
      setForm((current) => ({
        ...current,
        tariffCodes: current.tariffCodes.filter((code) => availableTariffs.some((tariff) => tariff.code === code)),
      }))
      setFormError(null)
    },
    onError: (error) => {
      setTariffs([])
      setFormError(messageFromError(error, "Авторизация прошла, но список тарифов не получен. Повторите попытку."))
    },
  })

  const saveConfig = useMutation({
    mutationFn: () =>
      sdk.client.fetch<CdekConfigResponse>("/admin/shipping-providers/cdek", {
        method: "POST",
        body: {
          ...credentialsPayload(),
          configuration: {
            sender: {
              city: form.city.trim(),
              street: form.street.trim(),
              postal_code: form.postalCode.trim(),
              contact_name: form.contactName.trim(),
              phone: form.phone.trim(),
            },
            contract_type: form.contractType,
            tariff_codes: form.tariffCodes,
          },
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SHIPPING_PROVIDERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: CDEK_CONFIG_QUERY_KEY }),
      ])
      toast.success("СДЭК настроен и включён")
      onClose()
    },
    onError: (error) => {
      setFormError(messageFromError(error, "СДЭК отклонил реквизиты. Провайдер не был активирован."))
    },
  })

  function handlePrimaryAction() {
    setFormError(null)
    if (!validateBaseFields()) return
    if (tariffs === null || tariffs.length === 0) {
      loadTariffs.mutate()
      return
    }
    if (!form.street.trim() || !form.contactName.trim() || !form.phone.trim()) {
      setFormError("Заполните адрес склада, контактное лицо и телефон.")
      return
    }
    if (!form.tariffCodes.length) {
      setFormError("Выберите хотя бы один тариф для покупателей.")
      return
    }
    saveConfig.mutate()
  }

  const pending = loadTariffs.isPending || saveConfig.isPending

  return (
    <FocusModal open={open} onOpenChange={(nextOpen) => !nextOpen && !pending && onClose()}>
      <FocusModal.Content>
        <div className="flex h-full flex-col overflow-hidden">
          <FocusModal.Header>
            <Heading level="h2">Настройка СДЭК</Heading>
            <div className="flex items-center gap-2">
              <Button size="small" variant="secondary" disabled={pending} onClick={onClose}>Отмена</Button>
              <Button size="small" isLoading={pending} disabled={pending || configQuery.isLoading} onClick={handlePrimaryAction}>
                {tariffs?.length ? "Проверить и сохранить" : loadTariffs.isError ? "Повторить проверку" : "Проверить доступы"}
              </Button>
            </div>
          </FocusModal.Header>
          <FocusModal.Body className="flex-1 overflow-auto p-0">
            {configQuery.isLoading ? (
              <div className="grid grid-cols-2 gap-8 p-8">
                <Skeleton className="h-64" /><Skeleton className="h-64" />
              </div>
            ) : configQuery.isError ? (
              <Text size="small" className="p-8 text-ui-fg-error">Не удалось загрузить настройки СДЭК.</Text>
            ) : (
              <div className="grid min-h-full grid-cols-2 divide-x">
                <div className="flex flex-col gap-5 p-8">
                  <div>
                    <Heading level="h3">Доступы</Heading>
                    <Text size="small" className="text-ui-fg-subtle">Реквизиты проверяются в СДЭК до активации провайдера.</Text>
                  </div>
                  {([
                    ["clientId", "Идентификатор клиента", "text"],
                    ["clientSecret", "Секрет клиента", "text"],
                  ] as const).map(([key, label, type]) => (
                    <div key={key} className="flex flex-col gap-2">
                      <Label htmlFor={`cdek-${key}`}>{label}</Label>
                      <Input
                        id={`cdek-${key}`}
                        type={type}
                        autoComplete="off"
                        value={form[key]}
                        disabled={pending}
                        onFocus={() => isMaskedSecret(form[key]) && setField(key, "")}
                        onChange={(event) => setField(key, event.target.value)}
                      />
                    </div>
                  ))}
                  <div className="flex flex-col gap-2">
                    <Label id="cdek-contract-label">Тип договора</Label>
                    <Select value={form.contractType} disabled={pending} onValueChange={(value) => setField("contractType", value as CdekForm["contractType"])}>
                      <Select.Trigger aria-labelledby="cdek-contract-label"><Select.Value /></Select.Trigger>
                      <Select.Content>
                        <Select.Item value="online_store">Интернет-магазин</Select.Item>
                        <Select.Item value="delivery">Договор доставки</Select.Item>
                      </Select.Content>
                    </Select>
                  </div>
                  {configQuery.data?.configured ? (
                    <div className="rounded-md bg-ui-bg-subtle px-3 py-3">
                      <Text size="small" weight="plus">Реквизиты сохранены</Text>
                      <Text size="small" className="text-ui-fg-subtle">Секрет показан частично. Чтобы заменить его, введите новое значение целиком.</Text>
                    </div>
                  ) : null}
                  {formError ? (
                    <div role="alert" className="rounded-md bg-ui-bg-base-error px-3 py-3">
                      <Text size="small" weight="plus" className="text-ui-fg-error">СДЭК не был активирован</Text>
                      <Text size="small" className="text-ui-fg-error">{formError}</Text>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-5 bg-ui-bg-subtle p-8">
                  <div>
                    <Heading level="h3">Отправитель</Heading>
                    <Text size="small" className="text-ui-fg-subtle">Данные склада, от которого СДЭК рассчитывает и принимает отправления.</Text>
                  </div>
                  {([
                    ["city", "Город"], ["street", "Улица и дом"], ["postalCode", "Индекс"],
                    ["contactName", "Контактное лицо"], ["phone", "Телефон"],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="flex flex-col gap-2">
                      <Label htmlFor={`cdek-${key}`}>{label}</Label>
                      <Input id={`cdek-${key}`} value={form[key]} disabled={pending} onChange={(event) => setField(key, event.target.value)} />
                    </div>
                  ))}
                  <div className="border-t pt-5">
                    <Heading level="h3">Тарифы для покупателей</Heading>
                    <Text size="small" className="text-ui-fg-subtle">Отметьте варианты, которые будут доступны при оформлении заказа.</Text>
                    {tariffs === null ? (
                      <div className="mt-3 rounded-md border border-dashed px-4 py-8 text-center">
                        <Text size="small" weight="plus">Сначала проверьте доступы</Text>
                        <Text size="small" className="text-ui-fg-subtle">После успешной авторизации загрузим тарифы, доступные по договору СДЭК.</Text>
                      </div>
                    ) : tariffs.length === 0 ? (
                      <div className="mt-3 rounded-md border border-dashed px-4 py-8 text-center">
                        <Text size="small" weight="plus">Список тарифов не получен</Text>
                        <Text size="small" className="text-ui-fg-subtle">Причина показана слева. Исправьте данные или повторите проверку.</Text>
                      </div>
                    ) : (
                      <div className="mt-3 divide-y rounded-md border bg-ui-bg-base">
                        {tariffs.map((tariff) => (
                          <label key={tariff.code} className="flex cursor-pointer items-center gap-3 px-3 py-3">
                            <Checkbox
                              checked={form.tariffCodes.includes(tariff.code)}
                              disabled={pending}
                              onCheckedChange={(checked) => setForm((current) => ({
                                ...current,
                                tariffCodes: checked === true
                                  ? [...current.tariffCodes, tariff.code]
                                  : current.tariffCodes.filter((code) => code !== tariff.code),
                              }))}
                            />
                            <Text size="small"><strong>{tariff.code}</strong> · {tariff.name}</Text>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </FocusModal.Body>
        </div>
      </FocusModal.Content>
    </FocusModal>
  )
}

function OzonConfigurationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<OzonForm>(EMPTY_OZON_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const configQuery = useQuery({
    queryKey: OZON_CONFIG_QUERY_KEY,
    queryFn: () => sdk.client.fetch<OzonConfigResponse>("/admin/shipping-providers/ozon"),
    enabled: open,
  })

  useEffect(() => {
    if (!open || !configQuery.data) return
    const saved = configQuery.data
    setForm({
      clientId: saved.credentials?.client_id ?? "",
      clientSecret: saved.credentials?.client_secret ?? "",
      city: saved.configuration?.sender?.city ?? "",
      postalCode: saved.configuration?.sender?.postal_code ?? "",
      maxWeightGrams: saved.configuration?.max_weight_grams?.toString() ?? "",
      pickupPointCacheTtlSeconds: saved.configuration?.pickup_point_cache_ttl_seconds?.toString() ?? "",
    })
    setFormError(null)
  }, [open, configQuery.data])

  function setField<K extends keyof OzonForm>(field: K, value: OzonForm[K]) {
    setForm((current) => ({ ...current, [field]: value }))
    setFormError(null)
  }

  const saveConfig = useMutation({
    mutationFn: () => {
      const sender = form.city.trim() || form.postalCode.trim()
        ? { city: form.city.trim() || undefined, postal_code: form.postalCode.trim() || undefined }
        : undefined
      return sdk.client.fetch<OzonConfigResponse>("/admin/shipping-providers/ozon", {
        method: "POST",
        body: {
          ...(form.clientId && !isMaskedSecret(form.clientId) ? { client_id: form.clientId.trim() } : {}),
          ...(form.clientSecret && !isMaskedSecret(form.clientSecret) ? { client_secret: form.clientSecret } : {}),
          configuration: {
            ...(sender ? { sender } : {}),
            ...(form.maxWeightGrams.trim() ? { max_weight_grams: Math.round(Number(form.maxWeightGrams)) } : {}),
            ...(form.pickupPointCacheTtlSeconds.trim()
              ? { pickup_point_cache_ttl_seconds: Math.round(Number(form.pickupPointCacheTtlSeconds)) }
              : {}),
          },
        },
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SHIPPING_PROVIDERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: OZON_CONFIG_QUERY_KEY }),
      ])
      toast.success("Ozon настроен и включён")
      onClose()
    },
    onError: (error) => {
      setFormError(messageFromError(error, "Ozon отклонил реквизиты. Провайдер не был активирован."))
    },
  })

  function handleSave() {
    setFormError(null)
    if (!form.clientId || !form.clientSecret) {
      setFormError("Заполните реквизиты доступа.")
      return
    }
    saveConfig.mutate()
  }

  const pending = saveConfig.isPending

  return (
    <FocusModal open={open} onOpenChange={(nextOpen) => !nextOpen && !pending && onClose()}>
      <FocusModal.Content>
        <div className="flex h-full flex-col overflow-hidden">
          <FocusModal.Header>
            <Heading level="h2">Настройка Ozon</Heading>
            <div className="flex items-center gap-2">
              <Button size="small" variant="secondary" disabled={pending} onClick={onClose}>Отмена</Button>
              <Button size="small" isLoading={pending} disabled={pending || configQuery.isLoading} onClick={handleSave}>
                Проверить и сохранить
              </Button>
            </div>
          </FocusModal.Header>
          <FocusModal.Body className="flex-1 overflow-auto p-0">
            {configQuery.isLoading ? (
              <div className="grid grid-cols-2 gap-8 p-8">
                <Skeleton className="h-64" /><Skeleton className="h-64" />
              </div>
            ) : configQuery.isError ? (
              <Text size="small" className="p-8 text-ui-fg-error">Не удалось загрузить настройки Ozon.</Text>
            ) : (
              <div className="grid min-h-full grid-cols-2 divide-x">
                <div className="flex flex-col gap-5 p-8">
                  <div>
                    <Heading level="h3">Доступы</Heading>
                    <Text size="small" className="text-ui-fg-subtle">Реквизиты проверяются в Ozon до активации провайдера.</Text>
                  </div>
                  {([
                    ["clientId", "Client ID", "text"],
                    ["clientSecret", "Client secret", "text"],
                  ] as const).map(([key, label, type]) => (
                    <div key={key} className="flex flex-col gap-2">
                      <Label htmlFor={`ozon-${key}`}>{label}</Label>
                      <Input
                        id={`ozon-${key}`}
                        type={type}
                        autoComplete="off"
                        value={form[key]}
                        disabled={pending}
                        onFocus={() => isMaskedSecret(form[key]) && setField(key, "")}
                        onChange={(event) => setField(key, event.target.value)}
                      />
                    </div>
                  ))}
                  {configQuery.data?.configured ? (
                    <div className="rounded-md bg-ui-bg-subtle px-3 py-3">
                      <Text size="small" weight="plus">Реквизиты сохранены</Text>
                      <Text size="small" className="text-ui-fg-subtle">Секрет показан частично. Чтобы заменить его, введите новое значение целиком.</Text>
                    </div>
                  ) : null}
                  {formError ? (
                    <div role="alert" className="rounded-md bg-ui-bg-base-error px-3 py-3">
                      <Text size="small" weight="plus" className="text-ui-fg-error">Ozon не был активирован</Text>
                      <Text size="small" className="text-ui-fg-error">{formError}</Text>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-5 bg-ui-bg-subtle p-8">
                  <div>
                    <Heading level="h3">Отправитель и лимиты</Heading>
                    <Text size="small" className="text-ui-fg-subtle">Необязательно — Ozon подставит значения по умолчанию, если оставить поля пустыми.</Text>
                  </div>
                  {([
                    ["city", "Город отправителя"],
                    ["postalCode", "Индекс отправителя"],
                    ["maxWeightGrams", "Максимальный вес, г"],
                    ["pickupPointCacheTtlSeconds", "Кэш ПВЗ, сек"],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="flex flex-col gap-2">
                      <Label htmlFor={`ozon-${key}`}>{label}</Label>
                      <Input id={`ozon-${key}`} value={form[key]} disabled={pending} onChange={(event) => setField(key, event.target.value)} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </FocusModal.Body>
        </div>
      </FocusModal.Content>
    </FocusModal>
  )
}

const ShippingProvidersPage = () => {
  const [cdekModalOpen, setCdekModalOpen] = useState(false)
  const [ozonModalOpen, setOzonModalOpen] = useState(false)
  const { data, isLoading, isError } = useShippingProviders()

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h1">Доставка</Heading>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Провайдеры доставки, доступные покупателям при оформлении заказа.
          </Text>
        </div>
        {isLoading ? <ProviderRowsSkeleton /> : isError ? (
          <Text size="small" className="px-6 py-4 text-ui-fg-error">Не удалось загрузить провайдеров доставки.</Text>
        ) : (
          <div className="divide-y">
            {(data?.shipping_providers ?? []).map((provider) => (
              <ShippingProviderRow
                key={provider.provider_key}
                provider={provider}
                onConfigureCdek={() => setCdekModalOpen(true)}
                onConfigureOzon={() => setOzonModalOpen(true)}
              />
            ))}
          </div>
        )}
      </Container>
      <StorePickupCard />
      <StorePackageCard />
      <CdekConfigurationModal open={cdekModalOpen} onClose={() => setCdekModalOpen(false)} />
      <OzonConfigurationModal open={ozonModalOpen} onClose={() => setOzonModalOpen(false)} />
    </div>
  )
}

export const config = defineRouteConfig({ label: "Доставка", icon: TruckFast })

export default ShippingProvidersPage
