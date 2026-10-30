import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { abandonedCartUnsubscribeUrl, checkoutResumeUrl } from "../lib/abandoned-cart-links"
import { ABANDONED_CART_REMINDER_MODULE } from "../modules/abandoned-cart-reminder"
import type AbandonedCartReminderModuleService from "../modules/abandoned-cart-reminder/service"

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

// Marker the storefront sets when it creates a quick purchase ("купить в 1 клик").
// It lives on the cart because this job is the one that has to tell the two
// apart, and the browser that created it is long gone by then.
export const ONE_CLICK_CART_METADATA_KEY = "one_click"

export type CandidateCart = {
  id: string
  customer_id: string | null
  customer: {
    id: string
    email: string | null
    has_account: boolean | null
    metadata: Record<string, unknown> | null
  } | null
  updated_at: string
  metadata: Record<string, unknown> | null
  items: { id: string }[] | null
}

export function isOneClickCart(cart: Pick<CandidateCart, "metadata">) {
  return cart.metadata?.[ONE_CLICK_CART_METADATA_KEY] === true
}

export type ExistingReminder = {
  cart_updated_at_at_send: Date | string
}

type QueryGraph = {
  graph(input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }): Promise<{ data: Record<string, unknown>[] }>
}

function isOptedOut(customer: CandidateCart["customer"]) {
  return customer?.metadata?.abandoned_cart_reminders_opt_out === true
}

// Exported for unit-testing the eligibility rules directly (no DB/time-travel
// needed): a cart qualifies once per continuous inactivity window — never
// reminded yet, or modified again since the last reminder — as long as it's
// been quiet for at least `SEVEN_DAYS_MS` as of `nowMs`.
export function isDueForReminder(
  cart: CandidateCart,
  existing: ExistingReminder | undefined,
  nowMs: number
): boolean {
  // Reminders are for registered customers only (spec.md Ф5 / edge case "гостевая
  // сессия") — a guest checkout also gets a linked Customer row with an email,
  // just has_account: false, so that alone can't stand in for "authenticated".
  if (!cart.customer_id || !cart.customer?.email || !cart.customer.has_account) return false
  if (!cart.items?.length) return false
  if (isOptedOut(cart.customer)) return false
  // A quick purchase is a single-item deal the customer never assembled, so
  // "вы забыли товары в корзине" would be about something that was never a cart.
  if (isOneClickCart(cart)) return false

  const cutoff = nowMs - SEVEN_DAYS_MS
  if (new Date(cart.updated_at).getTime() > cutoff) return false

  if (!existing) return true

  // Already reminded, and the cart hasn't been touched since — this is
  // still the same inactivity window, sending again would duplicate.
  return new Date(cart.updated_at).getTime() > new Date(existing.cart_updated_at_at_send).getTime()
}

// Bookkeeping ("already reminded this inactivity window") lives in its own
// module table (see AbandonedCartReminder), keyed by cart_id — writing it
// onto the cart itself would bump the cart's own updated_at as a side
// effect, which would then look like fresh customer activity to the very
// check that's supposed to detect inactivity.
export default async function abandonedCartReminderJob(container: MedusaContainer) {
  if (process.env.E2E_RUN === "true") return
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
  const reminderService = container.resolve(
    ABANDONED_CART_REMINDER_MODULE
  ) as AbandonedCartReminderModuleService
  const notificationService = container.resolve(Modules.NOTIFICATION)
  const logger = container.resolve("logger")

  const now = Date.now()

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "customer_id",
      "customer.id",
      "customer.email",
      "customer.has_account",
      "customer.metadata",
      "updated_at",
      "metadata",
      "items.id",
    ],
    filters: { completed_at: null },
  })

  // Roughly narrows the candidate set before the per-cart reminder lookup;
  // isDueForReminder() re-checks everything (including the reminder-specific
  // "modified since last send" rule) once existing reminders are loaded below.
  const roughCandidates = (carts as CandidateCart[]).filter(
    (cart) =>
      cart.customer_id &&
      cart.customer?.email &&
      cart.customer.has_account &&
      cart.items?.length &&
      !isOneClickCart(cart)
  )

  if (!roughCandidates.length) return

  const reminders = await reminderService.listAbandonedCartReminders({
    cart_id: roughCandidates.map((cart) => cart.id),
  })
  const reminderByCartId = new Map(reminders.map((reminder) => [reminder.cart_id, reminder]))

  for (const cart of roughCandidates) {
    const existing = reminderByCartId.get(cart.id)

    if (!isDueForReminder(cart, existing, now)) continue

    const cartUpdatedAt = new Date(cart.updated_at)

    const checkoutUrl = checkoutResumeUrl(cart.id)
    const unsubscribeUrl = abandonedCartUnsubscribeUrl(cart.customer!.id)

    try {
      await notificationService.createNotifications({
        to: cart.customer!.email as string,
        channel: "email",
        template: "abandoned-cart-reminder",
        data: { cart_id: cart.id, customer_id: cart.customer!.id },
        content: {
          subject: "Вы забыли товары в корзине",
          text: `Здравствуйте! В вашей корзине остались товары, которые ждут оформления.\n\nПерейти к оформлению: ${checkoutUrl}\n\nЕсли вы не хотите получать такие напоминания в будущем, перейдите по ссылке: ${unsubscribeUrl}`,
          html: `<p>Здравствуйте! В вашей корзине остались товары, которые ждут оформления.</p><p><a href="${checkoutUrl}">Перейти к оформлению</a></p><p>Если вы не хотите получать такие напоминания в будущем, <a href="${unsubscribeUrl}">отпишитесь здесь</a>.</p>`,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Failed to send abandoned-cart reminder for cart '${cart.id}': ${message}`)
      continue
    }

    // Recording the send must not be allowed to throw past this point — the
    // email already went out, so failing to persist that here would make the
    // next run see no reminder for this cart and send a duplicate.
    try {
      if (existing) {
        await reminderService.updateAbandonedCartReminders({
          selector: { id: existing.id },
          data: { sent_at: new Date(), cart_updated_at_at_send: cartUpdatedAt },
        })
      } else {
        await reminderService.createAbandonedCartReminders({
          cart_id: cart.id,
          sent_at: new Date(),
          cart_updated_at_at_send: cartUpdatedAt,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(
        `Sent abandoned-cart reminder for cart '${cart.id}' but failed to record it — next run may re-send: ${message}`
      )
    }
  }
}

export const config = {
  name: "abandoned-cart-reminder",
  schedule: "0 3 * * *",
}
