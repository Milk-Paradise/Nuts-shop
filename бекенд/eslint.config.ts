import { defineConfig, globalIgnores } from "eslint/config"
import medusa from "@medusajs/eslint-plugin"

const runtimeSourceFiles = ["src/**/*.{ts,tsx}"]
const runtimeSourceIgnores = ["src/**/__tests__/**", "src/scripts/**"]

const importFrom = (directory: string) =>
  `^(?:(?:\\.\\.?/)+(?:src/)?|src/)${directory}(?:/|$)`

const secretEncryptionPaths = ["crypto", "node:crypto"].map((name) => ({
  name,
  importNames: ["createCipheriv", "createDecipheriv"],
  message:
    "Шифрование секретов — только в src/lib/secret-crypto.ts (AIL-120). " +
    "Не заводить четвёртую реализацию: несовместимые форматы ключа уже " +
    "роняют расшифровку реквизитов на проде (AIL-95).",
}))

const secretEncryptionRule = (patterns = []) => [
  "error",
  {
    paths: secretEncryptionPaths,
    ...(patterns.length > 0 ? { patterns } : {}),
  },
]

const importSelector = (directory: string) =>
  `ImportDeclaration[source.value=/${importFrom(directory).replaceAll("/", "\\/")}/]`

// Flat config заменяет настройки одного правила, а не объединяет их. Поэтому
// warning-барьеры используют селекторы, оставляя no-restricted-imports для
// межмодульного error-барьера.
const providerKeyLiterals = {
  selector: 'Literal[value="cdek_cdek"], Literal[value="ozon_ozon"]',
  message:
    "Ключи провайдеров определяются только в provider-keys.ts (AIL-149): " +
    "рассеянные строки мешают заменить адаптер и не проверяются типами.",
}

const fpResolveLiterals = {
  selector: 'Literal[value=/^fp_/], TemplateElement[value.raw=/^fp_/]',
  message:
    "Литерал fp_<ключ> резолвит адаптер перевозчика через приватный " +
    "контейнер Medusa и никогда не работает в проде (AIL-147): вызов " +
    "идёт только через shipping-provider-registry.",
}

const internalApiImport = {
  selector: importSelector("api"),
  message:
    "Внутренние слои не зависят от src/api (AIL-149): API отвечает за HTTP, " +
    "иначе бизнес-логика оказывается привязана к транспорту.",
}

const workflowStepImport = {
  selector: importSelector("workflows/steps"),
  message:
    "API запускает workflow, а не его шаги (AIL-149): прямой вызов обходит " +
    "бизнес-оркестрацию и её компенсации.",
}

const moyskladClientImport = {
  selector: importSelector("modules/moysklad-integration/client"),
  message:
    "Клиент внешнего API остаётся в своём модуле или provider (AIL-149): иначе " +
    "формат и типы МойСклад протекают в бизнес-логику.",
}

const shippingClientImport = {
  selector: importSelector(
    "modules/shipping-provider-registry/(?:cdek-client|ozon-client)"
  ),
  message:
    "Клиент внешнего API остаётся в своём модуле или provider (AIL-149): иначе " +
    "формат и типы перевозчика протекают в бизнес-логику.",
}

const providerImplementationImport = {
  selector: importSelector("providers"),
  message:
    "Реализация provider подставляется только в medusa-config.ts (AIL-149): " +
    "прямой импорт привязывает бизнес-код к конкретному адаптеру.",
}

// Список намеренно ручной: no-restricted-imports не умеет сравнивать модуль
// исходного файла с модулем цели. Новый custom-модуль добавляется сюда.
const customModuleZones = [
  "abandoned-cart-reminder",
  "cms-snapshot",
  "meilisearch",
  "moysklad-integration",
  "notification-e2e",
  "notification-smtp",
  "payment-provider-config",
  "shipping-provider-registry",
  "site-content",
  "store-pickup",
  "wishlist",
]

