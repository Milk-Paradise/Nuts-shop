import { z } from "zod"
import {
  isFlatNotificationTemplateVariable,
  NOTIFICATION_TEMPLATE_VARIABLE,
  notificationTemplateVariables,
} from "./notification-template-variables"

/**
 * Опубликованный контент CMS читается БЕЗ токена: публичная роль Strapi отдаёт
 * только опубликованные документы, а это тот же контент, который витрина
 * показывает любому покупателю.
 *
 * Токен остался нужен единственному сценарию — чтению ЧЕРНОВИКОВ для
 * предпросмотра: публичная роль их не видит. Прежняя передача токена файлом в
 * общем томе снята вместе с общим томом: у отдельных приложений его нет, а
 * задать значение токена нечем — Strapi 5 генерирует accessKey сам и функции
 * «зарегистрируй вот это значение» не имеет. Поэтому предпросмотр — осознанный
 * шаг владельца: он заводит токен в админке и кладёт в STRAPI_READ_TOKEN.
 * Отсутствие токена не ломает магазин, а отказывает ровно предпросмотру и
 * говорит, чего не хватает.
 */
export function resolveStrapiPreviewToken(
  environment: NodeJS.ProcessEnv = process.env
): string {
  const configuredToken = environment.STRAPI_READ_TOKEN?.trim()
  if (configuredToken) return configuredToken
  throw new Error(
    "STRAPI_READ_TOKEN is required to read CMS drafts: create a read-only API " +
      "token in the CMS admin and set it for this service. Published content " +
      "does not need it."
  )
}

const httpUrl = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol
  return protocol === "http:" || protocol === "https:"
}, "Expected an HTTP(S) URL")

const richNode: z.ZodTypeAny = z.lazy(() => z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"), text: z.string(), bold: z.boolean().optional(),
    italic: z.boolean().optional(), underline: z.boolean().optional(),
    strikethrough: z.boolean().optional(), code: z.boolean().optional(),
  }).strict(),
  z.object({ type: z.literal("paragraph"), children: z.array(richNode) }).strict(),
  z.object({ type: z.literal("list-item"), children: z.array(richNode) }).strict(),
  z.object({
    type: z.literal("list"), format: z.enum(["ordered", "unordered"]),
    children: z.array(richNode),
  }).strict(),
  z.object({ type: z.literal("link"), url: httpUrl, children: z.array(richNode) }).strict(),
]))
const blocks = z.array(richNode)

const image = z.object({ url: httpUrl, alternativeText: z.string().nullable().optional() })
const target = z.object({
  type: z.enum(["product", "category", "collection", "external_url"]),
  medusaId: z.string().nullable().optional(),
  url: httpUrl.nullable().optional(),
}).superRefine((value, context) => {
  const external = value.type === "external_url"
  if ((external && (!value.url || value.medusaId)) || (!external && (!value.medusaId || value.url))) {
    context.addIssue({ code: "custom", message: "Invalid commerce target" })
  }
})

const base = { enabled: z.boolean() }
const section = z.discriminatedUnion("__component", [
  z.object({ __component: z.literal("sections.product-carousel"), ...base, kind: z.enum(["promotions", "new_arrivals"]), heading: z.string().min(1) }),
  z.object({ __component: z.literal("sections.catalog-navigation"), ...base, heading: z.string().nullish(), defaultView: z.enum(["categories", "brands"]) }),
  z.object({ __component: z.literal("sections.social-reviews"), ...base, heading: z.string().nullish() }),
  z.object({
    __component: z.literal("sections.info-tabs"), ...base,
    heading: z.string().nullish(),
    catalog: blocks.nullish(), brands: blocks.nullish(), contacts: blocks.nullish(),
    about: blocks.nullish(), paintSelection: blocks.nullish(), delivery: blocks.nullish(),
  }),
  z.object({
    __component: z.literal("sections.promo-banners"), ...base, heading: z.string().nullish(),
    banners: z.array(z.object({
      enabled: z.boolean(), heading: z.string().min(1), text: z.string().nullish(),
      desktopImage: image, mobileImage: image, alt: z.string().min(1), target,
    })).min(1),
  }),
])

