import { MedusaError } from "@medusajs/framework/utils"

import { MoyskladApiError } from "../client"
import { classifyMoyskladOrderSyncError } from "../order-sync-error"

describe("classifyMoyskladOrderSyncError", () => {
  it("classifies every MoySklad 400 response as a data error, including code 3000", () => {
    expect(
      classifyMoyskladOrderSyncError(
        new MoyskladApiError('{"errors":[{"code":3000}]}', 400)
      )
    ).toBe("data")
  })

  it("classifies a local INVALID_DATA error as a data error", () => {
    expect(
      classifyMoyskladOrderSyncError(
        new MedusaError(MedusaError.Types.INVALID_DATA, "bad quantity")
      )
    ).toBe("data")
  })

  it.each([
    new MoyskladApiError("service unavailable", 503),
    new MoyskladApiError("network unavailable"),
  ])("classifies service unavailability as temporary", (error) => {
    expect(classifyMoyskladOrderSyncError(error)).toBe("temporary")
  })

  it("defaults an unrecognized error to temporary", () => {
    expect(classifyMoyskladOrderSyncError(new Error("unknown"))).toBe(
      "temporary"
    )
  })
})
