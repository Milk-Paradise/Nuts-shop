import { useState } from "react"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container, Text, toast } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"

import { sdk } from "../lib/sdk"

const CDEK_PROVIDER_KEY = "cdek_cdek"

type Order = {
  id: string
  fulfillments?: Array<{ provider_id?: string | null }> | null
}

type LabelResult =
  | { status: "ready" }
  | { status: "not_ready"; message: string }
  | { status: "skipped"; reason: "shipment_not_created" }
  | { status: "failed"; error: string }

const OrderCdekFulfillmentLabelWidget = ({ data: order }: { data?: Order }) => {
  const [message, setMessage] = useState<string | null>(null)
  const hasCdekFulfillment = (order?.fulfillments ?? []).some(
    (fulfillment) => fulfillment.provider_id === CDEK_PROVIDER_KEY
  )
  const label = useMutation({
    mutationFn: () => sdk.client.fetch<{ result: LabelResult }>(
      `/admin/orders/${order?.id}/cdek-fulfillment/label`,
      { method: "POST" }
    ),
    onSuccess: ({ result }) => {
      if (result.status === "ready") {
        setMessage(null)
        window.open(
          `/admin/orders/${order?.id}/cdek-fulfillment/label/file`,
          "_blank",
          "noopener,noreferrer"
        )
        return
      }
      const text = result.status === "not_ready"
        ? result.message
        : result.status === "failed"
          ? result.error
          : "Сначала создайте отправку СДЭК."
      setMessage(text)
      toast.info(text)
    },
    onError: () => {
      setMessage("Не удалось получить этикетку СДЭК.")
      toast.error("Не удалось получить этикетку СДЭК")
    },
  })

  if (!hasCdekFulfillment) return null

  return (
    <Container className="flex flex-col gap-y-3 p-6">
      <Text size="small" leading="compact" weight="plus">Этикетка СДЭК</Text>
      <Button
        size="small"
        variant="secondary"
        disabled={label.isPending}
        isLoading={label.isPending}
        onClick={() => label.mutate()}
        className="self-start"
      >
        Получить этикетку
      </Button>
      {message ? (
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {message}
        </Text>
      ) : null}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
  id: "auto-paint-store:order-cdek-fulfillment-label",
})

export default OrderCdekFulfillmentLabelWidget
