type ModuleConfig = {
  resolve?: string
  disable?: boolean
  options?: {
    providers?: Array<{
      options?: {
        email?: { provider?: string; options?: Record<string, unknown> }
      }
    }>
  }
}
type ResolvedConfig = { modules: Record<string, ModuleConfig> }

describe("medusa-config rbac module gate", () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalRbacFlag = process.env.MEDUSA_FF_RBAC
  const originalE2eRun = process.env.E2E_RUN
  const originalNotificationStubUrl = process.env.E2E_NOTIFICATION_STUB_URL

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    if (originalRbacFlag === undefined) {
      delete process.env.MEDUSA_FF_RBAC
    } else {
      process.env.MEDUSA_FF_RBAC = originalRbacFlag
    }
    if (originalE2eRun === undefined) delete process.env.E2E_RUN
    else process.env.E2E_RUN = originalE2eRun
    if (originalNotificationStubUrl === undefined) {
      delete process.env.E2E_NOTIFICATION_STUB_URL
    } else {
      process.env.E2E_NOTIFICATION_STUB_URL = originalNotificationStubUrl
    }
    jest.resetModules()
  })

  function loadConfig() {
    jest.resetModules()
    return require("../../medusa-config")
  }

  // Regression test for the bug this config gate works around: Medusa's own
  // MEDUSA_FF_RBAC auto-detection resolves the rbac module's `disable` flag
  // before the built-in feature flag is registered, so it's always disabled
  // unless declared explicitly (see the comment in medusa-config.ts).
  it("enables the rbac module when MEDUSA_FF_RBAC=true", () => {
    process.env.NODE_ENV = "development"
    process.env.MEDUSA_FF_RBAC = "true"

    const config = loadConfig() as ResolvedConfig

    expect(config.modules.rbac).toBeDefined()
    expect(config.modules.rbac.disable).toBe(false)
  })

  it("disables the rbac module when MEDUSA_FF_RBAC is not \"true\"", () => {
    // Not `delete`: medusa-config.ts's own `loadEnv()` call would just reload
    // it from apps/backend/.env (which sets it to "true" for local dev/compose).
    process.env.NODE_ENV = "development"
    process.env.MEDUSA_FF_RBAC = "false"

    const config = loadConfig() as ResolvedConfig

    expect(config.modules.rbac).toBeDefined()
    expect(config.modules.rbac.disable).toBe(true)
  })

  it("configures the domain provider with the e2e email adapter in tests", () => {
    process.env.NODE_ENV = "test"
    process.env.E2E_NOTIFICATION_STUB_URL = "http://notification-stub.test"

    const config = loadConfig() as ResolvedConfig
    const email = config.modules.notification.options?.providers?.[0].options?.email

    expect(email).toEqual({
      provider: "e2e",
      options: { base_url: "http://notification-stub.test" },
    })
  })

  it("configures the domain provider with the smtp email adapter outside tests", () => {
    process.env.NODE_ENV = "development"
    process.env.E2E_RUN = "false"

    const config = loadConfig() as ResolvedConfig
    const email = config.modules.notification.options?.providers?.[0].options?.email

    expect(email?.provider).toBe("smtp")
  })
})
