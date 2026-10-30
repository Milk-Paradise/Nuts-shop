import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import {
  Button,
  Container,
  FocusModal,
  Heading,
  Input,
  Label,
  Skeleton,
  StatusBadge,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"

import type { TelegramWebhookStatus } from "../../../modules/notification-domain/channel-settings"

import { sdk } from "../../lib/sdk"
import {
  emailChannelDescription,
  hasSellerNotificationChannel,
  notificationChannelErrorReason,
} from "../../lib/notification-channel-settings"

type ChannelName = "email" | "telegram" | "sms"
type Channel = {
  id: string
  channel: ChannelName
  enabled: boolean
  configured: boolean
  daily_limit: number | null
  verified_at: string | null
  revoked_at: string | null
  sent_today?: number
  timezone?: string
  configuration: {
    webhook?: TelegramWebhookStatus
    sender_fallback?: string
    sender?: string
    bot_username?: string
    seller_recipient?: string
  }
}
type SellerChannels = {
  email: string | null
  telegram: string | null
  telegram_available: boolean
}
type ChannelForm = {
  emailFrom: string
  botToken: string
  botUsername: string
  webhookSecret: string
  smsLogin: string
  smsPassword: string
  smsSender: string
  dailyLimit: string
}

const CHANNELS_QUERY_KEY = ["notification-channels"] as const
const SELLER_QUERY_KEY = ["notification-seller-channels"] as const
const SECRET_HELP = "Сохранён и не показывается. Введите новое значение, чтобы заменить"

function messageFromError(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function ChannelsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((row) => <Skeleton key={row} className="h-20 w-full" />)}
    </div>
  )
}

function TelegramWebhookWarning({ webhook }: { webhook: TelegramWebhookStatus }) {
  if (webhook.status === "ok") return null
  const unknown = webhook.status === "unknown"
  const foreign = webhook.status === "foreign"
  return (
    <div className="mt-3 min-w-0 rounded-lg border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Text size="small" weight="plus">Вебхук бота</Text>
        <StatusBadge color={unknown ? "grey" : "orange"}>
          {unknown ? "Вебхук не проверен" : foreign ? "Вебхук на другом адресе" : "Вебхук не настроен"}
        </StatusBadge>
      </div>
      <Text size="small" className="mt-1 text-ui-fg-subtle">
        {unknown
          ? "Telegram не ответил. Реквизиты бота в порядке — вебхук проверится при следующей проверке."
          : foreign
            ? "Вебхук бота указывает на другой адрес — покупатели не смогут подключить Telegram."
            : "Вебхук бота не задан — покупатели нажмут «Старт», но Telegram не подключится."}
      </Text>
      {!unknown ? (
        <>
          <div className="mt-2 grid min-w-0 grid-cols-[64px_1fr] items-center gap-2">
            {foreign ? (
              <>
                <Text size="small" className="text-ui-fg-muted">Сейчас</Text>
                <Text size="small" className="min-w-0 break-all font-mono">{webhook.url}</Text>
              </>
            ) : null}
            <Text size="small" className="text-ui-fg-muted">Нужно</Text>
            <div className="flex min-w-0 items-center gap-2">
              <Text size="small" className="min-w-0 flex-1 break-all font-mono">{webhook.expected_url}</Text>
              <Button size="small" variant="secondary" className="shrink-0" onClick={async () => {
                try {
                  await navigator.clipboard.writeText(webhook.expected_url)
                  toast.success("Адрес скопирован")
                } catch {
                  toast.error("Не удалось скопировать адрес")
                }
              }}>Скопировать</Button>
            </div>
          </div>
          <Text size="small" className="mt-2 text-ui-fg-muted">
            Задайте вебхук с тем же секретом webhook, затем повторите проверку в «Настроить».
          </Text>
        </>
      ) : null}
    </div>
  )
}