const homepagePayload = z.object({
  data: z.object({ documentId: z.string(), updatedAt: z.string(), sections: z.array(section) }),
})
const settingsPayload = z.object({
  data: z.object({
    documentId: z.string(), updatedAt: z.string(), companyName: z.string().min(1),
    contacts: blocks.nullish(), reviewsUrl: httpUrl.nullish(),
    socialLinks: z.array(z.object({ label: z.string().min(1), url: httpUrl })).default([]),
  }),
})
const seoEntry = z.object({
  documentId: z.string(),
  updatedAt: z.string(),
  pageType: z.enum(["homepage", "catalog", "category", "product"]),
  medusaId: z.string().nullish(),
  seo: z.object({
    title: z.string().nullish(), description: z.string().nullish(), canonicalUrl: httpUrl.nullish(),
    robots: z.enum(["index_follow", "noindex_follow", "noindex_nofollow"]).nullish(),
    openGraphTitle: z.string().nullish(), openGraphDescription: z.string().nullish(),
    openGraphImage: image.nullish(),
  }),
}).superRefine((value, context) => {
  const dynamic = value.pageType === "category" || value.pageType === "product"
  if ((dynamic && !value.medusaId) || (!dynamic && value.medusaId)) {
    context.addIssue({ code: "custom", message: "Invalid SEO identity" })
  }
})
const seoPayload = z.object({ data: z.array(seoEntry) })

export const NOTIFICATION_EVENTS = [
  "order-confirmation", "order-payment-confirmed", "customer-password-reset",
  "abandoned-cart-reminder", "order-canceled", "return-requested", "return-approved",
  "return-rejected", "seller-new-order", "seller-return-request",
] as const
export const NOTIFICATION_CHANNELS = ["email", "telegram", "sms"] as const
export const NOTIFICATION_RECIPIENTS = ["customer", "seller"] as const

const notificationTemplateEntry = z.object({
  documentId: z.string().min(1), updatedAt: z.string().datetime(),
  event: z.enum(NOTIFICATION_EVENTS), channel: z.enum(NOTIFICATION_CHANNELS),
  recipient: z.enum(NOTIFICATION_RECIPIENTS), subject: z.string().nullish(),
  body: z.string().min(1), language: z.literal("ru"), enabled: z.boolean(),
  mandatory: z.boolean().optional(),
})
const notificationTemplatesPayload = z.object({
  data: z.array(notificationTemplateEntry),
  meta: z.object({ pagination: z.object({
    page: z.number().int().positive(), pageCount: z.number().int().nonnegative(),
  }) }).optional(),
})

