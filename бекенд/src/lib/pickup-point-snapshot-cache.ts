import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import type { ILockingModule, MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { createHash, randomUUID } from "crypto"

export const PICKUP_POINT_SNAPSHOT_SCHEMA_VERSION = 1

export type PickupPointSnapshotSource = {
  provider_key: string
  status: "available" | "partial" | "unavailable"
}

export type PickupPointSnapshotPoint = {
  id: string
  provider_key: string
  external_id: string
  name: string
  address: string
  lat: number | null
  lng: number | null
  schedule: string | null
  provider: string
  carrier: string
}

export type PickupPointSnapshotResult = {
  points: PickupPointSnapshotPoint[]
  map_points: PickupPointSnapshotPoint[]
  sources: PickupPointSnapshotSource[]
}

export type PickupPointSnapshotRequest = {
  city: string
  address: string | null
  carrier: string | null
  provider_keys: string[]
}

type PickupPointSnapshot = {
  schema_version: number
  key: string
  created_at: string
  expires_at: string
  request: PickupPointSnapshotRequest
  result: PickupPointSnapshotResult
}

type SnapshotConfig = {
  bucket: string | null
  prefix: string
  ttlMs: number
  lockWaitMs: number
  lockBackoffMs: number
}

const inProcessRebuilds = new Map<string, Promise<PickupPointSnapshotResult>>()

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function snapshotConfig(): SnapshotConfig {
  return {
    bucket: process.env.PVZ_SNAPSHOT_S3_BUCKET?.trim() || null,
    prefix: (process.env.PVZ_SNAPSHOT_S3_PREFIX?.trim() || "pvz-snapshots").replace(/^\/+|\/+$/g, ""),
    ttlMs: positiveInteger(process.env.PVZ_SNAPSHOT_CACHE_TTL_MS, 5 * 60_000),
    lockWaitMs: positiveInteger(process.env.PVZ_SNAPSHOT_LOCK_WAIT_MS, 5_000),
    lockBackoffMs: positiveInteger(process.env.PVZ_SNAPSHOT_LOCK_BACKOFF_MS, 100),
  }
}

function normalizedDimension(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU")
}

export function pickupPointSnapshotRequest(
  city: string,
  carrier: string | undefined,
  address: string | undefined,
  providerKeys: string[]
): PickupPointSnapshotRequest {
  return {
    city: normalizedDimension(city),
    address: address?.trim() ? normalizedDimension(address) : null,
    carrier: carrier?.trim() ? carrier.trim().toLowerCase() : null,
    provider_keys: [...providerKeys].sort(),
  }
}

export function pickupPointSnapshotKey(request: PickupPointSnapshotRequest) {
  return createHash("sha256")
    .update(JSON.stringify({ schema_version: PICKUP_POINT_SNAPSHOT_SCHEMA_VERSION, ...request }))
    .digest("hex")
}

function objectKey(prefix: string, key: string) {
  return `${prefix ? `${prefix}/` : ""}v${PICKUP_POINT_SNAPSHOT_SCHEMA_VERSION}/${key}.json`
}

function s3Client() {
  return new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
      : undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validPoint(value: unknown): value is PickupPointSnapshotPoint {
  if (!isPlainObject(value)) return false
  const strings = ["id", "provider_key", "external_id", "name", "address", "provider", "carrier"]
  return strings.every((field) => typeof value[field] === "string")
    && (typeof value.lat === "number" || value.lat === null)
    && (typeof value.lng === "number" || value.lng === null)
    && (typeof value.schedule === "string" || value.schedule === null)
    && value.id === `${value.provider_key}:${value.external_id}`
    && (value.lat === null || Number.isFinite(value.lat))
    && (value.lng === null || Number.isFinite(value.lng))
}

function carrierMatchesProviderKey(point: PickupPointSnapshotPoint) {
  return (point.provider_key === "cdek_cdek" && (point.carrier === "cdek" || point.carrier === "cdek_cdek"))
    || (point.provider_key === "ozon_ozon" && point.carrier === "ozon_ozon")
}

function validResult(value: unknown, request: PickupPointSnapshotRequest): value is PickupPointSnapshotResult {
  if (!isPlainObject(value) || !Array.isArray(value.points) || !Array.isArray(value.map_points) || !Array.isArray(value.sources)) return false
  if (!value.points.every(validPoint) || !value.map_points.every(validPoint)) return false
  if (!value.points.every((point) => request.provider_keys.includes(point.provider_key) && carrierMatchesProviderKey(point))) return false
  const pointsById = new Map(value.points.map((point) => [point.id, point]))
  if (!value.map_points.every((point) => pointsById.get(point.id)
    && JSON.stringify(pointsById.get(point.id)) === JSON.stringify(point)
    && typeof point.lat === "number" && point.lat >= -90 && point.lat <= 90
    && typeof point.lng === "number" && point.lng >= -180 && point.lng <= 180)) return false
  if (value.sources.length !== request.provider_keys.length) return false
  const sourceKeys = new Set<string>()
  for (const source of value.sources) {
    if (!isPlainObject(source) || typeof source.provider_key !== "string"
      || !request.provider_keys.includes(source.provider_key) || sourceKeys.has(source.provider_key)
      || (source.status !== "available" && source.status !== "partial" && source.status !== "unavailable")) {
      return false
    }
    sourceKeys.add(source.provider_key)
  }
  return true
}

function validSnapshot(value: unknown, key: string, request: PickupPointSnapshotRequest): value is PickupPointSnapshot {
  if (!isPlainObject(value)) return false
  if (value.schema_version !== PICKUP_POINT_SNAPSHOT_SCHEMA_VERSION || value.key !== key) return false
  if (!isPlainObject(value.request) || JSON.stringify(value.request) !== JSON.stringify(request)) return false
  if (typeof value.created_at !== "string" || Number.isNaN(Date.parse(value.created_at))) return false
  if (typeof value.expires_at !== "string" || Number.isNaN(Date.parse(value.expires_at)) || Date.parse(value.expires_at) <= Date.now()) return false
  return validResult(value.result, request)
}

async function readSnapshot(
  client: S3Client,
  bucket: string,
  object: string,
  key: string,
  request: PickupPointSnapshotRequest
): Promise<PickupPointSnapshotResult | null> {
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object }))
    const body = response.Body as { transformToString?: () => Promise<string> } | undefined
    if (!body?.transformToString) return null
    const snapshot: unknown = JSON.parse(await body.transformToString())
    return validSnapshot(snapshot, key, request) ? snapshot.result : null
  } catch {
    return null
  }
}

