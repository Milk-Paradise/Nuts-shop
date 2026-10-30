import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps, AdminOrder } from "@medusajs/framework/types"
import { TriangleRightMini } from "@medusajs/icons"
import { Button, Container, Heading, Skeleton, StatusBadge, Table, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { sdk } from "../lib/sdk"
import { channelLabels, formatNotificationDate, NOTIFICATION_JOURNAL_API_PATH, notificationStateColors, notificationStateLabels, notificationTypeLabel, type NotificationsResponse } from "../lib/notifications"

const OrderNotificationsWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const query = useQuery({
    queryKey: ["order-notifications", order.id],
    queryFn: () => sdk.client.fetch<NotificationsResponse>(`${NOTIFICATION_JOURNAL_API_PATH}?order_id=${encodeURIComponent(order.id)}&limit=20`),
  })
  const notifications = query.data?.notifications ?? []

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Уведомления по заказу</Heading>
        <Button asChild size="small" variant="transparent"><Link to={`/notifications?q=${encodeURIComponent(order.id)}`}>Открыть в журнале</Link></Button>
      </div>
      {query.isLoading ? <div className="flex flex-col gap-3 px-6 py-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : query.isError ? <div className="flex flex-col items-start gap-3 px-6 py-4"><Text size="small" className="text-ui-fg-error">Не удалось загрузить уведомления</Text><Button size="small" variant="secondary" onClick={() => query.refetch()}>Повторить</Button></div> : notifications.length === 0 ? <div className="flex min-h-28 flex-col items-center justify-center px-6 py-6 text-center"><Text size="small" leading="compact" weight="plus">Уведомлений пока нет</Text><Text size="small" leading="compact" className="text-ui-fg-subtle">Для этого заказа отправок не было.</Text></div> : (
        <Table><Table.Header><Table.Row><Table.HeaderCell>Время</Table.HeaderCell><Table.HeaderCell>Уведомление</Table.HeaderCell><Table.HeaderCell>Состояние</Table.HeaderCell></Table.Row></Table.Header><Table.Body>{notifications.map((notification) => {
          const formatted = formatNotificationDate(notification.created_at)
          return <Table.Row key={notification.id}><Table.Cell className="whitespace-nowrap"><Text size="small" leading="compact">{formatted.date}</Text><Text size="xsmall" leading="compact" className="text-ui-fg-muted">{formatted.time} · {channelLabels[notification.channel]}</Text></Table.Cell><Table.Cell><Text size="small" leading="compact" weight="plus">{notificationTypeLabel(notification.type)}</Text><Text size="xsmall" leading="compact" className="text-ui-fg-subtle">{notification.recipient}</Text>{notification.reason ? <Text size="xsmall" leading="compact" className="max-w-40 truncate text-ui-fg-error" title={notification.reason}>{notification.reason}</Text> : null}</Table.Cell><Table.Cell><div className="flex items-center justify-between gap-2"><StatusBadge color={notificationStateColors[notification.state]} className="whitespace-nowrap">{notificationStateLabels[notification.state]}</StatusBadge><TriangleRightMini className="text-ui-fg-muted" /></div></Table.Cell></Table.Row>
        })}</Table.Body></Table>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({ zone: "order.details.after", id: "auto-paint-store:order-notifications" })

export default OrderNotificationsWidget