export type NotificationTemplate = Omit<z.infer<typeof notificationTemplateEntry>, "mandatory"> & { mandatory: boolean }
export type NotificationTemplatesSnapshot = {
  revision: string
  sourceUpdatedAt: string
  templates: NotificationTemplate[]
}
type TemplateVariables = { allowed: readonly string[]; required: readonly string[] }
const ORDER_VARIABLES = [
  "order_number", "customer_name", "order_total", "order_status", "payment_status",
  "delivery_address", "pickup_point_address", "tracking_number",
] as const
export const NOTIFICATION_TEMPLATE_VARIABLES: Record<typeof NOTIFICATION_EVENTS[number], TemplateVariables> = {
  "order-confirmation": { allowed: ORDER_VARIABLES, required: ["order_number"] },
  "order-payment-confirmed": { allowed: ORDER_VARIABLES, required: ["order_number"] },
  "customer-password-reset": { allowed: ["customer_name", "reset_url", "expires_in_minutes"], required: ["reset_url"] },
  "abandoned-cart-reminder": { allowed: ["customer_name", "cart_total", "checkout_url", "unsubscribe_url"], required: ["checkout_url", "unsubscribe_url"] },
  "order-canceled": { allowed: ORDER_VARIABLES, required: ["order_number"] },
  "return-requested": { allowed: [...ORDER_VARIABLES, "return_reason", "return_status", "return_tracking_number"], required: ["order_number"] },
  "return-approved": { allowed: [...ORDER_VARIABLES, "return_reason", "return_status", "return_tracking_number"], required: ["order_number"] },
  "return-rejected": { allowed: [...ORDER_VARIABLES, "return_reason", "return_status"], required: ["order_number"] },
  "seller-new-order": { allowed: ORDER_VARIABLES, required: ["order_number"] },
  "seller-return-request": { allowed: [...ORDER_VARIABLES, "return_reason", "return_status"], required: ["order_number"] },
}
const SMS_VARIABLES = new Set([
  "order_number", "order_status", "payment_status", "delivery_address",
  "pickup_point_address", "tracking_number", "return_status", "return_tracking_number",
])
export const NOTIFICATION_TEMPLATE_EXAMPLE: Readonly<Record<string, string>> = {
  order_number: "12345", customer_name: "Александр", order_total: "12 345 ₽",
  order_status: "готов к выдаче", payment_status: "оплачен",
  delivery_address: "г. Москва, ул. Тверская, д. 1, кв. 10",
  pickup_point_address: "г. Москва, ул. Лесная, д. 5", tracking_number: "TRACK123456789",
  reset_url: "https://example.test/reset/abcdefghijk", expires_in_minutes: "15",
  cart_total: "12 345 ₽", checkout_url: "https://example.test/cart/abcdefghijk",
  unsubscribe_url: "https://example.test/unsubscribe/abcdefghijk", return_reason: "товар не подошёл",
  return_status: "возврат подтверждён", return_tracking_number: "RETURN123456789",
}
const MANDATORY_EVENTS = new Set<typeof NOTIFICATION_EVENTS[number]>([
  "customer-password-reset", "order-confirmation", "order-payment-confirmed",
  "return-requested", "return-approved", "return-rejected",
])
const renderExample = (value: string) => value.replace(
  NOTIFICATION_TEMPLATE_VARIABLE, (_, name: string) => NOTIFICATION_TEMPLATE_EXAMPLE[name] ?? ""
)

function normalizeNotificationTemplate(input: z.infer<typeof notificationTemplateEntry>): NotificationTemplate {
  if (input.channel === "email" && !input.subject?.trim()) {
    throw new Error(`Notification template '${input.documentId}' requires a subject for email`)
  }
  const contract = NOTIFICATION_TEMPLATE_VARIABLES[input.event]
  const variables = notificationTemplateVariables(`${input.subject ?? ""}\n${input.body}`)
  const allowed = input.channel === "sms"
    ? new Set(contract.allowed.filter((name) => SMS_VARIABLES.has(name)))
    : new Set(contract.allowed)
  const unknown = [...variables].find(
    (name) => !isFlatNotificationTemplateVariable(name) || !allowed.has(name)
  )
  if (unknown) throw new Error(`Notification template '${input.documentId}' has unknown variable '{{${unknown}}}'`)
  const missing = contract.required.find((name) => !variables.has(name))
  if (missing) throw new Error(`Notification template '${input.documentId}' misses required variable '{{${missing}}}'`)
  if (input.channel === "sms" && renderExample(input.body).length > 134) {
    throw new Error(`Notification template '${input.documentId}' exceeds the two-part SMS limit of 134 characters`)
  }
  const mandatory = input.channel !== "sms" && MANDATORY_EVENTS.has(input.event)
  return { ...input, subject: input.subject?.trim() || null, mandatory, enabled: mandatory || input.enabled }
}

