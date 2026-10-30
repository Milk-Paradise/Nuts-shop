import {
  acquireLockStep,
  addOrderTransactionStep,
  createOrdersStep,
  createRemoteLinkStep,
  emitEventStep,
  releaseLockStep,
} from "@medusajs/medusa/core-flows"
import {
  EventPriority,
  Modules,
  OrderWorkflowEvents,
} from "@medusajs/framework/utils"
import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { checkCatalogPaymentStatusStep } from "./steps/check-catalog-payment-status"
import { noteCapturedPaymentWithoutOrderStep } from "./steps/note-captured-payment-without-order"
import { prepareCatalogPaidOrderStep } from "./steps/prepare-catalog-paid-order"
import { registerCatalogPromotionUsageStep } from "./steps/register-catalog-promotion-usage"
import { resolveCatalogPaymentCartStep } from "./steps/resolve-catalog-payment-cart"
import { reflectCompletedCatalogPaymentOperationForOrderStep } from "./steps/reflect-catalog-payment-operation"
import { transferCatalogCartReservationsStep } from "./steps/transfer-catalog-cart-reservations"
import { updateCatalogCartByVersionStep } from "./steps/update-catalog-cart-by-version"

export type FinalizeCatalogOnlinePaymentInput = {
  cart_id?: string
  payment_session_id?: string
  /**
   * Сколько секунд ждать освобождения лока на корзину.
   *
   * Витрина опрашивает статус каждые две секунды, а обработка держит лок
   * дольше одного опроса — с ожиданием по умолчанию запросы копились бы в
   * очереди по тридцать секунд каждый. Опрос передаёт 0 и на занятой корзине
   * сразу получает отказ, который роут превращает в честный «pending».
   *
   * Вебхук платёжной системы, наоборот, ждёт: для него отказ означал бы
   * потерянное подтверждение оплаты.
   */
  lock_timeout?: number
  external_event_key?: string
}

export type FinalizeCatalogOnlinePaymentOutput = {
  status: "pending" | "failed" | "succeeded"
  order_id: string | null
}

const THIRTY_SECONDS = 30
const TWO_MINUTES = 2 * 60
const THREE_DAYS = 3 * 24 * 60 * 60