function StoreChannelRow({
  channel,
  isUpdating,
  onToggle,
  onConfigure,
}: {
  channel: Channel
  isUpdating: boolean
  onToggle: (enabled: boolean) => void
  onConfigure: () => void
}) {
  const verified = Boolean(channel.verified_at && !channel.revoked_at)
  const sentToday = channel.sent_today ?? 0
  const limit = channel.daily_limit ?? 100
  const exhausted = channel.channel === "sms" && channel.enabled && sentToday >= limit
  const title = channel.channel === "email"
    ? "Почта"
    : channel.channel === "telegram"
      ? "Telegram-бот"
      : "SMS — SMSC.ru"
  const status = exhausted
    ? { label: "Лимит исчерпан", color: "orange" as const }
    : channel.enabled
      ? { label: "Работает", color: "green" as const }
      : { label: "Выключен", color: "grey" as const }

  let description = "Реквизиты ещё не настроены"
  if (channel.channel === "email") {
    description = emailChannelDescription(channel.configuration)
  } else if (channel.channel === "telegram" && channel.configured) {
    description = channel.configuration.bot_username
      ? `@${channel.configuration.bot_username.replace(/^@/, "")}`
      : `•••••••• · ${SECRET_HELP}`
  } else if (channel.channel === "sms") {
    description = exhausted
      ? `Лимит на сегодня исчерпан: ${sentToday} из ${limit}. SMS не отправляются до 00:00 по времени магазина; почта и Telegram работают.`
      : `Дневной лимит: ${limit} · Сегодня отправлено: ${sentToday} из ${limit} · по часовому поясу магазина`
  }

  return (
    <div className="min-w-0 px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Text size="small" leading="compact" weight="plus">{title}</Text>
            <StatusBadge color={status.color} className="whitespace-nowrap">{status.label}</StatusBadge>
          </div>
          <Text size="small" leading="compact" className="mt-1 text-ui-fg-subtle">{description}</Text>
          {channel.channel !== "email" && !verified ? (
            <Text size="small" leading="compact" className="mt-1 text-ui-fg-muted">
              Включение станет доступно после успешной проверки
            </Text>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {channel.channel === "email" ? (
            <Text size="small" leading="compact" className="text-ui-fg-muted">Всегда включена</Text>
          ) : null}
          <Switch
            checked={channel.channel === "email" ? true : channel.enabled}
            disabled={channel.channel === "email" || !verified || isUpdating}
            onCheckedChange={onToggle}
            aria-label={`${channel.enabled ? "Выключить" : "Включить"} ${title}`}
          />
          <Button size="small" variant="secondary" onClick={onConfigure}>Настроить</Button>
        </div>
      </div>
      {channel.channel === "telegram" && channel.configured && channel.configuration.webhook ? (
        <TelegramWebhookWarning webhook={channel.configuration.webhook} />
      ) : null}
    </div>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  secret = false,
  help,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  secret?: boolean
  help?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={secret ? "password" : "text"} value={value} onChange={(event) => onChange(event.target.value)} />
      {help ? <Text size="small" leading="compact" className="text-ui-fg-subtle">{help}</Text> : null}
    </div>
  )
}

function ChannelConfigurationModal({
  channel,
  onClose,
}: {
  channel: Channel | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<string | null>(null)
  const [form, setForm] = useState<ChannelForm>({
    emailFrom: "",
    botToken: "",
    botUsername: "",
    webhookSecret: "",
    smsLogin: "",
    smsPassword: "",
    smsSender: "",
    dailyLimit: "100",
  })

  useEffect(() => {
    if (!channel) return
    setFailure(null)
    setForm({
      emailFrom: channel.configuration.sender ?? "",
      botToken: "",
      botUsername: channel.configuration.bot_username ?? "",
      webhookSecret: "",
      smsLogin: "",
      smsPassword: "",
      smsSender: channel.configuration.sender ?? "",
      dailyLimit: String(channel.daily_limit ?? 100),
    })
  }, [channel])

  const save = useMutation({
    mutationFn: async () => {
      if (!channel) return
      if (channel.channel === "sms" && !form.smsLogin && !form.smsPassword) {
        return sdk.client.fetch("/admin/notification-channels/sms/limit", {
          method: "POST",
          body: { daily_limit: Number(form.dailyLimit) },
        })
      }
      const credentials = channel.channel === "email"
        ? { from: form.emailFrom.trim() }
        : channel.channel === "telegram"
          ? {
              bot_token: form.botToken,
              bot_username: form.botUsername.trim(),
              webhook_secret: form.webhookSecret,
            }
          : {
              login: form.smsLogin.trim(),
              password: form.smsPassword,
              sender: form.smsSender.trim() || undefined,
            }
      return sdk.client.fetch("/admin/notification-channels/configure", {
        method: "POST",
        body: {
          channel: channel.channel,
          credentials,
          ...(channel.channel === "sms" ? { daily_limit: Number(form.dailyLimit) } : {}),
        },
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY })
      toast.success("Канал проверен, настройки сохранены")
      onClose()
    },
    onError: (error) => setFailure(notificationChannelErrorReason(error)),
  })

  const title = channel?.channel === "email"
    ? "Настройка почты"
    : channel?.channel === "telegram"
      ? "Настройка Telegram-бота"
      : "Настройка SMS — SMSC.ru"
  const valid = channel?.channel === "email"
    ? Boolean(form.emailFrom.trim())
    : channel?.channel === "telegram"
      ? Boolean(form.botToken && form.botUsername.trim() && form.webhookSecret)
      : Boolean(Number.isInteger(Number(form.dailyLimit)) && Number(form.dailyLimit) >= 0 && ((!form.smsLogin && !form.smsPassword) || (form.smsLogin && form.smsPassword)))

  return (
    <FocusModal open={Boolean(channel)} onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex items-center gap-2">
            <Button size="small" variant="secondary" onClick={onClose} disabled={save.isPending}>Отмена</Button>
            <Button size="small" onClick={() => save.mutate()} disabled={!valid} isLoading={save.isPending}>Сохранить</Button>
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex-1 overflow-auto p-0">
          <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-8 py-8">
            <div>
              <Heading level="h2">{title}</Heading>
              <Text size="small" className="mt-1 text-ui-fg-subtle">
                Добавьте реквизиты и проверьте подключение перед включением канала.
              </Text>
            </div>
            {channel?.channel === "email" ? (
              <Field id="channel-email-from" label="Адрес отправителя" value={form.emailFrom} onChange={(emailFrom) => setForm((current) => ({ ...current, emailFrom }))} />
            ) : channel?.channel === "telegram" ? (
              <>
                <Field id="channel-bot-token" label="Токен бота" secret value={form.botToken} help={channel.configured ? SECRET_HELP : undefined} onChange={(botToken) => setForm((current) => ({ ...current, botToken }))} />
                <Field id="channel-bot-username" label="Имя бота" value={form.botUsername} onChange={(botUsername) => setForm((current) => ({ ...current, botUsername }))} />
                <Field id="channel-webhook-secret" label="Секрет webhook" secret value={form.webhookSecret} help={channel.configured ? SECRET_HELP : undefined} onChange={(webhookSecret) => setForm((current) => ({ ...current, webhookSecret }))} />
              </>
            ) : (
              <>
                <Field id="channel-sms-login" label="Логин SMSC.ru" value={form.smsLogin} help={channel?.configured ? SECRET_HELP : undefined} onChange={(smsLogin) => setForm((current) => ({ ...current, smsLogin }))} />
                <Field id="channel-sms-password" label="Пароль SMSC.ru" secret value={form.smsPassword} help={channel?.configured ? SECRET_HELP : undefined} onChange={(smsPassword) => setForm((current) => ({ ...current, smsPassword }))} />
                <Field id="channel-sms-sender" label="Имя отправителя" value={form.smsSender} onChange={(smsSender) => setForm((current) => ({ ...current, smsSender }))} />
                <Field id="channel-sms-limit" label="Дневной лимит" value={form.dailyLimit} onChange={(dailyLimit) => setForm((current) => ({ ...current, dailyLimit }))} />
              </>
            )}
            <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
              <div className="flex items-center gap-2">
                <Text size="small" weight="plus">Проверка подключения</Text>
                <StatusBadge color={failure ? "red" : save.isPending ? "orange" : channel?.verified_at ? "green" : "grey"} className="whitespace-nowrap">
                  {failure ? "Ошибка проверки" : save.isPending ? "Проверяем…" : channel?.verified_at ? "Работает" : "Не проверено"}
                </StatusBadge>
              </div>
              {failure ? (
                <>
                  <Text role="alert" size="small" className="mt-1 text-ui-fg-error">{failure}</Text>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <Text size="small" className="text-ui-fg-subtle">Действуют прежние реквизиты</Text>
                    <Button size="small" variant="secondary" onClick={() => save.mutate()} disabled={!valid}>
                      Проверить снова
                    </Button>
                  </div>
                </>
              ) : (
                <Text size="small" className="mt-1 text-ui-fg-subtle">Включение станет доступно после успешной проверки</Text>
              )}
            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

export function NotificationChannelsTab() {
  const queryClient = useQueryClient()
  const [configured, setConfigured] = useState<Channel | null>(null)
  const [sellerEmailOpen, setSellerEmailOpen] = useState(false)
  const [sellerEmail, setSellerEmail] = useState("")
  const channelsQuery = useQuery({
    queryKey: CHANNELS_QUERY_KEY,
    queryFn: () => sdk.client.fetch<{ channels: Channel[] }>("/admin/notification-channels"),
  })
  const sellerQuery = useQuery({
    queryKey: SELLER_QUERY_KEY,
    queryFn: () => sdk.client.fetch<{ seller: SellerChannels }>("/admin/notification-channels/seller"),
  })
  const channels = channelsQuery.data?.channels ?? []
  const seller = sellerQuery.data?.seller
  const telegram = useMemo(() => channels.find((channel) => channel.channel === "telegram"), [channels])

  useEffect(() => setSellerEmail(seller?.email ?? ""), [seller?.email])

  const toggle = useMutation({
    mutationFn: ({ channel, enabled }: { channel: ChannelName; enabled: boolean }) =>
      sdk.client.fetch(`/admin/notification-channels/${channel}/status`, { method: "POST", body: { enabled } }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY }),
    onError: (error) => toast.error(messageFromError(error, "Не удалось изменить статус канала")),
  })
  const saveSellerEmail = useMutation({
    mutationFn: () => sdk.client.fetch("/admin/notification-channels/seller", { method: "POST", body: { email: sellerEmail.trim() } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SELLER_QUERY_KEY })
      setSellerEmailOpen(false)
      toast.success("Почта продавца сохранена")
    },
    onError: (error) => toast.error(messageFromError(error, "Не удалось сохранить почту")),
  })
  const sellerTelegram = useMutation({
    mutationFn: () => sdk.client.fetch<{ telegram: { url: string } }>("/admin/notification-channels/seller/telegram", { method: "POST" }),
    onSuccess: ({ telegram: result }) => window.open(result.url, "_blank", "noopener,noreferrer"),
    onError: (error) => toast.error(messageFromError(error, "Не удалось создать ссылку Telegram")),
  })
  const disconnectTelegram = useMutation({
    mutationFn: () => sdk.client.fetch("/admin/notification-channels/seller/telegram", { method: "DELETE" }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: SELLER_QUERY_KEY }),
    onError: (error) => toast.error(messageFromError(error, "Не удалось отключить Telegram")),
  })

  if (channelsQuery.isLoading || sellerQuery.isLoading) return <div className="px-6 py-6"><ChannelsSkeleton /></div>
  if (channelsQuery.isError || sellerQuery.isError) return <Text size="small" className="px-6 py-6 text-ui-fg-error">Не удалось загрузить настройки каналов.</Text>

  return (
    <div className="bg-ui-bg-subtle px-6 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {!hasSellerNotificationChannel(seller) ? (
          <Container className="flex items-start justify-between gap-6 px-6 py-4" role="alert">
            <div>
              <Text size="small" weight="plus">Не настроен ни один канал продавца</Text>
              <Text size="small" className="mt-1 text-ui-fg-subtle">Уведомления о новых заказах и возвратах никуда не придут.</Text>
            </div>
            <Button size="small" variant="secondary" onClick={() => setSellerEmailOpen(true)}>Настроить</Button>
          </Container>
        ) : null}
        <section>
          <Heading level="h2">Каналы магазина</Heading>
          <Text size="small" className="mt-1 text-ui-fg-subtle">По каким каналам магазин пишет покупателям.</Text>
          <Container className="mt-3 divide-y p-0">
            {channels.map((channel) => (
              <StoreChannelRow key={channel.id} channel={channel} isUpdating={toggle.isPending && toggle.variables?.channel === channel.channel} onToggle={(enabled) => toggle.mutate({ channel: channel.channel, enabled })} onConfigure={() => setConfigured(channel)} />
            ))}
          </Container>
        </section>
        <section>
          <Heading level="h2">Каналы продавца</Heading>
          <Text size="small" className="mt-1 text-ui-fg-subtle">Куда магазин пишет вам о новых заказах и заявках на возврат.</Text>
          <Container className="mt-3 divide-y p-0">
            <div className="flex items-center justify-between gap-4 px-6 py-4">
              <div><div className="flex items-center gap-2"><Text size="small" weight="plus">Ваша почта</Text><StatusBadge color={seller?.email ? "green" : "grey"}>{seller?.email ? "Настроена" : "Не настроена"}</StatusBadge></div><Text size="small" className="mt-1 text-ui-fg-subtle">{seller?.email ?? "Адрес для служебных уведомлений магазина."}</Text></div>
              <Button size="small" variant="secondary" onClick={() => setSellerEmailOpen(true)}>Настроить</Button>
            </div>
            <div className="flex items-center justify-between gap-4 px-6 py-4">
              <div><div className="flex items-center gap-2"><Text size="small" weight="plus">Ваш Telegram</Text><StatusBadge color={seller?.telegram ? "green" : "grey"}>{seller?.telegram ? "Подключено" : "Не подключён"}</StatusBadge></div><Text size="small" className="mt-1 text-ui-fg-subtle">{seller?.telegram ? `Подключено: ${seller.telegram}` : "Доступно после включения Telegram-бота магазина"}</Text></div>
              {seller?.telegram ? <Button size="small" variant="secondary" isLoading={disconnectTelegram.isPending} onClick={() => disconnectTelegram.mutate()}>Отключить</Button> : <Button size="small" variant="secondary" disabled={!telegram?.enabled} isLoading={sellerTelegram.isPending} onClick={() => sellerTelegram.mutate()}>Подключить Telegram</Button>}
            </div>
          </Container>
        </section>
      </div>
      <ChannelConfigurationModal channel={configured} onClose={() => setConfigured(null)} />
      <FocusModal open={sellerEmailOpen} onOpenChange={setSellerEmailOpen}>
        <FocusModal.Content>
          <FocusModal.Header><div className="flex gap-2"><Button size="small" variant="secondary" onClick={() => setSellerEmailOpen(false)}>Отмена</Button><Button size="small" disabled={!sellerEmail.trim()} isLoading={saveSellerEmail.isPending} onClick={() => saveSellerEmail.mutate()}>Сохранить</Button></div></FocusModal.Header>
          <FocusModal.Body className="flex-1 overflow-auto"><div className="mx-auto flex max-w-lg flex-col gap-6 px-8 py-8"><div><Heading level="h2">Ваша почта</Heading><Text size="small" className="mt-1 text-ui-fg-subtle">Адрес для уведомлений о новых заказах и заявках на возврат.</Text></div><Field id="seller-email" label="Адрес почты" value={sellerEmail} onChange={setSellerEmail} /></div></FocusModal.Body>
        </FocusModal.Content>
      </FocusModal>
    </div>
  )
}