export function normalizeNotificationTemplates(payload: unknown): NotificationTemplatesSnapshot {
  const parsed = notificationTemplatesPayload.parse(payload).data
  const identities = new Set<string>()
  const templates = parsed.map((entry) => {
    const identity = `${entry.event}:${entry.channel}:${entry.recipient}`
    if (identities.has(identity)) throw new Error(`Duplicate notification template '${identity}'`)
    identities.add(identity)
    return normalizeNotificationTemplate(entry)
  }).sort((a, b) => a.documentId.localeCompare(b.documentId))
  const sourceUpdatedAt = templates.length
    ? new Date(Math.max(...templates.map((entry) => new Date(entry.updatedAt).getTime()))).toISOString()
    : new Date(0).toISOString()
  return {
    revision: templates.map((entry) => `${entry.documentId}:${entry.updatedAt}`).join("|"),
    sourceUpdatedAt, templates,
  }
}

export type CmsHomepage = {
  revision: string
  sourceUpdatedAt: string
  fallback?: boolean
  sections: z.infer<typeof section>[]
  settings: z.infer<typeof settingsPayload>["data"]
  seoEntries: z.infer<typeof seoEntry>[]
}

export function createEmptyCmsHomepage(companyName = "Магазин автокрасок"): CmsHomepage {
  return {
    revision: "cold-start",
    sourceUpdatedAt: new Date(0).toISOString(),
    fallback: true,
    sections: [],
    settings: {
      documentId: "cold-start",
      updatedAt: new Date(0).toISOString(),
      companyName,
      contacts: [],
      reviewsUrl: null,
      socialLinks: [],
    },
    seoEntries: [],
  }
}

export function normalizeCmsHomepage(homepage: unknown, settings: unknown, seo: unknown = { data: [] }): CmsHomepage {
  const parsedHomepage = homepagePayload.parse(homepage).data
  const parsedSettings = settingsPayload.parse(settings).data
  const parsedSeo = seoPayload.parse(seo).data
  const timestamps = [parsedHomepage.updatedAt, parsedSettings.updatedAt, ...parsedSeo.map((entry) => entry.updatedAt)]
  return {
    revision: `${parsedHomepage.documentId}:${parsedHomepage.updatedAt}|${parsedSettings.documentId}:${parsedSettings.updatedAt}|seo:${parsedSeo.map((entry) => `${entry.documentId}:${entry.updatedAt}`).sort().join(",")}`,
    sourceUpdatedAt: new Date(
      Math.max(...timestamps.map((timestamp) => new Date(timestamp).getTime()))
    ).toISOString(),
    sections: parsedHomepage.sections.filter((item) => item.enabled),
    settings: parsedSettings,
    seoEntries: parsedSeo,
  }
}

const fetchJson = async (url: URL, token?: string): Promise<unknown> => {
  const response = await fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`Strapi request failed with ${response.status}`)
  return response.json()
}

const seoPagePayload = z.object({
  data: z.array(z.unknown()),
  meta: z.object({
    pagination: z.object({ page: z.number().int().positive(), pageCount: z.number().int().nonnegative() }),
  }).optional(),
})

export async function fetchAllSeoEntries(url: URL, token?: string): Promise<unknown> {
  const firstUrl = new URL(url)
  firstUrl.searchParams.set("pagination[page]", "1")
  const first = seoPagePayload.parse(await fetchJson(firstUrl, token))
  const pageCount = first.meta?.pagination.pageCount ?? 1
  if (pageCount <= 1) return { data: first.data }
  const remaining = await Promise.all(Array.from({ length: pageCount - 1 }, async (_, index) => {
    const pageUrl = new URL(url)
    pageUrl.searchParams.set("pagination[page]", String(index + 2))
    const page = seoPagePayload.parse(await fetchJson(pageUrl, token))
    if (page.meta && page.meta.pagination.page !== index + 2) {
      throw new Error("Strapi SEO pagination returned an unexpected page")
    }
    return page.data
  }))
  return { data: [...first.data, ...remaining.flat()] }
}

