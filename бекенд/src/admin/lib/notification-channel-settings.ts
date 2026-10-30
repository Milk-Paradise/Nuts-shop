export type SellerNotificationChannels = {
  email: string | null
  telegram: string | null
}

export function hasSellerNotificationChannel(
  seller?: SellerNotificationChannels
) {
  return Boolean(seller?.email || seller?.telegram)
}

export function notificationChannelErrorReason(
  error: unknown,
  fallback = "Не удалось проверить канал"
) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}

export function emailChannelDescription(configuration: {
  sender?: string
  sender_fallback?: string
}) {
  const sender = configuration.sender || (configuration.sender_fallback
    ? `${configuration.sender_fallback} (из настроек сервера)`
    : "Адрес отправителя не указан")
  return `${sender} · Имя отправителя — из профиля магазина в CMS`
}