async function publishSnapshot(
  client: S3Client,
  bucket: string,
  object: string,
  key: string,
  request: PickupPointSnapshotRequest,
  result: PickupPointSnapshotResult,
  ttlMs: number
) {
  // Do not let a transient empty directory replace the last usable snapshot.
  // A snapshot must contain data from at least one successfully read source.
  if (!result.points.length || !result.sources.some((source) => source.status === "available")) return
  const now = new Date()
  const payload: PickupPointSnapshot = {
    schema_version: PICKUP_POINT_SNAPSHOT_SCHEMA_VERSION,
    key,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
    request,
    result,
  }
  const temporary = `${object}.tmp-${randomUUID()}`
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: temporary,
    Body: JSON.stringify(payload),
    ContentType: "application/json",
  }))
  try {
    await client.send(new CopyObjectCommand({
      Bucket: bucket,
      Key: object,
      CopySource: `${encodeURIComponent(bucket)}/${temporary.split("/").map(encodeURIComponent).join("/")}`,
      ContentType: "application/json",
      MetadataDirective: "REPLACE",
    }))
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: temporary })).catch(() => undefined)
  }
}

async function sleep(ms: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

class SnapshotLockUnavailableError extends Error {
  readonly cause: unknown

  constructor(cause: unknown) {
    super("Pickup point snapshot lock is unavailable")
    this.cause = cause
  }
}

async function withSnapshotLock<T>(
  container: MedusaContainer,
  key: string,
  waitMs: number,
  backoffMs: number,
  work: () => Promise<T>
): Promise<T> {
  let locking: ILockingModule | undefined
  try {
    locking = container.resolve<ILockingModule>(Modules.LOCKING)
  } catch {
    // Test containers and deliberately minimal deployments can omit locking.
  }
  if (locking && typeof locking.execute === "function") {
    let callbackStarted = false
    try {
      return await locking.execute(`pickup-point-snapshot:${key}`, async () => {
        callbackStarted = true
        return work()
      }, {
        timeout: Math.max(1, Math.ceil(waitMs / 1_000)),
      })
    } catch (error) {
      // A callback error (including a failed rebuild) must retain its original
      // meaning. Only an execute rejection before the callback acquired the
      // lock is safe to treat as lock contention.
      if (callbackStarted) throw error
      throw new SnapshotLockUnavailableError(error)
    }
  }
  const existing = inProcessRebuilds.get(key)
  if (existing) return existing as Promise<T>
  const pending = work().finally(() => inProcessRebuilds.delete(key))
  inProcessRebuilds.set(key, pending as Promise<PickupPointSnapshotResult>)
  return pending
}

async function pollSnapshot(
  client: S3Client,
  bucket: string,
  object: string,
  key: string,
  request: PickupPointSnapshotRequest,
  waitMs: number,
  backoffMs: number
) {
  const deadline = Date.now() + waitMs
  do {
    await sleep(backoffMs)
    const snapshot = await readSnapshot(client, bucket, object, key, request)
    if (snapshot) return snapshot
  } while (Date.now() < deadline)
  return null
}

export async function loadOrRebuildPickupPointSnapshot(
  container: MedusaContainer,
  request: PickupPointSnapshotRequest,
  rebuild: () => Promise<PickupPointSnapshotResult>,
  fallback: () => Promise<PickupPointSnapshotResult> = rebuild
): Promise<PickupPointSnapshotResult> {
  const config = snapshotConfig()
  if (!config.bucket) return rebuild()
  const key = pickupPointSnapshotKey(request)
  const object = objectKey(config.prefix, key)
  const client = s3Client()
  const cached = await readSnapshot(client, config.bucket, object, key, request)
  if (cached) return cached

  try {
    return await withSnapshotLock(container, key, config.lockWaitMs, config.lockBackoffMs, async () => {
      const afterLock = await readSnapshot(client, config.bucket!, object, key, request)
      if (afterLock) return afterLock
      const result = await rebuild()
      await publishSnapshot(client, config.bucket!, object, key, request, result, config.ttlMs).catch(() => undefined)
      return result
    })
  } catch (error) {
    if (!(error instanceof SnapshotLockUnavailableError)) throw error
    // Another process owns the lock. It is the only process allowed to rebuild;
    // wait briefly for its atomic publication instead of issuing a second read.
    const afterWait = await pollSnapshot(
      client, config.bucket, object, key, request, config.lockWaitMs, config.lockBackoffMs
    )
    if (afterWait) return afterWait

    // The caller's fallback is intentionally separate from rebuild: do not
    // retry the cache-population callback after another process owned the lock.
    return fallback()
  }
}
