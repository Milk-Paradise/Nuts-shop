import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const isTest = process.env.NODE_ENV === "test"
const localFiles = process.env.LOCAL_FILE_STORAGE === "true"
const isE2E = process.env.E2E_RUN === "true"
const useNotificationStub = isTest || isE2E

function readNonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback
}

const redisReconnectAttempts = readNonNegativeInteger(
  process.env.REDIS_RECONNECT_ATTEMPTS,
  5
)
const redisReconnectDelayMs = readNonNegativeInteger(
  process.env.REDIS_RECONNECT_DELAY_MS,
  1000
)

const redisOptions = {
  retryStrategy(attempt: number) {
    return attempt <= redisReconnectAttempts
      ? Math.min(attempt * redisReconnectDelayMs, 5000)
      : null
  },
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    // Unset, Medusa/Knex default to a small pool shared across all ~27 core
    // modules' migration runners. On a fresh, unmigrated database this causes
    // KnexTimeoutError ("pool is probably full") once enough modules queue for
    // a connection at once — a known, unresolved upstream issue on first-ever
    // `medusa db:migrate` runs (medusajs/medusa#14829). Raising the pool size
    // gives every module room to hold its own connection concurrently.
    databaseDriverOptions: {
      pool: {
        min: 2,
        max: 50,
      },
    },
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
    // Medusa forces `Secure` session cookies whenever NODE_ENV=production, which
    // silently drops the cookie (and breaks customer login) behind a plain-HTTP
    // deployment like this project's TLS-less Docker Compose self-host/demo stack.
    cookieOptions: {
      secure: process.env.SESSION_COOKIE_SECURE !== "false",
    },
  },
  plugins: [],
  modules: [
    // Medusa's own MEDUSA_FF_RBAC auto-detection resolves too early relative to
    // when the built-in feature flag actually gets registered (initializeContainer
    // loads medusa-config before scanning @medusajs/medusa's feature-flags dir),
    // so the rbac module never gets enabled from the env var alone. Declaring it
    // explicitly here overrides that and lets us gate it on the same env var
    // ourselves — same as everything else does via apps/backend/.env.
    //
    // Kept OUTSIDE the isTest branch below (unlike file/redis/meilisearch):
    // `checkPermissions` middleware unconditionally requires a non-empty `roles`
    // array once a route is policy-wrapped, and routes get wrapped purely based
    // on this same global flag. If the module isn't registered in test env too,
    // `hasPermission`'s role/policy lookup has nothing to query against and
    // every admin route 403s for test tokens, regardless of MEDUSA_FF_RBAC.
    {
      resolve: "@medusajs/medusa/rbac",
      disable: process.env.MEDUSA_FF_RBAC !== "true",
    },
    {
      resolve: "./src/modules/moysklad-integration",
    },
    {
      resolve: "./src/modules/erp-integration-registry",
    },
    { resolve: "./src/modules/cart" },
    { resolve: "./src/modules/cart-merge-operation" },
    {
      resolve: "./src/modules/notification-domain",
    },
    // Custom module for homepage tab content and social/review links
    // (docs/specs/homepage-redesign). No external infra dependency, and
    // its admin access-rights scenario needs integration test coverage —
    // kept outside the isTest branch like rbac above.
    { resolve: "./src/modules/site-content" },
    {
      resolve: "./src/modules/payment-provider-config",
    },
    {
      resolve: "./src/modules/payment-operation",
    },
    {
      resolve: "./src/modules/order-fixation",
    },
    {
      resolve: "@medusajs/medusa/payment",
      dependencies: ["paymentProviderConfig", "paymentOperation"],
      options: {
        providers: [
          {
            resolve: "./src/providers/payment-yookassa-runtime",
            id: "yookassa",
            options: {
              capture: true,
              useReceipt: false,
            },
          },
          ...(isE2E
            ? [
                {
                  resolve: "./src/providers/payment-e2e",
                  id: "e2e",
                  options: {
                    base_url: process.env.E2E_PAYMENT_STUB_URL,
                  },
                },
              ]
            : []),
        ],
      },
    },
    // Pure DB module (no external side effects), so it's registered in every
    // env including test, unlike the isTest-gated block below.
    { resolve: "./src/modules/shipping-provider-registry" },
    // One store-owned pickup point. It is deliberately separate from the
    // external-provider registry: pickup has no credentials or carrier API.
    { resolve: "./src/modules/store-pickup" },
    // Refund admin requests and YooKassa refund webhooks must coordinate even
    // when Medusa runs in more than one process. Keep the default in-memory
    // provider in tests, but use the shared Redis instance in deployed envs.
    ...(!isTest
      ? [
          {
            resolve: "@medusajs/medusa/locking",
            options: {
              providers: [
                {
                  resolve: "@medusajs/medusa/locking-redis",
                  id: "redis",
                  is_default: true,
                  options: {
                    redisUrl: process.env.REDIS_URL,
                    redisOptions,
                    namespace: "catalog:medusa_lock:",
                  },
                },
              ],
            },
          },
        ]
      : []),
    ...(isTest ? [{ resolve: "@medusajs/medusa/cache-inmemory" }] : [
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: localFiles ? "@medusajs/medusa/file-local" : "@medusajs/medusa/file-s3",
            id: localFiles ? "local" : "s3",
            options: localFiles ? {
              backend_url: process.env.FILE_PUBLIC_URL || "http://localhost:9000/static",
            } : {
              file_url: process.env.S3_FILE_URL,
              access_key_id: process.env.S3_ACCESS_KEY_ID,
              secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
              region: process.env.S3_REGION,
              bucket: process.env.S3_BUCKET,
              endpoint: process.env.S3_ENDPOINT,
              // MinIO requires path-style addressing when using a local endpoint.
              additional_client_config: {
                forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
              },
            },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/cache-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
        redisOptions,
      },
    },
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
        redisOptions,
        jobOptions: {
          attempts: 5,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
          removeOnFail: {
            age: 7 * 24 * 60 * 60,
          },
        },
      },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: {
        redis: {
          redisUrl: process.env.REDIS_URL,
          redisOptions,
          jobWorkerOptions: {
            // A stalled scheduled run may already have completed its side effect.
            // Do not execute that occurrence again; the cron schedule is the retry.
            maxStalledCount: 0,
          },
        },
      },
    },
    {
      resolve: "./src/modules/meilisearch",
      options: {
        host: process.env.MEILISEARCH_HOST,
        apiKey: process.env.MEILISEARCH_API_KEY,
        indexPrefix: process.env.MEILISEARCH_INDEX_PREFIX,
      },
    },
    ]),
    {
      resolve: "@medusajs/medusa/fulfillment",
      dependencies: ["shippingProviderRegistry", "cache", "locking"],
      options: {
        // Overriding `providers` replaces Medusa's defaults rather than
        // extending them, so the built-in manual provider (used by every
        // store pickup shipping option) must be re-listed explicitly here.
        providers: [
          {
            resolve: "@medusajs/medusa/fulfillment-manual",
            id: "manual",
          },
          {
            resolve: "./src/providers/fulfillment-cdek",
            id: "cdek",
          },
          {
            resolve: "./src/providers/fulfillment-ozon",
            id: "ozon",
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/notification",
      dependencies: ["notificationDomain", "cmsSnapshot"],
      options: {
        providers: [
          {
            resolve: "./src/modules/notification-domain/provider-index",
            id: "domain",
            options: {
              channels: ["email"],
              email: useNotificationStub
                ? {
                    provider: "e2e",
                    options: {
                      base_url: process.env.E2E_NOTIFICATION_STUB_URL,
                    },
                  }
                : {
                    provider: "smtp",
                    options: {
                      host: process.env.SMTP_HOST,
                      port: Number(process.env.SMTP_PORT ?? 587),
                      user: process.env.SMTP_USER,
                      password: process.env.SMTP_PASSWORD,
                      from: process.env.SMTP_FROM,
                    },
                  },
            },
          },
        ],
      },
    },
    {
      resolve: "./src/modules/wishlist",
    },
    {
      resolve: "./src/modules/abandoned-cart-reminder",
    },
    {
      resolve: "./src/modules/cms-snapshot",
    },
  ],
})
