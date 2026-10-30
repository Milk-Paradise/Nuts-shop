import { MedusaError, Modules } from "@medusajs/framework/utils"

import { changeCustomerPassword } from "../change-customer-password"

const currentPassword = "current-secret"
const newPassword = "new-secret-value"

function fixture() {
  const cacheValues = new Map<string, unknown>()
  const cache = {
    get: jest.fn(async (key: string) => cacheValues.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      cacheValues.set(key, value)
    }),
    invalidate: jest.fn(async (key: string) => {
      cacheValues.delete(key)
    }),
  }
  const locking = {
    execute: jest.fn(async (_key: string, job: () => Promise<unknown>) => job()),
  }
  const auth = {
    retrieveAuthIdentity: jest.fn().mockResolvedValue({
      id: "auth_session",
      provider_identities: [
        {
          id: "provider_session",
          provider: "emailpass",
          entity_id: "session@example.test",
        },
      ],
    }),
    authenticate: jest.fn().mockResolvedValue({
      success: true,
      authIdentity: { id: "auth_session" },
    }),
    createPasswordResetToken: jest.fn().mockResolvedValue({
      jti: "replacement-jti",
      expires_at: new Date(Date.now() + 1000),
    }),
    consumePasswordResetToken: jest.fn().mockResolvedValue({
      auth_identity_id: "auth_session",
      provider_identity_id: "provider_session",
      entity_id: "session@example.test",
    }),
    updateProvider: jest.fn().mockResolvedValue({
      success: true,
      authIdentity: { id: "auth_session" },
    }),
  }
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === Modules.AUTH) return auth
      if (key === Modules.CACHE) return cache
      if (key === Modules.LOCKING) return locking
      if (key === "logger") return logger
      throw new Error(`Unexpected dependency: ${key}`)
    }),
  } as any

  return { auth, cache, cacheValues, container, logger }
}

function change(container: any, overrides: Record<string, string> = {}) {
  return changeCustomerPassword(container, {
    auth_identity_id: "auth_session",
    current_password: currentPassword,
    new_password: newPassword,
    ...overrides,
  })
}

describe("changeCustomerPassword", () => {
  it("verifies the current password and updates only the session identity through emailpass", async () => {
    const { auth, cache, container } = fixture()

    await expect(change(container)).resolves.toBeUndefined()

    expect(auth.retrieveAuthIdentity).toHaveBeenCalledWith("auth_session", {
      relations: ["provider_identities"],
    })
    expect(auth.authenticate).toHaveBeenCalledWith("emailpass", {
      body: { email: "session@example.test", password: currentPassword },
    })
    expect(auth.updateProvider).toHaveBeenCalledWith("emailpass", {
      entity_id: "session@example.test",
      password: newPassword,
    })
    expect(auth.consumePasswordResetToken.mock.invocationCallOrder[0]).toBeLessThan(
      auth.updateProvider.mock.invocationCallOrder[0]
    )
    expect(cache.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      auth.updateProvider.mock.invocationCallOrder[0]
    )
  })

  it("rejects a foreign auth result without changing either password", async () => {
    const { auth, container } = fixture()
    auth.authenticate.mockResolvedValue({
      success: true,
      authIdentity: { id: "auth_foreign" },
    })

    await expect(change(container)).rejects.toBeInstanceOf(MedusaError)

    expect(auth.createPasswordResetToken).not.toHaveBeenCalled()
    expect(auth.updateProvider).not.toHaveBeenCalled()
  })

  it("limits failed current-password attempts and never calls auth after the fifth failure", async () => {
    const { auth, cache, container } = fixture()
    auth.authenticate.mockResolvedValue({ success: false, error: currentPassword })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(change(container)).rejects.toThrow("Неверный текущий пароль")
    }
    // Шестая попытка отвечает иначе: покупатель, исчерпавший лимит, должен
    // узнать, что чинится это ожиданием, а не перенабором пароля.
    await expect(change(container)).rejects.toThrow(
      "Слишком много попыток. Попробуйте сменить пароль через 15 минут."
    )
    await expect(change(container)).rejects.toMatchObject({ type: "not_allowed" })

    expect(auth.authenticate).toHaveBeenCalledTimes(5)
    expect(auth.updateProvider).not.toHaveBeenCalled()
    expect(cache.set).toHaveBeenLastCalledWith(
      "account-password-change:failed:auth_session",
      { count: 5 },
      15 * 60
    )
  })

  it("does not expose either password or provider diagnostics in errors or logs", async () => {
    const { auth, container, logger } = fixture()
    auth.authenticate.mockResolvedValue({
      success: false,
      error: `provider rejected ${currentPassword}`,
    })

    let thrown: unknown
    try {
      await change(container)
    } catch (error) {
      thrown = error
    }

    const diagnostics = JSON.stringify({ thrown, loggerCalls: logger })
    const errorText = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)
    expect(diagnostics).not.toContain(currentPassword)
    expect(diagnostics).not.toContain(newPassword)
    expect(errorText).not.toContain(currentPassword)
    expect(errorText).not.toContain(newPassword)
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.debug).not.toHaveBeenCalled()
  })

  it("invalidates an older reset token and allows a token issued after the change", async () => {
    const { auth, container } = fixture()
    const validResetTokens = new Set(["old-jti"])
    let sequence = 0
    auth.createPasswordResetToken.mockImplementation(async () => {
      validResetTokens.clear()
      sequence += 1
      const jti = `new-jti-${sequence}`
      validResetTokens.add(jti)
      return { jti, expires_at: new Date(Date.now() + 1000) }
    })
    auth.consumePasswordResetToken.mockImplementation(async ({ jti }) => {
      if (!validResetTokens.delete(jti)) {
        throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Invalid token")
      }
      return {
        auth_identity_id: "auth_session",
        provider_identity_id: "provider_session",
        entity_id: "session@example.test",
      }
    })

    await change(container)

    await expect(
      auth.consumePasswordResetToken({
        jti: "old-jti",
        provider: "emailpass",
        entity_id: "session@example.test",
      })
    ).rejects.toMatchObject({
      type: MedusaError.Types.UNAUTHORIZED,
      message: "Invalid token",
    })

    const later = await auth.createPasswordResetToken({
      provider: "emailpass",
      entity_id: "session@example.test",
      ttl_seconds: 900,
    })
    await expect(
      auth.consumePasswordResetToken({
        jti: later.jti,
        provider: "emailpass",
        entity_id: "session@example.test",
      })
    ).resolves.toBeDefined()
  })
})
