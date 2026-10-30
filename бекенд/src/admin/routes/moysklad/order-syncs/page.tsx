import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChatBubbleLeftRight } from "@medusajs/icons"
import { Badge, Container, RadioGroup, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { sdk } from "../../../lib/sdk"

type SyncStatus = "all" | "pending" | "syncing" | "synced" | "error"
type OrderSync = {
  id: string
  order_id: string
  status: Exclude<SyncStatus, "all">
  last_error: string | null
  attempts: number
}

const labels: Record<Exclude<SyncStatus, "all">, string> = {
  pending: "Ожидают",
  syncing: "Выполняются",
  synced: "Синхронизированы",
  error: "Ошибки",
}

const colors: Record<Exclude<SyncStatus, "all">, "grey" | "green" | "red" | "orange"> = {
  pending: "grey",
  syncing: "orange",
  synced: "green",
  error: "red",
}

const MoyskladOrderSyncsPage = () => {
  const [status, setStatus] = useState<SyncStatus>("error")
  const syncsQuery = useQuery({
    queryKey: ["moysklad-order-syncs", status],
    queryFn: () => sdk.client.fetch<{ order_syncs: OrderSync[] }>(
      `/admin/moysklad/order-syncs${status === "all" ? "" : `?status=${status}`}`
    ),
  })

  return (
    <div className="flex max-w-4xl flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Text size="large" leading="compact" weight="plus">
            Синхронизация заказов с МойСклад
          </Text>
        </div>
        <div className="px-6 py-4">
          <RadioGroup
            value={status}
            onValueChange={(value) => setStatus(value as SyncStatus)}
            className="flex flex-wrap gap-3"
          >
            <RadioGroup.ChoiceBox
              value="error"
              label="Ошибки"
              description="Требуют повторной синхронизации"
            />
            <RadioGroup.ChoiceBox
              value="pending"
              label="Ожидают"
              description="Ожидают отправки в МойСклад"
            />
            <RadioGroup.ChoiceBox
              value="syncing"
              label="Выполняются"
              description="Синхронизация выполняется"
            />
            <RadioGroup.ChoiceBox
              value="synced"
              label="Синхронизированы"
              description="Успешно отправлены в МойСклад"
            />
            <RadioGroup.ChoiceBox
              value="all"
              label="Все"
              description="Все последние синхронизации"
            />
          </RadioGroup>
        </div>
        <div className="flex flex-col gap-2 px-6 py-4">
          {syncsQuery.isPending ? (
            <Text size="small" className="text-ui-fg-subtle">
              Загрузка заказов…
            </Text>
          ) : syncsQuery.isError ? (
            <Text size="small" className="text-ui-fg-error">
              Не удалось загрузить статусы синхронизации.
            </Text>
          ) : syncsQuery.data?.order_syncs.length ? (
            <>
              <Text size="small" className="text-ui-fg-subtle">
                Показаны последние 50 синхронизаций.
              </Text>
              {syncsQuery.data.order_syncs.map((sync) => (
                <a
                  key={sync.id}
                  href={`/app/orders/${sync.order_id}`}
                  className="rounded-md bg-ui-bg-component px-4 py-3 hover:bg-ui-bg-component-hover"
                >
                  <div className="flex items-center justify-between gap-3">
                    <Text size="small" leading="compact" weight="plus">
                      Заказ {sync.order_id}
                    </Text>
                    <Badge color={colors[sync.status]}>{labels[sync.status]}</Badge>
                  </div>
                  <Text size="small" leading="compact" className="text-ui-fg-subtle">
                    Попыток: {sync.attempts}
                  </Text>
                  {sync.status === "error" && (
                    <Text size="small" leading="compact" className="text-ui-fg-error">
                      {sync.last_error || "Причина ошибки не сохранена"}
                    </Text>
                  )}
                </a>
              ))}
            </>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">
              Заказов с выбранным статусом нет.
            </Text>
          )}
        </div>
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({ label: "Синхронизация заказов", icon: ChatBubbleLeftRight })

export default MoyskladOrderSyncsPage
