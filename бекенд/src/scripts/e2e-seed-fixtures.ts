// Версия общая на всю волну этапа 4: её поднимали T15 и T16 независимо, а шаблонная
// база пересобирается по одному значению.
export const E2E_SEED_VERSION = "stage4-v3"

export const E2E_AUTH_SECRETS = {
  jwt: "e2e-jwt-secret-for-reproducible-tokens",
  // base64 от 32 байт — формат, которого требует aes-256-gcm в модулях конфигурации провайдеров.
  paymentConfigEncryption: "ZTJlLXByb3ZpZGVyLWNvbmZpZy1lbmNyeXB0aW9uLWs=",
  shippingConfigEncryption: "ZTJlLXNoaXBwaW5nLWNvbmZpZy1lbmNyeXB0aW9uLWs=",
} as const

export const E2E_CUSTOMER = {
  id: "cus_e2e_customer",
  email: "e2e.customer@example.test",
  password: "e2e-customer-password",
  firstName: "Елена",
  lastName: "Тестова",
  phone: "+79990000001",
} as const

export const E2E_ACCOUNT_FIXTURES = {
  emailPrefix: "e2e.t18",
  emailDomain: "example.test",
  registration: {
    password: "e2e-account-password",
    firstName: "Мария",
    lastName: "Тестова",
  },
  invalidPassword: "e2e-invalid-password",
  guestCheckout: {
    contactName: "Иван Тестов",
    phone: "+7 999 123-45-67",
    street: "E2E улица",
    house: "3",
    apartment: "1",
  },
} as const

export const E2E_PASSWORD_RESET_FIXTURES = {
  emailPrefix: "e2e.t19",
  emailDomain: "example.test",
  reset: {
    password: "e2e-t19-original-password",
    newPassword: "e2e-t19-new-password",
    firstName: "Анна",
    lastName: "Тестова",
  },
  unsubscribe: {
    password: "e2e-t19-unsubscribe-password",
    firstName: "Ольга",
  },
} as const

export const E2E_WISHLIST_FIXTURES = {
  emailPrefix: "e2e.t21",
  emailDomain: "example.test",
} as const

export const E2E_ADMIN_WITH_ACCESS = {
  email: "e2e.admin.allowed@example.test",
  password: "e2e-admin-allowed-password",
} as const

export const E2E_ADMIN_WITHOUT_ACCESS = {
  email: "e2e.admin.restricted@example.test",
  password: "e2e-admin-restricted-password",
} as const

export const E2E_RESTRICTED_ADMIN_ROLE_NAME = "E2E catalog viewer"
// Кастомный раздел админки лежит в `src/admin/routes/payment-providers`, поэтому
// его адрес — `/app/payment-providers`. Под `/app/settings/...` админка отдаёт 404.
export const E2E_ADMIN_SECTION_PATH = "/app/payment-providers"

export const E2E_CART_IDS = {
  abandoned: "cart_e2e_abandoned",
  recovery: "cart_e2e_recovery",
} as const

export const E2E_ORDER_DISPLAY_IDS = {
  cancelable: 1,
  nonCancelable: 2,
} as const

export const E2E_PROVIDER_IDS = {
  paymentConfig: "e2e",
  medusaPayment: "pp_e2e_e2e",
  cdek: "cdek_cdek",
} as const

export const E2E_SHIPPING_FIXTURE = {
  shippingOptionName: "E2E CDEK Delivery",
  address: {
    address_1: "E2E улица, 3",
    city: "Москва",
    country_code: "ru",
    postal_code: "101000",
  },
  tariffs: {
    courier: {
      providerKey: "cdek",
      tariffId: 1001,
      tariffName: "E2E курьерская доставка",
      deliveryCost: 490,
      workDaysMin: 1,
      workDaysMax: 2,
    },
    pickup: {
      providerKey: "cdek",
      tariffId: 1002,
      tariffName: "E2E доставка в пункт выдачи",
      deliveryCost: 290,
      workDaysMin: 2,
      workDaysMax: 3,
    },
  },
  pickupPoints: [
    {
      id: 9001,
      providerKey: "cdek",
      name: "E2E ПВЗ Чистые пруды",
      address: "Москва, E2E улица, 7",
      lat: 55.7649,
      lng: 37.6383,
      timetable: "Пн–Вс 09:00–21:00",
      availableOperation: 2,
    },
    {
      id: 9002,
      providerKey: "cdek",
      name: "E2E ПВЗ Китай-город",
      address: "Москва, E2E улица, 12",
      lat: 55.7558,
      lng: 37.6327,
      timetable: "Пн–Вс 10:00–20:00",
      availableOperation: 3,
    },
  ],
} as const

export const E2E_PREVIEW = {
  token: "e2e-preview-token-t03",
  revision: "e2e-homepage-draft-v1",
} as const

export const E2E_CONTENT_PAGE_FIXTURES = {
  delivery: {
    title: "Доставка и оплата",
    courierTitle: "Курьером",
    courierDescription: "От 490 ₽. Обычно 1–2 рабочих дня после подтверждения наличия.",
  },
  contacts: {
    title: "Контакты",
    emptyTitle: "Контакты пока не заполнены",
  },
  colorMatching: {
    eyebrow: "Дополнительная услуга",
    title: "Подбор цвета с помощью менеджера",
  },
} as const

