import {
  readMoyskladProbeCredentials,
  runMoyskladReadOnlyProbe,
} from "../probe-deep"

describe("MoySklad read-only live probe", () => {
  it("does not access the API when credentials are absent", async () => {
    const fetch = jest.fn()

    const report = await runMoyskladReadOnlyProbe({
      environment: {},
      fetch,
    })

    expect(fetch).not.toHaveBeenCalled()
    expect(report.results).toEqual([])
    expect(report.missingVariables).toEqual([
      "MOYSKLAD_TOKEN",
      "MOYSKLAD_LOGIN",
      "MOYSKLAD_PASSWORD",
    ])
  })

  it("accepts login and password when a token is not configured", () => {
    expect(
      readMoyskladProbeCredentials({
        MOYSKLAD_LOGIN: "owner@example.com",
        MOYSKLAD_PASSWORD: "password",
      })
    ).toEqual({
      credentials: {
        type: "basic",
        login: "owner@example.com",
        password: "password",
      },
      missingVariables: [],
    })
  })
})
