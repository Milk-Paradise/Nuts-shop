import type {
  IAuthModuleService,
  ICacheService,
  ILockingModule,
  MedusaContainer,
} from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export type ChangeCustomerPasswordInput = {
  auth_identity_id: string
  current_password: string
  new_password: string
}

type FailedAttempts = {
  count: number
}

const EMAILPASS_PROVIDER = "emailpass"
const FAILED_ATTEMPT_LIMIT = 5
const FAILED_ATTEMPT_TTL_SECONDS = 15 * 60
const INVALID_CURRENT_PASSWORD_MESSAGE = "Неверный текущий пароль"
export const TOO_MANY_ATTEMPTS_MESSAGE =
  "Слишком много попыток. Попробуйте сменить пароль через 15 минут."

function failedAttemptsKey(authIdentityId: string) {
  return `account-password-change:failed:${authIdentityId}`
}

function rateLimitLockKey(authIdentityId: string) {
  return `account-password-change:lock:${authIdentityId}`
}

function unauthorized(): never {
  throw new MedusaError(
    MedusaError.Types.UNAUTHORIZED,
    INVALID_CURRENT_PASSWORD_MESSAGE
  )
}

/**
 * A tripped rate limit answers differently from a wrong password on purpose.
 *
 * Anti-enumeration does not apply here: the caller is already authenticated, so
 * saying "wait 15 minutes" leaks nothing about which accounts exist or how the
 * typed value differed. Saying "wrong password" instead does real harm — the
 * customer then types the *correct* password, is told it is wrong, and has no
 * way to learn that waiting is what fixes it.
 */
function tooManyAttempts(): never {
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    TOO_MANY_ATTEMPTS_MESSAGE
  )
}

export async function changeCustomerPassword(
  container: MedusaContainer,
  input: ChangeCustomerPasswordInput
): Promise<void> {
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH)
  const cache = container.resolve<ICacheService>(Modules.CACHE)
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const attemptsKey = failedAttemptsKey(input.auth_identity_id)

  await locking.execute(rateLimitLockKey(input.auth_identity_id), async () => {
    const attempts = await cache.get<FailedAttempts>(attemptsKey)
    if ((attempts?.count ?? 0) >= FAILED_ATTEMPT_LIMIT) {
      tooManyAttempts()
    }

    const identity = await auth.retrieveAuthIdentity(input.auth_identity_id, {
      relations: ["provider_identities"],
    })
    const providerIdentity = identity.provider_identities?.find(
      (candidate) => candidate.provider === EMAILPASS_PROVIDER
    )

    if (!providerIdentity) {
      unauthorized()
    }

    const authentication = await auth.authenticate(EMAILPASS_PROVIDER, {
      body: {
        email: providerIdentity.entity_id,
        password: input.current_password,
      },
    })

    if (
      !authentication.success ||
      authentication.authIdentity?.id !== input.auth_identity_id
    ) {
      await cache.set(
        attemptsKey,
        { count: (attempts?.count ?? 0) + 1 },
        FAILED_ATTEMPT_TTL_SECONDS
      )
      unauthorized()
    }

    // Issuing a token invalidates every older reset token for this provider
    // identity. Immediately consuming the replacement leaves no hidden usable
    // token and uses the same single-use mechanism as Medusa's core reset flow.
    const replacementResetToken = await auth.createPasswordResetToken({
      provider: EMAILPASS_PROVIDER,
      entity_id: providerIdentity.entity_id,
      ttl_seconds: 1,
    })
    await auth.consumePasswordResetToken({
      jti: replacementResetToken.jti,
      provider: EMAILPASS_PROVIDER,
      entity_id: providerIdentity.entity_id,
    })
    await cache.invalidate(attemptsKey)

    const update = await auth.updateProvider(EMAILPASS_PROVIDER, {
      entity_id: providerIdentity.entity_id,
      password: input.new_password,
    })

    if (!update.success || update.authIdentity?.id !== input.auth_identity_id) {
      unauthorized()
    }
  })
}

export const changeCustomerPasswordStep = createStep(
  "change-customer-password",
  async (input: ChangeCustomerPasswordInput, { container }) => {
    await changeCustomerPassword(container, input)
    return new StepResponse({ success: true })
  }
)