const richText = (text: string) => [
  { type: "paragraph" as const, children: [{ type: "text" as const, text }] },
]

export const E2E_HOMEPAGE_PUBLISHED = {
  revision: "e2e-homepage-published-v1",
  sourceUpdatedAt: "2026-08-17T12:00:00.000Z",
  sections: [
    { __component: "sections.product-carousel", enabled: true, kind: "promotions", heading: "Акции" },
    { __component: "sections.product-carousel", enabled: true, kind: "new_arrivals", heading: "Новинки" },
    { __component: "sections.info-tabs", enabled: true, heading: "Полезная информация", catalog: richText("Каталог материалов"), brands: richText("Проверенные бренды"), contacts: [], about: richText("О магазине"), paintSelection: richText("Подбор краски"), delivery: richText("Доставка") },
    { __component: "sections.catalog-navigation", enabled: true, heading: "Каталог товаров", defaultView: "categories" },
    { __component: "sections.social-reviews", enabled: true, heading: "Мы на связи" },
  ],
  settings: {
    documentId: "e2e-settings-published",
    updatedAt: "2026-08-17T12:00:00.000Z",
    companyName: "Автокраска",
    contacts: richText("Москва"),
    reviewsUrl: "https://example.com/reviews",
    socialLinks: [{ label: "ВКонтакте", url: "https://example.com/social" }],
  },
  seoEntries: [],
} as const

export const E2E_HOMEPAGE_DRAFT = {
  revision: E2E_PREVIEW.revision,
  sourceUpdatedAt: "2026-08-18T09:30:00.000Z",
  sections: [
    { __component: "sections.product-carousel", enabled: true, kind: "new_arrivals", heading: "Черновик: свежие поступления" },
    { __component: "sections.info-tabs", enabled: true, heading: "Черновик: полезная информация", catalog: richText("Черновой каталог материалов"), brands: richText("Черновой список брендов"), contacts: [], about: richText("Черновик страницы о магазине"), paintSelection: richText("Черновой подбор краски"), delivery: richText("Черновые условия доставки") },
    { __component: "sections.catalog-navigation", enabled: true, heading: "Черновик каталога", defaultView: "brands" },
    { __component: "sections.social-reviews", enabled: true, heading: "Черновик контактов" },
  ],
  settings: {
    documentId: "e2e-settings-draft",
    updatedAt: "2026-08-18T09:30:00.000Z",
    companyName: "Автокраска — черновик",
    contacts: richText("Черновой адрес: Москва"),
    reviewsUrl: "https://example.com/reviews-draft",
    socialLinks: [{ label: "ВКонтакте — черновик", url: "https://example.com/social-draft" }],
  },
  seoEntries: [],
} as const

export const E2E_PRODUCT_FIXTURES = {
  purchasable: { title: "E2E Универсальный грунт", handle: "e2e-primer-universal", sku: "E2E-PRIMER-UNIVERSAL" },
  mutableAvailability: { handle: "e2e-clearcoat-mutable", sku: "E2E-CLEARCOAT-MUTABLE" },
  lowStock: { title: "E2E Абразив малого остатка", handle: "e2e-abrasive-low-stock", sku: "E2E-ABRASIVE-LOW" },
  backorder: { title: "E2E Эмаль под заказ", handle: "e2e-enamel-backorder", sku: "E2E-ENAMEL-BACKORDER" },
  unavailable: { title: "E2E Шпатлёвка недоступная", handle: "e2e-filler-unavailable", sku: "E2E-FILLER-UNAVAILABLE" },
  unpublished: { title: "E2E Скрытый грунт", handle: "e2e-hidden-primer", sku: "E2E-HIDDEN-PRIMER" },
  fullContent: { handle: "e2e-clearcoat-full-content", sku: "E2E-CLEARCOAT-FULL" },
} as const

// The homepage promotions rail resolves its products through a collection titled
// "Акции" (see listPromotionProducts) — without it the section renders nothing and
// scenarios 27 and 28 have no carousel to act on.
export const E2E_PROMOTION_COLLECTION = {
  title: "Акции",
  handle: "e2e-promotions",
  productHandles: [
    "e2e-primer-universal",
    "e2e-clearcoat-full-content",
    "e2e-abrasive-low-stock",
  ],
} as const

export const E2E_CATEGORY_HANDLES = {
  coatings: "e2e-coatings",
  primers: "e2e-primers",
  paints: "e2e-paints",
  consumables: "e2e-consumables",
  abrasives: "e2e-abrasives",
  masking: "e2e-masking",
} as const

export const E2E_CATALOG_FIXTURES = {
  searchQuery: "E2E Универсальный грунт",
  noResultsQuery: "QZXWNOTFOUNDE2E",
  category: {
    handle: E2E_CATEGORY_HANDLES.primers,
    name: "E2E Грунты",
  },
  // «E2E Грунты» — дочерняя категория «E2E Покрытий», а навигация каталога на
  // главной показывает только корневые. Для перехода с главной нужна корневая.
  rootCategory: {
    handle: E2E_CATEGORY_HANDLES.coatings,
    name: "E2E Покрытия",
  },
  brand: "E2E Novol",
  priceRange: {
    min: "500",
    max: "1000",
  },
  priceAscendingTitles: [
    "E2E Каталожное покрытие 01",
    "E2E Универсальный грунт",
    "E2E Каталожное покрытие 03",
  ],
} as const
