import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import {
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  Select,
  Skeleton,
  StatusBadge,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"

import { sdk } from "../../lib/sdk"

type AdminPaymentProvider = {
  id: string
  name: string
  is_enabled: boolean
  is_configured: boolean
  configuration_status: "configured" | "requires_configuration"
  shop_id: string | null
  mode: "test" | "live"
  secret_key_set: boolean
}

type PaymentProvidersResponse = {
  payment_providers: AdminPaymentProvider[]
}

const paymentProvidersQueryKey = ["payment-providers"] as const

function errorMessage(
  error: unknown,
  fallback = "Не удалось изменить статус способа оплаты"
) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallback
}

function PaymentProviderRow({
  provider,
  isUpdating,
  onStatusChange,
  onConfigure,
}: {
  provider: AdminPaymentProvider
  isUpdating: boolean
  onStatusChange: (isEnabled: boolean) => void
  onConfigure: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-6 py-4">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center gap-2">
          <Text size="small" leading="compact" weight="plus">
            {provider.name}
          </Text>
          <StatusBadge color={provider.is_enabled ? "green" : "grey"}>
            {provider.is_enabled ? "Включён" : "Выключен"}
          </StatusBadge>
        </div>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {provider.is_configured
            ? `Настроен · ${provider.mode === "live" ? "боевой режим" : "тестовый режим"}`
            : "Требует настройки: укажите ID магазина и секретный ключ"}
        </Text>
      </div>
      <div className="flex items-center gap-3">
        <Button size="small" variant="secondary" onClick={onConfigure}>
          {provider.is_configured ? "Изменить" : "Настроить"}
        </Button>
        <Switch
          checked={provider.is_enabled}
          disabled={!provider.is_configured || isUpdating}
          onCheckedChange={onStatusChange}
          aria-label={`${provider.is_enabled ? "Выключить" : "Включить"} ${provider.name}`}
        />
      </div>
    </div>
  )
}

type ConfigurationForm = {
  shopId: string
  secretKey: string
  mode: "test" | "live"
}

type ConfigurationErrors = Partial<Record<"shopId" | "secretKey", string>>

