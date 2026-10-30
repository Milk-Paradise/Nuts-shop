import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChatBubbleLeftRight, Spinner } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Input, Label, RadioGroup, Switch, Table, Text, usePrompt } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FormEvent, useState } from "react"

import { sdk } from "../../lib/sdk"
import {
  formatMoyskladCycleDate,
  getMoyskladUnmatchedReasonLabel,
  getMoyskladUnmatchedSourceLabel,
  type MoyskladUnmatchedReason,
  type MoyskladUnmatchedSource
} from "../../lib/moysklad-stock-sync"

type MoyskladUnmatchedItem = {
  source: MoyskladUnmatchedSource
  source_id: string
  code: string | null
  sku: string | null
  name: string | null
  reason: MoyskladUnmatchedReason
}

type MoyskladConnectionStatus = {
  configured: boolean
  is_active: boolean
  stock_sync_last_error: string | null
  stock_sync_last_attempt_at: string | null
  stock_sync_last_success_at: string | null
  stock_sync_unmatched: MoyskladUnmatchedItem[]
  attention_reason: string | null
}

type AuthenticationType = "token" | "basic"

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось проверить доступ к МойСклад."
}

const MoyskladSettingsPage = () => {
  const [authenticationType, setAuthenticationType] = useState<AuthenticationType>("token")
  const [token, setToken] = useState("")
  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const prompt = usePrompt()
  const connectionQuery = useQuery({
    queryKey: ["moysklad-connection"],
    queryFn: () => sdk.client.fetch<MoyskladConnectionStatus>("/admin/moysklad/config")
  })
  const saveConnection = useMutation({
    mutationFn: (credentials: { type: "token"; token: string } | { type: "basic"; login: string; password: string }) =>
      sdk.client.fetch<MoyskladConnectionStatus>("/admin/moysklad/config", {
        method: "POST",
        body: { credentials }
      }),
    onSuccess: (status) => {
      queryClient.setQueryData(["moysklad-connection"], status)
      setToken("")
      setLogin("")
      setPassword("")
      setFormError(null)
    },
    onError: (error) => {
      setFormError(messageFromError(error))
    }
  })
  const setConnectionActivity = useMutation({
    mutationFn: (isActive: boolean) =>
      sdk.client.fetch<MoyskladConnectionStatus>("/admin/moysklad/config/active", {
        method: "POST",
        body: { is_active: isActive }
      }),
    onSuccess: (status) => {
      queryClient.setQueryData(["moysklad-connection"], status)
      setFormError(null)
    },
    onError: (error) => {
      setFormError(messageFromError(error))
    }
  })

  const status = connectionQuery.data
  const unmatchedItems = status?.stock_sync_unmatched ?? []

  function changeAuthenticationType(value: string) {
    if (value !== "token" && value !== "basic") {
      return
    }

    setAuthenticationType(value)
    setToken("")
    setLogin("")
    setPassword("")
    setFormError(null)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const credentials =
      authenticationType === "token"
        ? { type: "token" as const, token: token.trim() }
        : {
            type: "basic" as const,
            login: login.trim(),
            password
          }

    if (
      (credentials.type === "token" && !credentials.token) ||
      (credentials.type === "basic" && (!credentials.login || !credentials.password))
    ) {
      setFormError("Заполните реквизиты доступа.")
      return
    }

    setFormError(null)
    saveConnection.mutate(credentials)
  }

  async function changeConnectionActivity(isActive: boolean) {
    if (!status?.configured || setConnectionActivity.isPending) {
      return
    }

    if (!isActive) {
      const confirmed = await prompt({
        variant: "danger",
        title: "Отключить интеграцию?",
        description: "Новые заказы и синхронизация остатков не будут передаваться в МойСклад.",
        cancelText: "Отмена",
        confirmText: "Отключить"
      })

      if (!confirmed) {
        return
      }
    }

    setFormError(null)
    setConnectionActivity.mutate(isActive)
  }

  return (
    <div className="flex w-full max-w-[1200px] flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between gap-x-4 px-6 py-4">
          <div className="flex flex-col gap-y-1">
            <Heading level="h1">Проблемы синхронизации остатков</Heading>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Последний полный цикл сопоставления номенклатуры МойСклад и вариантов каталога.
            </Text>
          </div>
          {connectionQuery.isPending ? (
            <Spinner className="animate-spin text-ui-fg-subtle" />
          ) : connectionQuery.isError ? (
            <Badge color="red">Недоступно</Badge>
          ) : (
            <Badge color={unmatchedItems.length > 0 ? "red" : "green"}>
              {unmatchedItems.length} {unmatchedItems.length === 1 ? "проблема" : "проблем"}
            </Badge>
          )}
        </div>

        {connectionQuery.isPending ? (
          <div className="flex items-center justify-center px-6 py-12">
            <Spinner className="animate-spin text-ui-fg-subtle" />
          </div>
        ) : connectionQuery.isError ? (
          <div className="px-6 py-8">
            <Text size="small" leading="compact" className="text-ui-fg-error">
              Не удалось загрузить результат синхронизации. Обновите страницу или повторите попытку позже.
            </Text>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-3">
              <div className="flex flex-col gap-y-1">
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  Последний успешный цикл
                </Text>
                <Text size="small" leading="compact" weight="plus">
                  {formatMoyskladCycleDate(status?.stock_sync_last_success_at ?? null)}
                </Text>
              </div>
              <div className="flex flex-col gap-y-1">
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  Последняя попытка
                </Text>
                <Text size="small" leading="compact" weight="plus">
                  {formatMoyskladCycleDate(status?.stock_sync_last_attempt_at ?? null)}
                </Text>
              </div>
              <div className="flex flex-col gap-y-1">
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  Результат попытки
                </Text>
                <Text
                  size="small"
                  leading="compact"
                  weight="plus"
                  className={status?.stock_sync_last_error ? "text-ui-fg-error" : undefined}
                >
                  {status?.stock_sync_last_error
                    ? "Ошибка"
                    : status?.stock_sync_last_attempt_at
                      ? "Успешно"
                      : "Ещё не запускалась"}
                </Text>
              </div>
            </div>

            {status?.stock_sync_last_error && (
              <div className="bg-ui-bg-base-error px-6 py-4">
                <Text size="small" leading="compact" weight="plus" className="text-ui-fg-error">
                  Последняя попытка завершилась ошибкой
                </Text>
                <Text size="small" leading="compact" className="text-ui-fg-error">
                  {status.stock_sync_last_error}
                </Text>
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  Ниже сохранён результат последнего полного успешного цикла.
                </Text>
              </div>
            )}

            {unmatchedItems.length === 0 ? (
              <div className="px-6 py-8">
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  Несопоставленных позиций нет — проблем с применением остатков не обнаружено.
                </Text>
              </div>
            ) : (
              <div className="w-full overflow-x-auto">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Источник</Table.HeaderCell>
                      <Table.HeaderCell>Код МойСклад</Table.HeaderCell>
                      <Table.HeaderCell>SKU варианта</Table.HeaderCell>
                      <Table.HeaderCell>Наименование</Table.HeaderCell>
                      <Table.HeaderCell>Причина</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {unmatchedItems.map((item) => (
                      <Table.Row key={`${item.source}:${item.source_id}:${item.reason}`}>
                        <Table.Cell>{getMoyskladUnmatchedSourceLabel(item.source)}</Table.Cell>
                        <Table.Cell>{item.code ?? ""}</Table.Cell>
                        <Table.Cell>{item.sku ?? ""}</Table.Cell>
                        <Table.Cell>{item.name ?? ""}</Table.Cell>
                        <Table.Cell>{getMoyskladUnmatchedReasonLabel(item.reason)}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
          </>
        )}
      </Container>

      <div className="max-w-3xl">
        <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex flex-col gap-y-1">
            <Heading level="h1">Интеграция с МойСклад</Heading>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Реквизиты проверяются до сохранения.
            </Text>
          </div>
          {connectionQuery.isPending ? (
            <Spinner className="animate-spin text-ui-fg-subtle" />
          ) : connectionQuery.isError ? (
            <Badge color="red">Статус недоступен</Badge>
          ) : status?.configured ? (
            <Badge color={status.attention_reason ? "red" : status.is_active ? "green" : "orange"}>
              {status.attention_reason
                ? "Требует внимания"
                : status.is_active
                  ? "Реквизиты сохранены"
                  : "Интеграция отключена"}
            </Badge>
          ) : (
            <Badge color="grey">Не настроено</Badge>
          )}
        </div>
        <form className="flex flex-col gap-y-5 px-6 py-4" onSubmit={submit}>
          <RadioGroup
            value={authenticationType}
            onValueChange={changeAuthenticationType}
            className="grid grid-cols-2 gap-3"
          >
            <RadioGroup.ChoiceBox value="token" label="Токен" description="Персональный токен доступа МойСклад" />
            <RadioGroup.ChoiceBox
              value="basic"
              label="Логин и пароль"
              description="Учётные данные сотрудника МойСклад"
            />
          </RadioGroup>

          {authenticationType === "token" ? (
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="moysklad-token">Токен доступа</Label>
              <Input
                id="moysklad-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-y-2">
                <Label htmlFor="moysklad-login">Логин</Label>
                <Input
                  id="moysklad-login"
                  autoComplete="username"
                  value={login}
                  onChange={(event) => setLogin(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label htmlFor="moysklad-password">Пароль</Label>
                <Input
                  id="moysklad-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </div>
          )}

          {status?.configured && (
            <div className="flex items-center justify-between gap-x-4">
              <div className="flex flex-col gap-y-1">
                <Label htmlFor="moysklad-active">Интеграция активна</Label>
                <Text size="small" className="text-ui-fg-subtle">
                  Новые заказы и остатки синхронизируются с МойСклад.
                </Text>
              </div>
              <Switch
                id="moysklad-active"
                checked={status.is_active}
                onCheckedChange={changeConnectionActivity}
                disabled={setConnectionActivity.isPending}
              />
            </div>
          )}

          {connectionQuery.isError && (
            <Text size="small" className="text-ui-fg-error">
              Не удалось загрузить статус интеграции.
            </Text>
          )}
          {formError && (
            <Text size="small" className="text-ui-fg-error">
              {formError}
            </Text>
          )}
          {status?.attention_reason && (
            <div className="rounded-md bg-ui-bg-base-error px-3 py-2">
              <Text size="small" weight="plus" className="text-ui-fg-error">
                Интеграция требует внимания
              </Text>
              <Text size="small" className="text-ui-fg-error">
                {status.attention_reason}
              </Text>
            </div>
          )}
          {status?.stock_sync_last_error && (
            <div className="rounded-md bg-ui-bg-base-error px-3 py-2">
              <Text size="small" weight="plus" className="text-ui-fg-error">
                Ошибка синхронизации остатков
              </Text>
              <Text size="small" className="text-ui-fg-error">
                {status.stock_sync_last_error}
              </Text>
              {status.stock_sync_last_attempt_at && (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Последняя попытка: {new Date(status.stock_sync_last_attempt_at).toLocaleString("ru-RU")}
                </Text>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" size="small" isLoading={saveConnection.isPending} disabled={saveConnection.isPending}>
              Проверить и сохранить
            </Button>
          </div>
        </form>
        </Container>
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "МойСклад",
  icon: ChatBubbleLeftRight
})

export default MoyskladSettingsPage
