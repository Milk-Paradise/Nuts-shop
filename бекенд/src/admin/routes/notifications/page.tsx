import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChatBubbleLeftRight, TriangleRightMini } from "@medusajs/icons"
import {
  Button,
  Checkbox,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  Tabs,
  Text,
} from "@medusajs/ui"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"

import { sdk } from "../../lib/sdk"
import {
  channelLabels,
  formatNotificationDate,
  notificationStateColors,
  notificationStateLabels,
  notificationAttemptResultLabels,
  notificationTypeLabel,
  NOTIFICATION_JOURNAL_API_PATH,
  orderLabel,
  type AdminNotification,
  type NotificationsResponse,
  type NotificationState,
} from "../../lib/notifications"
import { NotificationChannelsTab } from "./channels"

const PAGE_SIZE = 20
const ALL = "all"
const NOTIFICATION_TYPES = [
  "order-confirmation",
  "order-payment-confirmed",
  "customer-password-reset",
  "shipping-return-status",
  "abandoned-cart-reminder",
  "seller-new-order",
  "seller-return-request",
]

function queryString(filters: Record<string, string | number | boolean>) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== "" && value !== ALL && value !== false) params.set(key, String(value))
  })
  return params.toString()
}

function NotificationStatus({ state }: { state: NotificationState }) {
  return (
    <StatusBadge color={notificationStateColors[state]} className="whitespace-nowrap">
      {notificationStateLabels[state]}
    </StatusBadge>
  )
}

function JournalSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-6 py-4">
      {[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-10 w-full" />)}
    </div>
  )
}

function NotificationDrawer({
  notification,
  onClose,
}: {
  notification: AdminNotification | null
  onClose: () => void
}) {
  return (
    <Drawer open={Boolean(notification)} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{notification ? notificationTypeLabel(notification.type) : "Уведомление"}</Drawer.Title>
          {notification && notification.order_id ? (
            <Text size="small" leading="compact">
              <Link className="text-ui-fg-interactive" to={`/orders/${notification.order_id}`}>
                {orderLabel(notification)}
              </Link>
            </Text>
          ) : null}
        </Drawer.Header>
        {notification ? (
          <Drawer.Body className="flex flex-1 flex-col divide-y overflow-auto p-0">
            <div className="grid grid-cols-2 gap-3 px-6 py-4">
              <div>
                <Text size="small" leading="compact" className="text-ui-fg-subtle">Получатель</Text>
                <Text size="small" leading="compact" weight="plus">{notification.recipient}</Text>
              </div>
              <div>
                <Text size="small" leading="compact" className="text-ui-fg-subtle">Канал</Text>
                <Text size="small" leading="compact" weight="plus">{channelLabels[notification.channel]}</Text>
              </div>
              <div className="col-span-2 flex flex-col items-start gap-1">
                <Text size="small" leading="compact" className="text-ui-fg-subtle">Состояние</Text>
                <NotificationStatus state={notification.state} />
              </div>
              <div className="col-span-2">
                <Text size="small" leading="compact" className="text-ui-fg-subtle">Причина</Text>
                <Text size="small" leading="compact">{notification.reason ?? "—"}</Text>
              </div>
            </div>
            <div className="flex flex-col gap-3 px-6 py-4">
              <Text size="small" leading="compact" weight="plus">Попытки</Text>
              {notification.attempts.length ? notification.attempts.map((attempt) => (
                <div key={attempt.id} className="flex gap-3">
                  <Text size="small" leading="compact" className="text-ui-fg-muted">{attempt.number}</Text>
                  <div>
                    <Text size="small" leading="compact" weight="plus">
                      {formatNotificationDate(attempt.attempted_at).date} {formatNotificationDate(attempt.attempted_at).time} · {notificationAttemptResultLabels[attempt.result]}
                    </Text>
                    <Text size="small" leading="compact" className="text-ui-fg-subtle">{attempt.reason ?? "—"}</Text>
                  </div>
                </div>
              )) : (
                <Text size="small" leading="compact" className="text-ui-fg-subtle">Попыток пока нет</Text>
              )}
            </div>
            <div className="flex flex-col gap-3 px-6 py-4">
              <Text size="small" leading="compact" weight="plus">Отправленный текст</Text>
              <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
                <Text size="small" leading="compact" weight="plus">{notification.subject ? `Тема: ${notification.subject}` : "Без темы"}</Text>
                <Text size="small" leading="compact" className="mt-2 text-ui-fg-subtle">{notification.text ?? "—"}</Text>
              </div>
            </div>
            <div className="px-6 py-4">
              <Text size="xsmall" leading="compact" className="text-ui-fg-muted">
                ревизия снимка {notification.template_revision ?? "—"} · шаблон {notification.template_key ?? "—"}
              </Text>
            </div>
          </Drawer.Body>
        ) : null}
      </Drawer.Content>
    </Drawer>
  )
}

