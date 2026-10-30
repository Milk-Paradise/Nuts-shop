import { isIP } from "node:net"

// https://yookassa.ru/developers/using-api/webhooks — checked 2026-07-13.
const YOOKASSA_WEBHOOK_NETWORKS = [
  "185.71.76.0/27",
  "185.71.77.0/27",
  "77.75.153.0/25",
  "77.75.156.11/32",
  "77.75.156.35/32",
  "77.75.154.128/25",
  "2a02:5180::/32",
] as const

export function normalizeRemoteAddress(address: string | null | undefined) {
  const withoutScope = (address ?? "").trim().split("%", 1)[0]

  return withoutScope.toLowerCase().startsWith("::ffff:")
    ? withoutScope.slice(7)
    : withoutScope
}

function ipv4ToBigInt(address: string) {
  return address.split(".").reduce((value, part) => {
    return (value << 8n) + BigInt(Number(part))
  }, 0n)
}

function ipv6ToBigInt(address: string) {
  const [head = "", tail = ""] = address.split("::")
  const headParts = head ? head.split(":") : []
  const tailParts = tail ? tail.split(":") : []
  const missingParts = 8 - headParts.length - tailParts.length

  if (missingParts < 0 || (!address.includes("::") && missingParts !== 0)) {
    throw new Error("Invalid IPv6 address")
  }

  const parts = [
    ...headParts,
    ...Array.from({ length: missingParts }, () => "0"),
    ...tailParts,
  ]

  if (parts.length !== 8) {
    throw new Error("Invalid IPv6 address")
  }

  return parts.reduce((value, part) => {
    return (value << 16n) + BigInt(`0x${part || "0"}`)
  }, 0n)
}

function parseAddress(address: string) {
  const version = isIP(address)

  try {
    if (version === 4) {
      return { bits: 32, version, value: ipv4ToBigInt(address) }
    }

    if (version === 6) {
      return { bits: 128, version, value: ipv6ToBigInt(address) }
    }
  } catch {
    // Unsupported-but-valid textual forms (for example IPv4 embedded in
    // IPv6) must fail closed instead of escaping into the request handler.
    return null
  }

  return null
}

export function addressMatchesNetwork(address: string, network: string) {
  const [networkAddress, prefixValue] = network.split("/")
  const parsedAddress = parseAddress(address)
  const parsedNetwork = parseAddress(networkAddress)

  if (
    !parsedAddress ||
    !parsedNetwork ||
    parsedAddress.version !== parsedNetwork.version
  ) {
    return false
  }

  const prefix = Number(prefixValue)

  if (!Number.isInteger(prefix) || prefix < 0 || prefix > parsedAddress.bits) {
    return false
  }

  const shift = BigInt(parsedAddress.bits - prefix)

  return parsedAddress.value >> shift === parsedNetwork.value >> shift
}

export function isYooKassaWebhookIp(address: string | null | undefined) {
  const normalized = normalizeRemoteAddress(address)

  return YOOKASSA_WEBHOOK_NETWORKS.some((network) =>
    addressMatchesNetwork(normalized, network)
  )
}

function trustedProxyNetworks() {
  return (process.env.YOOKASSA_WEBHOOK_TRUSTED_PROXY_CIDRS ?? "")
    .split(",")
    .map((network) => network.trim())
    .filter(Boolean)
}

function isTrustedProxy(address: string, networks: string[]) {
  return networks.some((network) => addressMatchesNetwork(address, network))
}

export function resolveYooKassaWebhookSourceIp(input: {
  remoteAddress?: string | null
  forwardedFor?: string | string[]
  realIp?: string | string[]
  trustedNetworks?: string[]
}) {
  const remoteAddress = normalizeRemoteAddress(input.remoteAddress)
  const networks = input.trustedNetworks ?? trustedProxyNetworks()

  if (!remoteAddress || !isTrustedProxy(remoteAddress, networks)) {
    return remoteAddress
  }

  const forwarded = (Array.isArray(input.forwardedFor)
    ? input.forwardedFor.join(",")
    : input.forwardedFor ?? ""
  )
    .split(",")
    .map(normalizeRemoteAddress)
    .filter(Boolean)

  // Some reverse proxies pass the original client address in X-Real-IP but
  // omit X-Forwarded-For. Only use that header after the TCP peer has already
  // matched an explicitly trusted proxy network, just like the XFF chain.
  const realIp = normalizeRemoteAddress(
    Array.isArray(input.realIp) ? input.realIp.join(",") : input.realIp
  )

  if (!forwarded.length && realIp) {
    return realIp
  }

  let candidate = remoteAddress

  for (let index = forwarded.length - 1; index >= 0; index -= 1) {
    if (!isTrustedProxy(candidate, networks)) {
      break
    }

    candidate = forwarded[index]
  }

  return candidate
}
