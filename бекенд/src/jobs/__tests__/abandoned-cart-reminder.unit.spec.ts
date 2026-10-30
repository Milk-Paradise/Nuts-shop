import {
  default as abandonedCartReminderJob,
  isDueForReminder,
  SEVEN_DAYS_MS,
  type CandidateCart,
  type ExistingReminder,
} from "../abandoned-cart-reminder"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { ABANDONED_CART_REMINDER_MODULE } from "../../modules/abandoned-cart-reminder"

const NOW = new Date("2026-07-22T00:00:00.000Z").getTime()
const EIGHT_DAYS_AGO = new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString()
const ONE_DAY_AGO = new Date(NOW - 1 * 24 * 60 * 60 * 1000).toISOString()

function cart(overrides: Partial<CandidateCart> = {}): CandidateCart {
  return {
    id: "cart_1",
    customer_id: "cus_1",
    customer: { id: "cus_1", email: "buyer@test.com", has_account: true, metadata: null },
    updated_at: EIGHT_DAYS_AGO,
    metadata: null,
    items: [{ id: "item_1" }],
    ...overrides,
  }
}

describe("isDueForReminder", () => {
  it("is due when the cart has been quiet for 7+ days and was never reminded", () => {
    expect(isDueForReminder(cart(), undefined, NOW)).toBe(true)
  })

  it("is not due for a quick purchase, however long it has been abandoned", () => {
    // Everything else about this cart qualifies — registered customer, an item,
    // quiet for over a week. Only the one_click marker keeps the mail away.
    expect(
      isDueForReminder(cart({ metadata: { one_click: true } }), undefined, NOW)
    ).toBe(false)
  })

  it("is still due for an ordinary cart whose metadata is set but not one_click", () => {
    expect(
      isDueForReminder(cart({ metadata: { one_click: false, source: "web" } }), undefined, NOW)
    ).toBe(true)
    expect(isDueForReminder(cart({ metadata: { note: "gift" } }), undefined, NOW)).toBe(true)
    // A truthy-but-not-true value must not be mistaken for the marker.
    expect(
      isDueForReminder(cart({ metadata: { one_click: "true" } }), undefined, NOW)
    ).toBe(true)
  })

  it("is not due when the cart was updated less than 7 days ago", () => {
    expect(isDueForReminder(cart({ updated_at: ONE_DAY_AGO }), undefined, NOW)).toBe(false)
  })

  it("is not due exactly at the 7-day boundary minus a millisecond", () => {
    const justUnderSevenDays = new Date(NOW - SEVEN_DAYS_MS + 1).toISOString()
    expect(isDueForReminder(cart({ updated_at: justUnderSevenDays }), undefined, NOW)).toBe(false)
  })

  it("is not due without a customer", () => {
    expect(isDueForReminder(cart({ customer_id: null, customer: null }), undefined, NOW)).toBe(false)
  })

  it("is not due without a customer email", () => {
    expect(
      isDueForReminder(
        cart({ customer: { id: "cus_1", email: null, has_account: true, metadata: null } }),
        undefined,
        NOW
      )
    ).toBe(false)
  })

  it("is not due for a guest cart (email captured but no registered account)", () => {
    expect(
      isDueForReminder(
        cart({
          customer: { id: "cus_1", email: "guest@test.com", has_account: false, metadata: null },
        }),
        undefined,
        NOW
      )
    ).toBe(false)
  })

  it("is not due for an empty cart", () => {
    expect(isDueForReminder(cart({ items: [] }), undefined, NOW)).toBe(false)
  })

  it("is not due when the customer opted out of reminders", () => {
    const optedOutCart = cart({
      customer: {
        id: "cus_1",
        email: "buyer@test.com",
        has_account: true,
        metadata: { abandoned_cart_reminders_opt_out: true },
      },
    })
    expect(isDueForReminder(optedOutCart, undefined, NOW)).toBe(false)
  })

  it("is not due again when already reminded and the cart hasn't changed since", () => {
    const existing: ExistingReminder = { cart_updated_at_at_send: EIGHT_DAYS_AGO }
    expect(isDueForReminder(cart(), existing, NOW)).toBe(false)
  })

  it("is due again once the cart was modified after the last reminder and is quiet for 7 more days", () => {
    const modifiedAfterSend = new Date(NOW - 8 * 24 * 60 * 60 * 1000 + 60 * 1000).toISOString()
    const existing: ExistingReminder = {
      cart_updated_at_at_send: new Date(NOW - 15 * 24 * 60 * 60 * 1000).toISOString(),
    }
    expect(isDueForReminder(cart({ updated_at: modifiedAfterSend }), existing, NOW)).toBe(true)
  })

  it("is not due when modified after the last reminder but not yet quiet for 7 days", () => {
    const existing: ExistingReminder = {
      cart_updated_at_at_send: new Date(NOW - 15 * 24 * 60 * 60 * 1000).toISOString(),
    }
    expect(isDueForReminder(cart({ updated_at: ONE_DAY_AGO }), existing, NOW)).toBe(false)
  })
})

describe("abandonedCartReminderJob", () => {
  const originalJwtSecret = process.env.JWT_SECRET

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret"
    jest.spyOn(Date, "now").mockReturnValue(NOW)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET
    } else {
      process.env.JWT_SECRET = originalJwtSecret
    }
  })

  it("does not record a failed send and continues with the remaining carts", async () => {
    const failedCart = cart({ id: "cart_failed" })
    const successfulCart = cart({ id: "cart_success" })
    const query = {
      graph: jest.fn().mockResolvedValue({ data: [failedCart, successfulCart] }),
    }
    const notification = {
      createNotifications: jest
        .fn()
        .mockRejectedValueOnce(new Error("smtp down"))
        .mockResolvedValueOnce([{ id: "notification_2" }]),
    }
    const reminderService = {
      listAbandonedCartReminders: jest.fn().mockResolvedValue([]),
      createAbandonedCartReminders: jest.fn().mockResolvedValue({}),
      updateAbandonedCartReminders: jest.fn(),
    }
    const logger = { error: jest.fn() }
    const container = {
      resolve: jest.fn((key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) return query
        if (key === Modules.NOTIFICATION) return notification
        if (key === ABANDONED_CART_REMINDER_MODULE) return reminderService
        if (key === "logger") return logger
        throw new Error(`Unexpected container key: ${key}`)
      }),
    }

    await expect(abandonedCartReminderJob(container as never)).resolves.toBeUndefined()

    expect(notification.createNotifications).toHaveBeenCalledTimes(2)
    expect(reminderService.createAbandonedCartReminders).toHaveBeenCalledTimes(1)
    expect(reminderService.createAbandonedCartReminders).toHaveBeenCalledWith(
      expect.objectContaining({ cart_id: "cart_success" })
    )
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("cart_failed"))
  })
})