const NotificationsPage = () => {
  const [searchParams] = useSearchParams()
  const initialQuery = searchParams.get("q") ?? ""
  const [search, setSearch] = useState(initialQuery)
  const [query, setQuery] = useState(initialQuery)
  const [channel, setChannel] = useState(ALL)
  const [state, setState] = useState(ALL)
  const [type, setType] = useState(ALL)
  const [showTests, setShowTests] = useState(false)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<AdminNotification | null>(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(search.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [search])

  const filters = { q: query, channel, state, type, show_tests: showTests, limit: PAGE_SIZE, offset: page * PAGE_SIZE }
  const notificationsQuery = useQuery({
    queryKey: ["notification-journal", filters],
    queryFn: () => sdk.client.fetch<NotificationsResponse>(`${NOTIFICATION_JOURNAL_API_PATH}?${queryString(filters)}`),
    placeholderData: keepPreviousData,
  })
  const notifications = notificationsQuery.data?.notifications ?? []
  const count = notificationsQuery.data?.count ?? 0
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const hasFilters = Boolean(query || channel !== ALL || state !== ALL || type !== ALL || showTests)

  function resetFilters() {
    setSearch("")
    setQuery("")
    setChannel(ALL)
    setState(ALL)
    setType(ALL)
    setShowTests(false)
    setPage(0)
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Уведомления</Heading>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">Настройте способы связи с покупателями и продавцами магазина.</Text>
      </div>
      <Tabs defaultValue="journal">
        <Tabs.List className="px-6">
          <Tabs.Trigger value="journal">Журнал</Tabs.Trigger>
          <Tabs.Trigger value="channels">Каналы</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="journal">
          <div className="grid grid-cols-4 gap-2 px-4 py-3">
            <Input className="col-span-2" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} placeholder="Заказ или получатель" aria-label="Заказ или получатель" />
            <Select value={channel} onValueChange={(value) => { setChannel(value); setPage(0) }}><Select.Trigger><Select.Value /></Select.Trigger><Select.Content><Select.Item value={ALL}>Все каналы</Select.Item><Select.Item value="email">Почта</Select.Item><Select.Item value="telegram">Telegram</Select.Item><Select.Item value="sms">SMS</Select.Item><Select.Item value="none">Без канала</Select.Item></Select.Content></Select>
            <Select value={state} onValueChange={(value) => { setState(value); setPage(0) }}><Select.Trigger><Select.Value /></Select.Trigger><Select.Content><Select.Item value={ALL}>Все состояния</Select.Item>{Object.entries(notificationStateLabels).map(([value, label]) => <Select.Item key={value} value={value}>{label}</Select.Item>)}</Select.Content></Select>
            <Select value={type} onValueChange={(value) => { setType(value); setPage(0) }}><Select.Trigger><Select.Value placeholder="Все типы" /></Select.Trigger><Select.Content><Select.Item value={ALL}>Все типы</Select.Item>{NOTIFICATION_TYPES.map((value) => <Select.Item key={value} value={value}>{notificationTypeLabel(value)}</Select.Item>)}</Select.Content></Select>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox id="show-tests" checked={showTests} onCheckedChange={(checked) => { setShowTests(checked === true); setPage(0) }} />
              <Label htmlFor="show-tests">Показывать тесты</Label>
            </div>
          </div>
          {notificationsQuery.isLoading ? <JournalSkeleton /> : notificationsQuery.isError ? (
            <div className="flex min-h-32 flex-col items-start justify-center gap-3 px-6 py-4"><Text size="small" className="text-ui-fg-error">Не удалось загрузить уведомления</Text><Button size="small" variant="secondary" onClick={() => notificationsQuery.refetch()}>Повторить</Button></div>
          ) : notifications.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 py-6 text-center"><Text size="small" leading="compact" weight="plus">{hasFilters ? "Ничего не найдено" : "Уведомлений пока нет"}</Text>{hasFilters ? <Button size="small" variant="secondary" onClick={resetFilters}>Сбросить фильтры</Button> : <Text size="small" leading="compact" className="text-ui-fg-subtle">Здесь появятся отправленные уведомления.</Text>}</div>
          ) : (
            <Table>
              <Table.Header><Table.Row><Table.HeaderCell>Дата</Table.HeaderCell><Table.HeaderCell>Тип</Table.HeaderCell><Table.HeaderCell>Получатель</Table.HeaderCell><Table.HeaderCell>Канал</Table.HeaderCell><Table.HeaderCell>Состояние</Table.HeaderCell><Table.HeaderCell>Причина</Table.HeaderCell></Table.Row></Table.Header>
              <Table.Body>{notifications.map((notification) => {
                const formatted = formatNotificationDate(notification.created_at)
                return <Table.Row key={notification.id} className="cursor-pointer" onClick={() => setSelected(notification)}><Table.Cell className="whitespace-nowrap"><Text size="small" leading="compact">{formatted.date}</Text><Text size="xsmall" leading="compact" className="text-ui-fg-muted">{formatted.time}</Text></Table.Cell><Table.Cell><Text size="small" leading="compact" weight="plus">{notificationTypeLabel(notification.type)}</Text><div className="flex items-center gap-1">{notification.order_id ? <Link to={`/orders/${notification.order_id}`} onClick={(event) => event.stopPropagation()}><Text size="xsmall" leading="compact" className="text-ui-fg-interactive">{orderLabel(notification)}</Text></Link> : <Text size="xsmall" leading="compact" className="text-ui-fg-muted">—</Text>}{notification.is_test ? <StatusBadge color="grey">тест</StatusBadge> : null}</div></Table.Cell><Table.Cell>{notification.recipient}</Table.Cell><Table.Cell>{channelLabels[notification.channel]}</Table.Cell><Table.Cell><NotificationStatus state={notification.state} /></Table.Cell><Table.Cell><div className="flex min-w-0 items-center justify-between gap-2"><Text size="small" leading="compact" className="max-w-40 truncate text-ui-fg-subtle" title={notification.reason ?? undefined}>{notification.reason ?? "—"}</Text><TriangleRightMini className="shrink-0 text-ui-fg-muted" /></div></Table.Cell></Table.Row>
              })}</Table.Body>
            </Table>
          )}
          <div className="flex items-center justify-between px-4 py-3"><Text size="small" leading="compact" className="text-ui-fg-subtle">{count} уведомлений</Text><div className="flex items-center gap-2"><Button size="small" variant="secondary" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Назад</Button><Text size="small" leading="compact">{page + 1} из {pages}</Text><Button size="small" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>Далее</Button></div></div>
        </Tabs.Content>
        <Tabs.Content value="channels"><NotificationChannelsTab /></Tabs.Content>
      </Tabs>
      <NotificationDrawer notification={selected} onClose={() => setSelected(null)} />
    </Container>
  )
}

export const config = defineRouteConfig({ label: "Уведомления", icon: ChatBubbleLeftRight })

export default NotificationsPage
