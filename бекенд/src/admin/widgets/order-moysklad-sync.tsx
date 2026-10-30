import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge, Button, Container, Text, toast } from "@medusajs/ui"

import { sdk } from "../lib/sdk"

type OrderWidgetProps = { data?: { id: string } }
type SyncStatus = "pending" | "syncing" | "synced" | "error" | null
type RetryTarget = "order" | "payment" | "cancellation"
type MoyskladOrderSync = {
  status: SyncStatus
  moysklad_order_id: string | null
  last_error: string | null
  attempts: number
  cancellation_status: SyncStatus
  cancellation_last_error: string | null
  cancellation_attempts: number
  payment_status: SyncStatus
  payment_last_error: string | null
  payment_attempts: number
  moysklad_payment_id: string | null
}

const statusLabel: Record<Exclude<SyncStatus, null>, string> = {
  pending: "Ожидает",
  syncing: "Выполняется",
  synced: "Синхронизировано",
  error: "Ошибка синхронизации",
}

const paymentStatusLabel: Record<Exclude<SyncStatus, null>, string> = {
  // "Ожидает" here usually means the integration was switched off when the
  // order was paid. That is a queue, not a failure — showing it as an error
  // would send an administrator chasing a problem that does not exist.
  pending: "Ожидает передачи",
  syncing: "Передаётся",
  synced: "Платёж передан",
  error: "Ошибка передачи платежа",
}

const cancellationStatusLabel: Record<Exclude<SyncStatus, null>, string> = {
  pending: "Ожидает отправки",
  syncing: "Отправляется",
  synced: "Отмена отправлена",
  error: "Ошибка отправки отмены",
}

function badgeColor(status: SyncStatus) {
  if (status === "error") return "red" as const
  if (status === "synced") return "green" as const
  if (status === "pending" || status === "syncing") return "orange" as const
  return "grey" as const
}

function moyskladOrderUrl(id: string) {
  return `https://online.moysklad.ru/app/#customerorder/edit?id=${encodeURIComponent(id)}`
}

function moyskladPaymentUrl(id: string) {
  return `https://online.moysklad.ru/app/#paymentin/edit?id=${encodeURIComponent(id)}`
}

type SectionProps = {
  title: string
  status: SyncStatus
  label: string
  lastError: string | null
  attempts: number
  link?: { href: string; text: string } | null
  onRetry?: () => void
  retrying?: boolean
  emptyLabel: string
}

function SyncSection({
  title,
  status,
  label,
  lastError,
  attempts,
  link,
  onRetry,
  retrying,
  emptyLabel,
}: SectionProps) {
  return (
    <div className="flex flex-col gap-2 border-t px-6 py-4 first:border-t-0">
      <div className="flex items-center gap-2">
        <Text size="small" leading="compact">{title}</Text>
        <Badge color={badgeColor(status)}>{status ? label : emptyLabel}</Badge>
        {attempts > 0 && (
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            попыток: {attempts}
          </Text>
        )}
      </div>

      {link && (
        <a className="text-ui-fg-interactive" href={link.href} target="_blank" rel="noreferrer">
          <Text size="small" leading="compact">{link.text}</Text>
        </a>
      )}

      {/* The reason is shown whenever one was recorded, not only while the
          transfer is still failing: after a successful retry it explains why
          the attempt count is above zero. */}
      {lastError && (
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {lastError}
        </Text>
      )}

      {status === "error" && onRetry && (
        <div>
          <Button size="small" variant="secondary" onClick={onRetry} isLoading={retrying} disabled={retrying}>
            Повторить вручную
          </Button>
        </div>
      )}
    </div>
  )
}

const OrderMoyskladSyncWidget = ({ data: order }: OrderWidgetProps) => {
  const queryClient = useQueryClient()
  const orderId = order?.id ?? ""
  const queryKey = ["moysklad-order-sync", orderId]
  const syncQuery = useQuery({
    queryKey,
    queryFn: () => sdk.client.fetch<MoyskladOrderSync>(`/admin/orders/${orderId}/moysklad-sync`),
    enabled: Boolean(orderId),
  })
  // The target travels with the request so a retry acts on the transfer whose
  // button was pressed. Without it the server falls back to a fixed priority
  // order and could retry the payment when the order button was pressed.
  const retry = useMutation({
    mutationFn: (target: RetryTarget) =>
      sdk.client.fetch<MoyskladOrderSync>(`/admin/orders/${orderId}/moysklad-sync`, {
        method: "POST",
        body: { target },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      toast.success("Повторная передача в МойСклад запущена")
    },
    onError: () => toast.error("Не удалось запустить повторную передачу"),
  })
  const retryingTarget = retry.isPending ? retry.variables : undefined

  if (!orderId || syncQuery.isError) return null

  const data = syncQuery.data
  const paymentStatus = data?.payment_status ?? null
  const cancellationStatus = data?.cancellation_status ?? null

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Text size="small" leading="compact" weight="plus">МойСклад</Text>
      </div>

      {syncQuery.isPending ? (
        <div className="px-6 py-4">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Загрузка статуса…
          </Text>
        </div>
      ) : (
        <div>
          <SyncSection
            title="Заказ"
            status={data?.status ?? null}
            label={data?.status ? statusLabel[data.status] : ""}
            emptyLabel="Не отправлен"
            lastError={data?.last_error ?? null}
            attempts={data?.attempts ?? 0}
            link={
              data?.status === "synced" && data.moysklad_order_id
                ? { href: moyskladOrderUrl(data.moysklad_order_id), text: "Открыть заказ в МойСклад" }
                : null
            }
            onRetry={() => retry.mutate("order")}
            retrying={retryingTarget === "order"}
          />

          {paymentStatus && (
            <SyncSection
              title="Платёж"
              status={paymentStatus}
              label={paymentStatusLabel[paymentStatus]}
              emptyLabel="Не передавался"
              lastError={data?.payment_last_error ?? null}
              attempts={data?.payment_attempts ?? 0}
              link={
                paymentStatus === "synced" && data?.moysklad_payment_id
                  ? { href: moyskladPaymentUrl(data.moysklad_payment_id), text: "Открыть платёж в МойСклад" }
                  : null
              }
              onRetry={() => retry.mutate("payment")}
              retrying={retryingTarget === "payment"}
            />
          )}

          {cancellationStatus && (
            <SyncSection
              title="Отмена"
              status={cancellationStatus}
              label={cancellationStatusLabel[cancellationStatus]}
              emptyLabel="Не отправлялась"
              lastError={data?.cancellation_last_error ?? null}
              attempts={data?.cancellation_attempts ?? 0}
              onRetry={() => retry.mutate("cancellation")}
              retrying={retryingTarget === "cancellation"}
            />
          )}
        </div>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({ zone: "order.details.side.after", id: "auto-paint-store:order-moysklad-sync" })

export default OrderMoyskladSyncWidget
