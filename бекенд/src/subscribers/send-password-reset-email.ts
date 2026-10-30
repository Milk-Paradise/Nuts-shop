import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { AuthWorkflowEvents, Modules } from "@medusajs/framework/utils"

type PasswordResetEventPayload = {
  entity_id: string
  actor_type: string
  token: string
}

function resetPasswordUrl(email: string, token: string) {
  const base = process.env.STOREFRONT_URL ?? "http://localhost:8000"

  const url = new URL("/reset-password", base)
  url.searchParams.set("token", token)
  url.searchParams.set("email", email)

  return url.toString()
}

// generateResetPasswordTokenWorkflow (core-flows) only emits this event —
// it deliberately doesn't send anything itself (see the event's own doc
// comment: "listen to this event to send a reset password email"). Fires
// for both customer and admin-user resets (actor-type-agnostic route), so
// this only acts on "customer".
export default async function sendPasswordResetEmail({
  event,
  container,
}: SubscriberArgs<PasswordResetEventPayload>) {
  const logger = container.resolve("logger")
  const { entity_id: email, actor_type: actorType, token } = event.data

  if (actorType !== "customer") {
    return
  }

  try {
    const notificationModuleService = container.resolve(Modules.NOTIFICATION)

    await notificationModuleService.createNotifications({
      to: email,
      channel: "email",
      template: "customer-password-reset",
      data: { email, token },
      content: {
        subject: "Восстановление пароля",
        text: `Для сброса пароля перейдите по ссылке: ${resetPasswordUrl(email, token)}\n\nСсылка действительна 15 минут. Если вы не запрашивали сброс пароля, проигнорируйте это письмо.`,
        html: `<p>Для восстановления пароля перейдите по ссылке:</p><p><a href="${resetPasswordUrl(email, token)}">Восстановить пароль</a></p><p>Ссылка действительна 15 минут. Если вы не запрашивали сброс пароля, проигнорируйте это письмо.</p>`,
      },
    })
  } catch (error) {
    // A failed reset email must not crash the event-bus job or retry-loop —
    // the customer can always request a new reset link.
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to send password reset email to '${email}': ${message}`)
  }
}

export const config: SubscriberConfig = {
  event: AuthWorkflowEvents.PASSWORD_RESET,
  context: {
    subscriberId: "send-password-reset-email",
  },
}
