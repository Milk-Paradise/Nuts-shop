import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { sdk } from "../lib/sdk"

type Order = { id: string }
type Shipment = {
  status: "creating" | "created" | "failed"
  tracking_number: string | null
  error_message: string | null
  updated_at: string
}
type RetryResult =
  | { status: "created" }
  | { status: "skipped"; reason: "not_cdek" | "already_fulfilled" | "no_items" }
  | { status: "failed"; error: string }

const shipmentQueryKey = (orderId: string) => ["cdek-fulfillment", orderId] as const

const OrderCdekFulfillmentErrorWidget = ({ data: order }: { data?: Order }) => {
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: shipmentQueryKey(order?.id ?? ""),
    queryFn: () => sdk.client.fetch<{ shipment: Shipment | null }>(
      `/admin/orders/${order?.id}/cdek-fulfillment`
    ),
    enabled: !!order?.id,
  })
  const retry = useMutation({
    mutationFn: () => sdk.client.fetch<{ result: RetryResult }>(
      `/admin/orders/${order?.id}/cdek-fulfillment/retry`,
      { method: "POST" }
    ),
    onSuccess: async ({ result }) => {
      if (result.status === "created" ||
        (result.status === "skipped" && result.reason === "already_fulfilled")) {
        toast.success("Отправка СДЭК создана")
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: shipmentQueryKey(order?.id ?? "") }),
          queryClient.invalidateQueries({ queryKey: ["order", order?.id] }),
          queryClient.invalidateQueries({ queryKey: ["orders"] }),
        ])
        return
      }
      toast.error(result.status === "failed" ? result.error : "Не удалось создать отправку СДЭК")
      await queryClient.invalidateQueries({ queryKey: shipmentQueryKey(order?.id ?? "") })
    },
    onError: () => toast.error("Не удалось создать отправку СДЭК"),
  })

  const shipment = status.data?.shipment
  if (!shipment || shipment.status !== "failed") return null

  return (
    <Container className="flex flex-col gap-y-3 p-6">
      <Text size="small" leading="compact" weight="plus" className="text-ui-fg-error">
        Не удалось автоматически создать отправку СДЭК
      </Text>
      <Text size="small" leading="compact" className="text-ui-fg-subtle">
        {shipment.error_message ?? "СДЭК временно недоступен"}
      </Text>
      <Button
        size="small"
        variant="secondary"
        disabled={retry.isPending}
        onClick={() => retry.mutate()}
        className="self-start"
      >
        Повторить попытку
      </Button>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
  id: "auto-paint-store:order-cdek-fulfillment-error",
})

export default OrderCdekFulfillmentErrorWidget
