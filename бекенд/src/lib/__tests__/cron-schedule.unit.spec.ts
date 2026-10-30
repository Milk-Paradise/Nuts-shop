import { isCronDue } from "../cron-schedule"

describe("isCronDue", () => {
  it("matches a configured minute and hour", () => {
    expect(isCronDue("15 3 * * *", new Date(2026, 9, 8, 3, 15))).toBe(true)
    expect(isCronDue("15 3 * * *", new Date(2026, 9, 8, 3, 16))).toBe(false)
  })

  it("supports lists, ranges, and steps", () => {
    expect(isCronDue("*/15 9-17 * * 1-5", new Date(2026, 9, 9, 10, 30))).toBe(true)
    expect(isCronDue("*/15 9-17 * * 1-5", new Date(2026, 9, 10, 10, 30))).toBe(false)
  })

  it("rejects malformed expressions", () => {
    expect(isCronDue("not a cron", new Date(2026, 9, 8, 3, 15))).toBe(false)
    expect(isCronDue("* * * * * *", new Date(2026, 9, 8, 3, 15))).toBe(false)
  })
})
