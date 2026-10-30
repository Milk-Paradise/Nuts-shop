import { createHash } from "crypto"

import type {
  ICacheService,
  ILockingModule,
} from "@medusajs/framework/types"
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

const CART_RATE_LIMIT = 60
const WINDOW_MS = 60 * 1000
const CACHE_TTL_SECONDS = 61

export const CART_RATE_LIMIT_RESPONSE = {
  code: "cart_rate_limited",
  type: "too_many_requests",
  message: "Слишком много обращений к корзине. Повторите через несколько секунд.",
}

type RateLimitWindow = {
  timestamps: number[]
}

type RateLimitIdentity = {
  source: "customer" | "session" | "address"
  value: string
}

type RequestWithOptionalAuthContext = MedusaRequest & {
  auth_context?: { actor_id?: string }
}

function hashIdentity(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24)
}

function customerAlias(identity: RateLimitIdentity): string {
  return `${identity.source}:${hashIdentity(identity.value)}`
}

function sessionId(req: MedusaRequest): string | undefined {
  const cookies = (req as MedusaRequest & { cookies?: Record<string, unknown> })
    .cookies
  const session = cookies?.["connect.sid"]

  return typeof session === "string" && session ? session : undefined
}

function clientAddress(req: MedusaRequest): string {
  const request = req as MedusaRequest & {
    ip?: string
    socket?: { remoteAddress?: string }
  }

  return request.ip || request.socket?.remoteAddress || "unknown"
}

export function cartRateLimitIdentity(req: MedusaRequest): RateLimitIdentity {
  const customerId = (req as RequestWithOptionalAuthContext).auth_context?.actor_id
  if (typeof customerId === "string" && customerId) {
    return { source: "customer", value: customerId }
  }

  const browserSession = sessionId(req)
  if (browserSession) {
    return { source: "session", value: browserSession }
  }

  return { source: "address", value: clientAddress(req) }
}

function key(identity: RateLimitIdentity): string {
  return `cart-rate-limit:${identity.source}:${hashIdentity(identity.value)}`
}

function lockKey(identity: RateLimitIdentity): string {
  return `cart-rate-limit:lock:${identity.source}:${hashIdentity(identity.value)}`
}

function retryAfter(timestamps: number[], now: number): number {
  const oldest = timestamps[0]
  return Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000))
}

function rateLimited(res: MedusaResponse, seconds: number): void {
  res.header("Retry-After", String(seconds))
  res.status(429).json(CART_RATE_LIMIT_RESPONSE)
}

function normalizedCartPath(req: MedusaRequest): string {
  const request = req as MedusaRequest & {
    originalUrl?: string
    path?: string
    url?: string
  }
  const path = (request.path ?? request.originalUrl ?? request.url ?? "/store/carts")
    .split(/[?#]/, 1)[0]
  return path
    .split("/")
    .map((segment) => /^[a-z]+_[a-z0-9]+$/i.test(segment) ? ":id" : segment)
    .join("/")
}

function logCartRequest(req: MedusaRequest, decision: "allowed" | "limited"): void {
  try {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    const message = [
      "[backend]",
      `level=${decision === "allowed" ? "INFO" : "WARN"}`,
      "event=cart_request",
      "service=backend",
      `method=${req.method}`,
      `path=${JSON.stringify(normalizedCartPath(req))}`,
      `customer=${JSON.stringify(customerAlias(cartRateLimitIdentity(req)))}`,
      `decision=${decision}`,
      `window_seconds=${WINDOW_MS / 1000}`,
    ].join(" ")

    if (decision === "allowed") {
      logger.info(message)
    } else {
      logger.warn(message)
    }
  } catch {
    // Logging is observational and must not affect cart availability.
  }
}

function validWindow(value: unknown): value is RateLimitWindow {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as RateLimitWindow).timestamps) &&
    (value as RateLimitWindow).timestamps.every(
      (timestamp) => typeof timestamp === "number" && Number.isFinite(timestamp)
    )
  )
}

export async function enforceCartRateLimit(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<"allowed" | "limited"> {
  const cache = req.scope.resolve<ICacheService>(Modules.CACHE)
  const locking = req.scope.resolve<ILockingModule>(Modules.LOCKING)
  const identity = cartRateLimitIdentity(req)
  const cacheKey = key(identity)

  return locking.execute(lockKey(identity), async () => {
    const now = Date.now()
    const stored = await cache.get<RateLimitWindow>(cacheKey)
    if (stored !== null && !validWindow(stored)) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Invalid cart rate limit state"
      )
    }

    const timestamps = (stored?.timestamps ?? []).filter(
      (timestamp) => timestamp > now - WINDOW_MS
    )
    if (timestamps.length >= CART_RATE_LIMIT) {
      rateLimited(res, retryAfter(timestamps, now))
      return "limited"
    }

    timestamps.push(now)
    await cache.set(cacheKey, { timestamps }, CACHE_TTL_SECONDS)
    return "allowed"
  })
}

export async function cartRateLimit(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (req.method === "OPTIONS") {
    return next()
  }

  try {
    const result = await enforceCartRateLimit(req, res)
    logCartRequest(req, result)
    if (result === "allowed") {
      return next()
    }
  } catch {
    rateLimited(res, 1)
    logCartRequest(req, "limited")
  }
}
