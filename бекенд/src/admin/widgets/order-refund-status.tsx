import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Button, Container, Heading, Input, Label, Text, toast } from "@medusajs/ui"

import { sdk } from "../lib/sdk"

type OrderWithMetadata = {
  id: string
  metadata?: Record<string, unknown> | null
}

type RefundState = {
  status: "refunded" | "partial" | "error" | null
  error: string | null
  updated_at: string | null
}

type RefundResponse = { refund: RefundState }

function refundRequestStorageKey(orderId: string) {
  return `catalog-refund-request:${orderId}`
}

function storedRefundRequestId(orderId: string): string | null {
  const key = refundRequestStorageKey(orderId)
  try {
    const stored = window.localStorage.getItem(key)
    if (stored) return stored
    const requestId = crypto.randomUUID()
    window.localStorage.setItem(key, requestId)
    return requestId
  } catch {
    return null
  }
}

function saveRefundRequestId(orderId: string, requestId: string) {
  try {
    window.localStorage.setItem(refundRequestStorageKey(orderId), requestId)
    return true
  } catch {
    return false
  }
}

function initialRefundState(order: OrderWithMetadata): RefundResponse {
  const status = order.metadata?.catalog_refund_status
  const error = order.metadata?.catalog_refund_error
  const updatedAt = order.metadata?.catalog_refund_updated_at

  return {
    refund: {
      status:
        status === "refunded" || status === "partial" || status === "error"
          ? status
          : null,
      error: typeof error === "string" ? error : null,
      updated_at: typeof updatedAt === "string" ? updatedAt : null,
    },
  }
}

const OrderRefundStatusWidget = ({ data: order }: { data: OrderWithMetadata }) => {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState("")
  const [requestId, setRequestId] = useState(() => storedRefundRequestId(order.id))
  const queryKey = ["catalog-refund", order.id]
  const refundQuery = useQuery({
    queryKey,
    queryFn: () =>
      sdk.client.fetch<RefundResponse>(
        `/admin/orders/${order.id}/catalog-refund`
      ),
    initialData: initialRefundState(order),
  })
  const retryMutation = useMutation({
    mutationFn: () => {
      if (!requestId) {
        throw new Error("Не удалось сохранить ключ запроса возврата")
      }
      return sdk.client.fetch<RefundResponse>(
        `/admin/orders/${order.id}/catalog-refund`,
        {
          method: "POST",
          body: {
            confirm: true,
            request_id: requestId,
            ...(amount.trim() ? { amount: amount.trim() } : {}),
          },
        }
      )
    },
    onSuccess: async (response) => {
      queryClient.setQueryData(queryKey, response)
      await queryClient.invalidateQueries({ queryKey })

      if (response.refund.status === "refunded") {
        toast.success("Возврат успешно завершён")
        const nextRequestId = crypto.randomUUID()
        setRequestId(
          saveRefundRequestId(order.id, nextRequestId) ? nextRequestId : null
        )
      } else if (response.refund.status === "partial") {
        toast.success("Частичный возврат успешно завершён")
        const nextRequestId = crypto.randomUUID()
        setRequestId(
          saveRefundRequestId(order.id, nextRequestId) ? nextRequestId : null
        )
      } else {
        toast.error(response.refund.error ?? "Возврат снова завершился ошибкой")
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "Не удалось повторить возврат")
    },
  })
  const refund = refundQuery.data.refund

  const isError = refund.status === "error"

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Возврат оплаты</Heading>
        <Text
          size="small"
          leading="compact"
          weight="plus"
          className={isError ? "text-ui-fg-error" : "text-ui-fg-success"}
        >
          {isError
            ? "Ошибка возврата"
            : refund.status === "partial"
              ? "Возвращён частично"
              : refund.status === "refunded"
                ? "Возвращён"
                : "Возврат доступен"}
        </Text>
      </div>
      <div className="flex flex-col gap-3 px-6 py-4">
        {isError && (
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            {refund.error ?? "Провайдер не сообщил причину ошибки"}
          </Text>
        )}
        {(isError || refund.status === "partial" || refund.status === "refunded" || refund.status === null) && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="catalog-refund-amount">
              Сумма дополнительного возврата, RUB (необязательно)
            </Label>
            <Input
              id="catalog-refund-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="Пусто — вернуть весь оставшийся остаток"
              disabled={retryMutation.isPending || !requestId}
            />
          </div>
        )}
        {(isError || refund.status === "partial" || refund.status === "refunded" || refund.status === null) && (
          <div>
            <Button
              size="small"
              variant="secondary"
              isLoading={retryMutation.isPending}
              disabled={retryMutation.isPending || !requestId}
              onClick={() => {
                const description = amount.trim()
                  ? `Вернуть ${amount} RUB по заказу?`
                  : "Выполнить полный возврат по заказу?"
                if (window.confirm(description)) {
                  retryMutation.mutate()
                }
              }}
            >
              {isError
                ? "Повторить возврат"
                : refund.status === null
                  ? "Выполнить возврат"
                  : "Выполнить дополнительный возврат"}
            </Button>
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
  id: "auto-paint-store:order-refund-status",
})

export default OrderRefundStatusWidget
