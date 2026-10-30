import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import { sdk } from "../lib/sdk"

type OrderWithMetadata = {
  id: string
  metadata?: Record<string, unknown> | null
}

type OrderCheckoutDetailsWidgetProps = {
  data?: OrderWithMetadata
}

type DetailRow = {
  label: string
  value: string | null
}

function metadataText(
  metadata: Record<string, unknown> | null | undefined,
  key: string
) {
  const value = metadata?.[key]

  if (typeof value === "string") {
    const trimmed = value.trim()

    return trimmed.length ? trimmed : null
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

function joinParts(parts: Array<string | null>) {
  const value = parts.filter(Boolean).join(", ")

  return value.length ? value : null
}

function DetailValue({ label, value }: DetailRow) {
  if (!value) {
    return null
  }

  return (
    <div className="flex flex-col gap-y-1">
      <Text size="small" leading="compact" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text size="small" leading="compact" weight="plus">
        {value}
      </Text>
    </div>
  )
}

const OrderCheckoutDetailsWidget = ({
  data: order,
}: OrderCheckoutDetailsWidgetProps) => {
  const metadata = order?.metadata
  const name = metadataText(metadata, "checkout_contact_name")
  const phone = metadataText(metadata, "checkout_contact_phone")
  const city = metadataText(metadata, "checkout_address_city")
  const street = metadataText(metadata, "checkout_address_street")
  const house = metadataText(metadata, "checkout_address_house")
  const apartment = metadataText(metadata, "checkout_address_apartment")
  const comment = metadataText(metadata, "checkout_comment")
  const pickupAddress = metadataText(metadata, "store_pickup_address")
  const pickupHours = metadataText(metadata, "store_pickup_hours")
  const isStorePickup = metadata?.store_pickup === true && !!pickupAddress
  const [collectedAt, setCollectedAt] = useState(
    metadataText(metadata, "store_pickup_collected_at")
  )
  const collect = useMutation({
    mutationFn: () =>
      sdk.client.fetch<{
        store_pickup: { collected_at: string }
      }>(`/admin/orders/${order?.id}/store-pickup/complete`, {
        method: "POST",
      }),
    onSuccess: (response) => {
      setCollectedAt(response.store_pickup.collected_at)
      toast.success("Заказ отмечен как выданный")
    },
    onError: (error: Error) =>
      toast.error(error.message || "Не удалось отметить заказ как выданный"),
  })
  const streetAddress = joinParts([
    street,
    house ? `дом ${house}` : null,
    apartment ? `кв./офис ${apartment}` : null,
  ])

  const rows: DetailRow[] = [
    { label: "Покупатель", value: name },
    { label: "Телефон", value: phone },
    { label: isStorePickup ? "Способ получения" : "Город", value: isStorePickup ? "Самовывоз" : city },
    { label: "Адрес", value: isStorePickup ? pickupAddress : streetAddress },
    { label: "Часы работы", value: isStorePickup ? pickupHours : null },
    { label: "Статус самовывоза", value: isStorePickup ? (collectedAt ? "Выдан" : "Ожидает выдачи") : null },
    { label: "Комментарий", value: comment },
  ]
  const visibleRows = rows.filter((row) => row.value)

  if (!visibleRows.length) {
    return null
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Данные оформления</Heading>
      </div>
      <div className="flex flex-col gap-4 px-6 py-4">
        {visibleRows.map((row) => (
          <DetailValue key={row.label} {...row} />
        ))}
        {isStorePickup && !collectedAt ? (
          <div>
            <Button
              size="small"
              variant="secondary"
              isLoading={collect.isPending}
              disabled={collect.isPending}
              onClick={() => collect.mutate()}
            >
              Отметить как выданный
            </Button>
          </div>
        ) : null}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
  id: "auto-paint-store:order-checkout-details",
})

export default OrderCheckoutDetailsWidget