export default defineConfig([
  globalIgnores(
    [
      "**/node_modules/**",
      "**/.cache/**",
      "**/.medusa/**",
      "**/build/**",
      "**/coverage/**",
      "**/dist/**",
      "**/eslint.config.*",
      "**/test-results/**",
    ],
    "Generated files and build artifacts"
  ),
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
    rules: {
      "no-debugger": "error",
    },
  },
  // Шифрование секретов — одна реализация на репозиторий. Правило намеренно
  // красное: единой утилиты ещё нет, а три существующих реализации (оплата,
  // доставка, МойСклад) используют несовместимые форматы ключа, из-за чего на
  // проде не расшифровываются реквизиты (AIL-95). Унификация и миграция —
  // AIL-120; до неё эти три ошибки ожидаемы. Хеши, HMAC и UUID из `crypto`
  // правило не задевает — ограничены только две функции шифрования.
  {
    name: "catalog/secret-encryption-barrier",
    files: ["src/**/*.ts"],
    ignores: ["src/lib/secret-crypto.ts"],
    rules: {
      "no-restricted-imports": secretEncryptionRule(),
    },
  },
  {
    name: "catalog/moysklad-module-boundaries",
    files: ["src/modules/moysklad-integration/**/*.{ts,tsx}"],
    ignores: [
      ...runtimeSourceIgnores,
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        providerKeyLiterals,
        fpResolveLiterals,
        internalApiImport,
        shippingClientImport,
        providerImplementationImport,
      ],
    },
  },
  {
    name: "catalog/shipping-module-boundaries",
    files: ["src/modules/shipping-provider-registry/**/*.{ts,tsx}"],
    ignores: [
      ...runtimeSourceIgnores,
      "src/modules/shipping-provider-registry/provider-keys.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        providerKeyLiterals,
        internalApiImport,
        moyskladClientImport,
        providerImplementationImport,
      ],
    },
  },
  {
    name: "catalog/internal-layer-boundaries",
    files: [
      "src/modules/**/*.{ts,tsx}",
      "src/workflows/**/*.{ts,tsx}",
      "src/jobs/**/*.{ts,tsx}",
      "src/subscribers/**/*.{ts,tsx}",
    ],
    ignores: [
      ...runtimeSourceIgnores,
      "src/modules/moysklad-integration/**",
      "src/modules/shipping-provider-registry/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        providerKeyLiterals,
        fpResolveLiterals,
        internalApiImport,
        moyskladClientImport,
        shippingClientImport,
        providerImplementationImport,
      ],
    },
  },
  {
    name: "catalog/provider-boundaries",
    files: ["src/providers/**/*.{ts,tsx}"],
    ignores: runtimeSourceIgnores,
    rules: {
      "no-restricted-syntax": [
        "warn",
        providerKeyLiterals,
        fpResolveLiterals,
        internalApiImport,
        providerImplementationImport,
      ],
    },
  },
  {
    name: "catalog/api-boundaries",
    files: ["src/api/**/*.{ts,tsx}"],
    ignores: runtimeSourceIgnores,
    rules: {
      "no-restricted-syntax": [
        "warn",
        providerKeyLiterals,
        fpResolveLiterals,
        workflowStepImport,
        moyskladClientImport,
        shippingClientImport,
        providerImplementationImport,
      ],
    },
  },
  {
    name: "catalog/admin-provider-keys",
    files: ["src/admin/**/*.{ts,tsx}"],
    ignores: runtimeSourceIgnores,
    rules: {
      "no-restricted-syntax": [
        "warn",
        providerKeyLiterals,
        fpResolveLiterals,
      ],
    },
  },
  {
    name: "catalog/other-runtime-boundaries",
    files: runtimeSourceFiles,
    ignores: [
      ...runtimeSourceIgnores,
      "src/admin/**",
      "src/api/**",
      "src/modules/**",
      "src/workflows/**",
      "src/providers/**",
      "src/jobs/**",
      "src/subscribers/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        providerKeyLiterals,
        fpResolveLiterals,
        moyskladClientImport,
        shippingClientImport,
        providerImplementationImport,
      ],
    },
  },
  ...customModuleZones.map((zone) => ({
    name: `catalog/custom-module-isolation/${zone}`,
    files: [`src/modules/${zone}/**/*.{ts,tsx}`],
    ignores: runtimeSourceIgnores,
    rules: {
      "no-restricted-imports": secretEncryptionRule([
        {
          regex: importFrom(
            `modules/(?:${customModuleZones
              .filter((otherZone) => otherZone !== zone)
              .join("|")})`
          ),
          message:
            "Custom-модуль не импортирует другой custom-модуль (AIL-149): " +
            "это нарушает изоляцию данных и создаёт скрытые межмодульные связи.",
        },
      ]),
    },
  })),
  ...medusa.configs.recommended,
])
