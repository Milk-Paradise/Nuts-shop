import {
  NOTIFICATION_JOURNAL_API_PATH,
  notificationAttemptResultLabels,
} from "../notifications"

describe("notification journal UI contract", () => {
  it("uses a custom API namespace outside Medusa notifications", () => {
    expect(NOTIFICATION_JOURNAL_API_PATH).toBe("/admin/notification-journal")
    expect(NOTIFICATION_JOURNAL_API_PATH.startsWith("/admin/notifications")).toBe(false)
  })

  it("shows localized attempt results", () => {
    expect(notificationAttemptResultLabels).toEqual({
      success: "успех",
      temporary_failure: "временная ошибка",
      permanent_failure: "окончательная",
      unknown: "результат неизвестен",
    })
  })
})
