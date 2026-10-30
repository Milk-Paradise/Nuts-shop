import {
  addressMatchesNetwork,
  isYooKassaWebhookIp,
  normalizeRemoteAddress,
  resolveYooKassaWebhookSourceIp,
} from "../source-ip"

describe("YooKassa webhook source IP", () => {
  it.each([
    "185.71.76.0",
    "185.71.76.31",
    "185.71.77.12",
    "77.75.153.127",
    "77.75.154.128",
    "77.75.154.255",
    "77.75.156.11",
    "77.75.156.35",
    "2a02:5180::1",
    "2a02:5180:ffff:ffff:ffff:ffff:ffff:ffff",
  ])("accepts official address %s", (address) => {
    expect(isYooKassaWebhookIp(address)).toBe(true)
  })

  it.each([
    "185.71.76.32",
    "77.75.153.128",
    "77.75.156.10",
    "127.0.0.1",
    "2a02:5181::1",
    "not-an-ip",
    "",
  ])("rejects foreign or invalid address %s", (address) => {
    expect(isYooKassaWebhookIp(address)).toBe(false)
  })

  it("normalizes IPv4-mapped and scoped remote addresses", () => {
    expect(normalizeRemoteAddress("::ffff:77.75.156.11")).toBe("77.75.156.11")
    expect(normalizeRemoteAddress("2a02:5180::1%en0")).toBe("2a02:5180::1")
  })

  it("fails closed for an IPv4-embedded IPv6 textual form", () => {
    expect(() => isYooKassaWebhookIp("::192.0.2.1")).not.toThrow()
    expect(isYooKassaWebhookIp("::192.0.2.1")).toBe(false)
  })

  it("ignores spoofed forwarding headers from an untrusted peer", () => {
    expect(
      resolveYooKassaWebhookSourceIp({
        remoteAddress: "127.0.0.1",
        forwardedFor: "77.75.156.11",
        realIp: "77.75.156.35",
        trustedNetworks: [],
      })
    ).toBe("127.0.0.1")
  })

  it("uses X-Real-IP when a trusted proxy omits X-Forwarded-For", () => {
    expect(
      resolveYooKassaWebhookSourceIp({
        remoteAddress: "10.0.1.3",
        realIp: "77.75.156.11",
        trustedNetworks: ["10.0.1.3/32"],
      })
    ).toBe("77.75.156.11")
  })

  it("prefers the trusted X-Forwarded-For chain over X-Real-IP", () => {
    expect(
      resolveYooKassaWebhookSourceIp({
        remoteAddress: "10.0.1.3",
        forwardedFor: "77.75.156.11",
        realIp: "203.0.113.17",
        trustedNetworks: ["10.0.1.3/32"],
      })
    ).toBe("77.75.156.11")
  })

  it("walks a forwarding chain only through explicitly trusted proxies", () => {
    expect(
      resolveYooKassaWebhookSourceIp({
        remoteAddress: "10.0.0.2",
        forwardedFor: "77.75.156.11, 10.0.0.1",
        trustedNetworks: ["10.0.0.0/8"],
      })
    ).toBe("77.75.156.11")
  })

  it("normalizes absent, whitespace, uppercase mapped, and scoped addresses", () => {
    expect(normalizeRemoteAddress(null)).toBe("")
    expect(normalizeRemoteAddress(undefined)).toBe("")
    expect(normalizeRemoteAddress("  ::FFFF:77.75.156.11  ")).toBe("77.75.156.11")
    expect(normalizeRemoteAddress("fe80::1%eth0")).toBe("fe80::1")
  })

  it.each([
    ["10.0.0.1", "10.0.0.0/8", true],
    ["10.0.0.1", "10.0.0.0/33", false],
    ["10.0.0.1", "10.0.0.0/-1", false],
    ["10.0.0.1", "10.0.0.0/not-a-prefix", false],
    ["10.0.0.1", "2a02:5180::/32", false],
    ["not-an-ip", "10.0.0.0/8", false],
    ["2a02:5180::1", "2a02:5180::/0", true],
    ["2a02:5180::1", "2a02:5180::/128", false],
  ])("matches %s against %s", (address, network, expected) => {
    expect(addressMatchesNetwork(address, network)).toBe(expected)
  })

  it("uses trusted proxy CIDRs from the environment and accepts array forwarding headers", () => {
    process.env.YOOKASSA_WEBHOOK_TRUSTED_PROXY_CIDRS = " 10.0.0.0/8, ,192.168.0.0/16 "
    expect(resolveYooKassaWebhookSourceIp({
      remoteAddress: "10.0.0.2",
      forwardedFor: ["77.75.156.11", "192.168.0.1"],
    })).toBe("77.75.156.11")
    delete process.env.YOOKASSA_WEBHOOK_TRUSTED_PROXY_CIDRS
  })

  it("returns an empty peer and stops walking once the first untrusted hop is reached", () => {
    expect(resolveYooKassaWebhookSourceIp({ remoteAddress: null })).toBe("")
    expect(resolveYooKassaWebhookSourceIp({
      remoteAddress: "10.0.0.2",
      forwardedFor: "77.75.156.11, 203.0.113.9, 10.0.0.1",
      trustedNetworks: ["10.0.0.0/8"],
    })).toBe("203.0.113.9")
  })
})