async function fetchAllNotificationTemplates(url: URL): Promise<unknown> {
  const firstUrl = new URL(url)
  firstUrl.searchParams.set("pagination[page]", "1")
  const first = notificationTemplatesPayload.parse(await fetchJson(firstUrl))
  const pageCount = first.meta?.pagination.pageCount ?? 1
  if (pageCount <= 1) return { data: first.data }
  const remaining = await Promise.all(Array.from({ length: pageCount - 1 }, async (_, index) => {
    const pageUrl = new URL(url)
    pageUrl.searchParams.set("pagination[page]", String(index + 2))
    const page = notificationTemplatesPayload.parse(await fetchJson(pageUrl))
    if (page.meta && page.meta.pagination.page !== index + 2) {
      throw new Error("Strapi notification template pagination returned an unexpected page")
    }
    return page.data
  }))
  return { data: [...first.data, ...remaining.flat()] }
}

export async function fetchPublishedNotificationTemplates(): Promise<NotificationTemplatesSnapshot> {
  const baseUrl = process.env.STRAPI_INTERNAL_URL
  if (!baseUrl) throw new Error("STRAPI_INTERNAL_URL is required")
  const url = new URL("/api/notification-templates", baseUrl)
  url.searchParams.set("status", "published")
  url.searchParams.set("pagination[pageSize]", "100")
  return normalizeNotificationTemplates(await fetchAllNotificationTemplates(url))
}

export async function fetchConsistentPublishedNotificationTemplates(
  fetcher: () => Promise<NotificationTemplatesSnapshot> = fetchPublishedNotificationTemplates,
  attempts = 3
): Promise<NotificationTemplatesSnapshot> {
  let previous = await fetcher()
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await fetcher()
    if (current.revision === previous.revision) return current
    previous = current
  }
  throw new Error("Strapi notification template publication changed during snapshot read")
}

export async function fetchHomepage(status: "draft" | "published"): Promise<CmsHomepage> {
  const baseUrl = process.env.STRAPI_INTERNAL_URL
  if (!baseUrl) throw new Error("STRAPI_INTERNAL_URL is required")
  // Черновики закрыты для публичной роли, опубликованное — нет.
  const token = status === "draft" ? resolveStrapiPreviewToken() : undefined

  const { homepageUrl, settingsUrl, seoUrl } = buildContentUrls(baseUrl, status)

  const [homepage, settings, seo] = await Promise.all([
    fetchJson(homepageUrl, token), fetchJson(settingsUrl, token), fetchAllSeoEntries(seoUrl, token),
  ])
  return normalizeCmsHomepage(homepage, settings, seo)
}

export const fetchPublishedHomepage = () => fetchHomepage("published")
export const fetchDraftHomepage = () => fetchHomepage("draft")

export async function fetchConsistentPublishedHomepage(
  fetcher: () => Promise<CmsHomepage> = fetchPublishedHomepage,
  attempts = 3
): Promise<CmsHomepage> {
  let previous = await fetcher()
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await fetcher()
    if (current.revision === previous.revision) return current
    previous = current
  }
  throw new Error("Strapi publication changed during snapshot read")
}

export function buildContentUrls(baseUrl: string, status: "draft" | "published") {
  const homepageUrl = new URL("/api/homepage", baseUrl)
  homepageUrl.searchParams.set("status", status)
  for (const component of [
    "sections.product-carousel",
    "sections.info-tabs",
    "sections.catalog-navigation",
    "sections.social-reviews",
  ]) {
    homepageUrl.searchParams.set(
      `populate[sections][on][${component}][populate]`,
      "*"
    )
  }
  homepageUrl.searchParams.set(
    "populate[sections][on][sections.promo-banners][populate][banners][populate]",
    "*"
  )
  const settingsUrl = new URL("/api/site-setting", baseUrl)
  settingsUrl.searchParams.set("status", status)
  settingsUrl.searchParams.set("populate[socialLinks]", "*")
  const seoUrl = new URL("/api/seo-entries", baseUrl)
  seoUrl.searchParams.set("status", status)
  seoUrl.searchParams.set("pagination[pageSize]", "100")
  seoUrl.searchParams.set("populate[seo][populate]", "openGraphImage")
  return { homepageUrl, settingsUrl, seoUrl }
}

export const buildPublishedContentUrls = (baseUrl: string) =>
  buildContentUrls(baseUrl, "published")