export const finalizeCatalogOnlinePaymentWorkflow = createWorkflow(
  {
    name: "finalize-catalog-online-payment",
    store: true,
    idempotent: false,
    retentionTime: THREE_DAYS,
  },
  function (input: FinalizeCatalogOnlinePaymentInput) {
    const resolved = resolveCatalogPaymentCartStep(input)

    acquireLockStep(
      transform({ input, resolved }, ({ input, resolved }) => ({
        key: resolved.cart_id,
        timeout: input.lock_timeout ?? THIRTY_SECONDS,
        ttl: TWO_MINUTES,
      }))
    )

    const preparation = prepareCatalogPaidOrderStep(
      transform({ input, resolved }, ({ input, resolved }) => ({
        cart_id: resolved.cart_id,
        payment_session_id: input.payment_session_id,
      }))
    )
    const checked = checkCatalogPaymentStatusStep(
      transform({ preparation, input }, ({ preparation, input }) => ({
        payment_session_id: preparation.payment_session_id as string,
        cart_id: preparation.cart_id,
        external_event_key: input.external_event_key,
      }))
    )
    const createdOrder = when(
      "create-order-for-captured-catalog-payment",
      { preparation, checked },
      ({ preparation, checked }) =>
        !preparation.order_id && checked?.status === "succeeded"
    ).then(() => {
      // Всё, что идёт ниже, выполняется по уже подтверждённой оплате. Если
      // хоть один шаг упадёт, компенсация откатит создание заказа — и деньги
      // окажутся списаны без заказа. Этот шаг ничего не делает на прямом
      // пути, но при откате оставляет в логах отдельное событие.
      noteCapturedPaymentWithoutOrderStep(
        transform({ preparation, checked }, ({ preparation, checked }) => ({
          cart_id: preparation.cart_id,
          payment_id: checked?.payment?.id ?? null,
        }))
      )

      const orders = createOrdersStep(
        transform({ preparation }, ({ preparation }) => [
          preparation.order_input!,
        ])
      )
      const order = transform({ orders }, ({ orders }) => orders[0])
      const transferredReservations = transferCatalogCartReservationsStep(
        transform({ preparation, order }, ({ preparation, order }) => ({
          expected: preparation.expected_reservations,
          order_items: (order.items ?? []).map((item) => ({
            id: item.id,
            metadata: item.metadata,
          })),
        }))
      )
      const links = createRemoteLinkStep(
        transform(
          { preparation, order, transferredReservations },
          ({ preparation, order }) => {
            const definitions: Record<string, Record<string, string>>[] = [
              {
                [Modules.ORDER]: { order_id: order.id },
                [Modules.CART]: { cart_id: preparation.cart_id },
              },
              {
                [Modules.ORDER]: { order_id: order.id },
                [Modules.PAYMENT]: {
                  payment_collection_id: preparation.payment_collection_id!,
                },
              },
            ]

            for (const promotionId of preparation.promotion_ids) {
              definitions.push({
                [Modules.ORDER]: { order_id: order.id },
                [Modules.PROMOTION]: { promotion_id: promotionId },
              })
            }

            return definitions
          }
        ) as never
      )
      const completedCart = updateCatalogCartByVersionStep(
        transform(
          { preparation, transferredReservations },
          ({ preparation }) => ({
            cart_id: preparation.cart_id,
            expected_version: preparation.cart_version!,
            data: { completed_at: new Date() },
          })
        )
      )
      const promotionUsage = registerCatalogPromotionUsageStep(
        transform(
          { preparation, transferredReservations },
          ({ preparation }) => preparation.promotion_usage
        )
      )
      const transactions = addOrderTransactionStep(
        transform(
          { checked, order, transferredReservations },
          ({ checked, order }) =>
            (checked.payment?.captures ?? []).map((capture) => ({
              order_id: order.id,
              amount: capture.amount,
              currency_code: checked.payment!.currency_code,
              reference: "capture",
              reference_id: capture.id,
            }))
        )
      )
      emitEventStep(
        transform(
          { order, links, completedCart, promotionUsage, transactions },
          ({ order }) => ({
            eventName: OrderWorkflowEvents.PLACED,
            data: { id: order.id },
            options: { priority: EventPriority.CRITICAL },
          })
        )
      )

      return order
    })

    const existingOrderTransactions = when(
      "record-captured-catalog-payment-transactions-for-existing-order",
      { preparation, checked, createdOrder },
      ({ preparation, checked, createdOrder }) =>
        checked.status === "succeeded" &&
        Boolean(preparation.order_id) &&
        !createdOrder?.id
    ).then(() =>
      addOrderTransactionStep(
        transform(
          { preparation, checked, createdOrder },
          ({ preparation, checked, createdOrder }) =>
            (checked.payment?.captures ?? []).map((capture) => ({
              order_id: preparation.order_id as string,
              amount: capture.amount,
              currency_code: checked.payment!.currency_code,
              reference: "capture",
              reference_id: capture.id,
            }))
        )
      ).config({ name: "add-existing-catalog-order-payment-transactions" })
    )

    const reflected = when(
      "reflect-completed-catalog-payment-operation",
      { preparation, checked, createdOrder, existingOrderTransactions },
      ({ preparation, checked, createdOrder }) =>
        checked.status === "succeeded" &&
        !!(preparation.order_id ?? createdOrder?.id)
    ).then(() =>
      reflectCompletedCatalogPaymentOperationForOrderStep(
        transform(
          { preparation, createdOrder, existingOrderTransactions },
          ({ preparation, createdOrder }) => ({
            cart_id: preparation.cart_id,
            order_id: (preparation.order_id ?? createdOrder!.id) as string,
          })
        )
      )
    )
    const releaseKey = transform(
      { resolved, preparation, checked, createdOrder, existingOrderTransactions, reflected },
      ({ resolved }) => resolved.cart_id
    )
    releaseLockStep({ key: releaseKey })

    const output = transform(
      { preparation, checked, createdOrder, existingOrderTransactions, reflected },
      ({ preparation, checked, createdOrder }) => {
        const orderId = preparation.order_id ?? createdOrder?.id ?? null

        if (orderId && checked.status === "succeeded") {
          return {
            status: "succeeded",
            order_id: orderId,
          } satisfies FinalizeCatalogOnlinePaymentOutput
        }

        return {
          status: checked.status,
          order_id: orderId,
        } satisfies FinalizeCatalogOnlinePaymentOutput
      }
    )

    return new WorkflowResponse(output)
  }
)
