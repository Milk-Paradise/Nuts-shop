import {
  emailChannelDescription,
  hasSellerNotificationChannel,
  notificationChannelErrorReason,
} from "../notification-channel-settings"

describe("seller notification channel warning", () => {
  it("shows the warning when neither seller channel is configured", () => {
    expect(
      hasSellerNotificationChannel({ email: null, telegram: null })
    ).toBe(false)
  })

  it.each([
    { email: "seller@example.test", telegram: null },
    { email: null, telegram: "123456" },
  ])("hides the warning when a seller channel exists", (seller) => {
    expect(hasSellerNotificationChannel(seller)).toBe(true)
  })
})

describe("channel verification error", () => {
  it("preserves the reason returned by the backend", () => {
    expect(
      notificationChannelErrorReason(
        new Error("Telegram rejected the bot token: 401 Unauthorized")
      )
    ).toBe("Telegram rejected the bot token: 401 Unauthorized")
  })
})

describe("email channel description", () => {
  it.each([
    [{ sender: "orders@example.test", sender_fallback: "server@example.test" }, "orders@example.test"],
    [{ sender_fallback: "server@example.test" }, "server@example.test (из настроек сервера)"],
    [{ sender: "", sender_fallback: "server@example.test" }, "server@example.test (из настроек сервера)"],
    [{}, "Адрес отправителя не указан"],
    [{ sender: "", sender_fallback: "" }, "Адрес отправителя не указан"],
  ])("renders the effective sender for %j", (configuration, sender) => {
    expect(emailChannelDescription(configuration)).toBe(
      `${sender} · Имя отправителя — из профиля магазина в CMS`
    )
  })
})
