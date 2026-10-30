export type NotificationState =
  | "processing"
  | "completed"
  | "retry_pending"
  | "retries_exhausted"
  | "permanently_rejected"
  | "outcome_unknown"

export const NOTIFICATION_JOURNAL_API_PATH = "/admin/notification-journal"

export type NotificationAttempt = {
  id: string
  number: number
  attempted_at: string
  result: "success" | "temporary_failure" | "permanent_failure" | "unknown"
  reason: string | null
}

export type AdminNotification = {
  id: string
  type: string
  recipient: string
  channel: "email" | "telegram" | "sms" | "none"
  state: NotificationState
  reason: string | null
  template_key: string | null
  template_revision: string | null
  text_origin: "template" | "fallback"
  is_test: boolean
  created_at: string
  order_id: string | null
  order_display_id: string | null
  subject: string | null
  text: string | null
  attempts: NotificationAttempt[]
}

export type NotificationsResponse = {
  notifications: AdminNotification[]
  count: number
  limit: number
  offset: number
}

export const notificationStateLabels: Record<NotificationState, string> = {
  completed: "Выполнена",
  processing: "Выполняется",
  retry_pending: "Ожидает повтора",
  retries_exhausted: "Исчерпала повторы",
  outcome_unknown: "Результат неизвестен",
  permanently_rejected: "Отклонена окончательно",
}

export const notificationStateColors: Record<
  NotificationState,
  "green" | "blue" | "orange" | "red"
> = {
  completed: "green",
  processing: "blue",
  retry_pending: "orange",
  retries_exhausted: "red",
  outcome_unknown: "orange",
  permanently_rejected: "red",
}

export const channelLabels: Record<AdminNotification["channel"], string> = {
  email: "Почта",
  telegram: "Telegram",
  sms: "SMS",
  none: "без канала",
}

export const notificationAttemptResultLabels: Record<
  NotificationAttempt["result"],
  string
> = {
  success: "успех",
  temporary_failure: "временная ошибка",
  permanent_failure: "окончательная",
  unknown: "результат неизвестен",
}

export const typeLabels: Record<string, string> = {
  "order-confirmation": "Подтверждение заказа",
  "order-payment-confirmed": "Подтверждение оплаты",
  "customer-password-reset": "Сброс пароля",
  "shipping-return-status": "Возврат",
  "abandoned-cart-reminder": "Напоминание о корзине",
  "seller-new-order": "Новый заказ — продавцу",
  "seller-return-request": "Заявка на возврат — продавцу",
}

export function notificationTypeLabel(type: string) {
  return typeLabels[type] ?? type
}

export function orderLabel(notification: AdminNotification) {
  if (!notification.order_id) return null
  return `Заказ № ${notification.order_display_id ?? notification.order_id}`
}

export function formatNotificationDate(value: string) {
  const date = new Date(value)
  return {
    date: new Intl.DateTimeFormat("ru-RU").format(date),
    time: new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date),
  }
}