function PaymentProviderConfigurationDrawer({
  provider,
  onClose,
}: {
  provider: AdminPaymentProvider | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ConfigurationForm>({
    shopId: "",
    secretKey: "",
    mode: "test",
  })
  const [errors, setErrors] = useState<ConfigurationErrors>({})

  useEffect(() => {
    if (!provider) {
      return
    }

    setForm({
      shopId: provider.shop_id ?? "",
      secretKey: "",
      mode: provider.mode,
    })
    setErrors({})
  }, [provider])

  const saveMutation = useMutation({
    mutationFn: (input: ConfigurationForm) =>
      sdk.client.fetch(`/admin/payment-providers/${provider?.id}`, {
        method: "POST",
        body: {
          shop_id: input.shopId.trim(),
          secret_key: input.secretKey,
          mode: input.mode,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: paymentProvidersQueryKey })
      toast.success("Настройки способа оплаты сохранены")
      onClose()
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Не удалось сохранить настройки способа оплаты"))
    },
  })

  function setField<K extends keyof ConfigurationForm>(
    field: K,
    value: ConfigurationForm[K]
  ) {
    setForm((current) => ({ ...current, [field]: value }))
    if (field === "shopId" || field === "secretKey") {
      setErrors((current) => ({ ...current, [field]: undefined }))
    }
  }

  function handleSave() {
    const nextErrors: ConfigurationErrors = {}

    if (!form.shopId.trim()) {
      nextErrors.shopId = "Укажите ID магазина"
    }

    if (!provider?.secret_key_set && !form.secretKey.trim()) {
      nextErrors.secretKey = "Укажите секретный ключ"
    }

    setErrors(nextErrors)

    if (Object.keys(nextErrors).length) {
      return
    }

    saveMutation.mutate(form)
  }

  return (
    <Drawer
      open={Boolean(provider)}
      onOpenChange={(open) => {
        if (!open && !saveMutation.isPending) {
          onClose()
        }
      }}
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Настройки {provider?.name}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-1 flex-col gap-4 overflow-auto p-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="payment-provider-shop-id">ID магазина</Label>
            <Input
              id="payment-provider-shop-id"
              value={form.shopId}
              disabled={saveMutation.isPending}
              onChange={(event) => setField("shopId", event.target.value)}
              aria-invalid={Boolean(errors.shopId)}
              aria-describedby={errors.shopId ? "payment-provider-shop-id-error" : undefined}
            />
            {errors.shopId ? (
              <Text
                id="payment-provider-shop-id-error"
                role="alert"
                size="small"
                className="text-ui-fg-error"
              >
                {errors.shopId}
              </Text>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="payment-provider-secret-key">Секретный ключ</Label>
            <Input
              id="payment-provider-secret-key"
              type="password"
              autoComplete="new-password"
              value={form.secretKey}
              disabled={saveMutation.isPending}
              onChange={(event) => setField("secretKey", event.target.value)}
              placeholder={
                provider?.secret_key_set ? "Сохранён — оставьте пустым без изменений" : undefined
              }
              aria-invalid={Boolean(errors.secretKey)}
              aria-describedby={
                errors.secretKey
                  ? "payment-provider-secret-key-error"
                  : provider?.secret_key_set
                    ? "payment-provider-secret-key-help"
                    : undefined
              }
            />
            {errors.secretKey ? (
              <Text
                id="payment-provider-secret-key-error"
                role="alert"
                size="small"
                className="text-ui-fg-error"
              >
                {errors.secretKey}
              </Text>
            ) : provider?.secret_key_set ? (
              <Text
                id="payment-provider-secret-key-help"
                size="small"
                leading="compact"
                className="text-ui-fg-subtle"
              >
                Ключ сохранён. Введите новый только для его замены.
              </Text>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label id="payment-provider-mode-label">Режим</Label>
            <Select
              value={form.mode}
              disabled={saveMutation.isPending}
              onValueChange={(value) =>
                setField("mode", value as ConfigurationForm["mode"])
              }
            >
              <Select.Trigger aria-labelledby="payment-provider-mode-label">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="test">Тестовый</Select.Item>
                <Select.Item value="live">Боевой</Select.Item>
              </Select.Content>
            </Select>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <div className="flex items-center justify-end gap-2">
            <Button
              size="small"
              variant="secondary"
              disabled={saveMutation.isPending}
              onClick={onClose}
            >
              Отмена
            </Button>
            <Button
              size="small"
              isLoading={saveMutation.isPending}
              onClick={handleSave}
            >
              Сохранить
            </Button>
          </div>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

const PaymentProvidersPage = () => {
  const queryClient = useQueryClient()
  const [configuredProvider, setConfiguredProvider] =
    useState<AdminPaymentProvider | null>(null)
  const { data, isLoading, isError } = useQuery({
    queryKey: paymentProvidersQueryKey,
    queryFn: () =>
      sdk.client.fetch<PaymentProvidersResponse>("/admin/payment-providers"),
  })
  const statusMutation = useMutation({
    mutationFn: ({
      providerId,
      isEnabled,
    }: {
      providerId: string
      isEnabled: boolean
    }) =>
      sdk.client.fetch(`/admin/payment-providers/${providerId}/status`, {
        method: "POST",
        body: { is_enabled: isEnabled },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: paymentProvidersQueryKey })
      toast.success("Статус способа оплаты обновлён")
    },
    onError: (error) => {
      toast.error(errorMessage(error))
    },
  })

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h1">Способы оплаты</Heading>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Управляйте способами онлайн-оплаты, доступными покупателям.
        </Text>
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-3 px-6 py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
      ) : isError ? (
        <div className="px-6 py-4">
          <Text size="small" leading="compact" className="text-ui-fg-error">
            Не удалось загрузить способы оплаты.
          </Text>
        </div>
      ) : (
        <div className="divide-y">
          {(data?.payment_providers ?? []).map((provider) => (
            <PaymentProviderRow
              key={provider.id}
              provider={provider}
              isUpdating={
                statusMutation.isPending &&
                statusMutation.variables?.providerId === provider.id
              }
              onStatusChange={(isEnabled) =>
                statusMutation.mutate({
                  providerId: provider.id,
                  isEnabled,
                })
              }
              onConfigure={() => setConfiguredProvider(provider)}
            />
          ))}
        </div>
      )}
      <PaymentProviderConfigurationDrawer
        provider={configuredProvider}
        onClose={() => setConfiguredProvider(null)}
      />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Способы оплаты",
})

export default PaymentProvidersPage
