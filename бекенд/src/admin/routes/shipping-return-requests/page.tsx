import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowUturnLeft, CheckCircle, XCircle } from "@medusajs/icons"
import { Button, Container, Heading, Skeleton, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { sdk } from "../../lib/sdk"

type ReturnRequest = {
  id: string
  order_id: string
  provider_key: string
  reason: string | null
  created_at: string
}

const QUERY_KEY = ["shipping-return-requests"] as const

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Не удалось обработать заявку на возврат"
}

const ShippingReturnRequestsPage = () => {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => sdk.client.fetch<{ return_requests: ReturnRequest[] }>(
      "/admin/shipping-return-requests"
    ),
  })
  const resolve = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) =>
      sdk.client.fetch<{ return_request: ReturnRequest }>(`/admin/shipping-return-requests/${id}`, {
        method: "POST",
        body: { decision },
      }),
    onSuccess: async (response, variables) => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success(
        variables.decision === "approve"
          ? response.return_request.provider_key === "store_pickup"
            ? "Возврат подтверждён"
            : "Возврат подтверждён, обратная отправка создана"
          : "Заявка отклонена, прежний статус доставки восстановлен"
      )
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Заявки на возврат</Heading>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Ожидающие решения заявки покупателей
        </Text>
      </div>
      {query.isLoading ? (
        <div className="flex flex-col gap-3 px-6 py-4">
          {[0, 1, 2].map((item) => <Skeleton key={item} className="h-16" />)}
        </div>
      ) : query.isError ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-error">
            Не удалось загрузить заявки. Обновите страницу и повторите попытку.
          </Text>
        </div>
      ) : !query.data?.return_requests.length ? (
        <div className="px-6 py-4">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Нет заявок, ожидающих подтверждения.
          </Text>
        </div>
      ) : (
        <div className="divide-y">
          {query.data.return_requests.map((request) => {
            const pending = resolve.isPending && resolve.variables?.id === request.id
            return (
              <div key={request.id} className="flex items-center justify-between gap-4 px-6 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <ArrowUturnLeft className="text-ui-fg-subtle" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <Text size="small" leading="compact" weight="plus">
                      Заказ {request.order_id}
                    </Text>
                    <Text size="small" leading="compact" className="text-ui-fg-subtle">
                      {request.reason ?? "Причина не указана"} · {new Date(request.created_at).toLocaleString("ru-RU")}
                    </Text>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={resolve.isPending}
                    isLoading={pending && resolve.variables?.decision === "reject"}
                    onClick={() => resolve.mutate({ id: request.id, decision: "reject" })}
                  >
                    <XCircle /> Отклонить
                  </Button>
                  <Button
                    size="small"
                    disabled={resolve.isPending}
                    isLoading={pending && resolve.variables?.decision === "approve"}
                    onClick={() => resolve.mutate({ id: request.id, decision: "approve" })}
                  >
                    <CheckCircle /> Подтвердить
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Возвраты",
  icon: ArrowUturnLeft,
})

export default ShippingReturnRequestsPage
