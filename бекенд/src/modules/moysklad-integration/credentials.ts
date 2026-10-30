import { MedusaError } from "@medusajs/framework/utils"
import { decryptSecret, encryptSecret, SecretCryptoError } from "../../lib/secret-crypto"

export type MoyskladCredentials =
  | {
      type: "token"
      token: string
    }
  | {
      type: "basic"
      login: string
      password: string
    }

export type MoyskladCredentialsStatus = "configured" | "needs_reentry"

export class MoyskladCredentialsReentryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MoyskladCredentialsReentryError"
  }
}

function validateCredentials(credentials: MoyskladCredentials) {
  if (credentials.type === "token" && credentials.token) {
    return
  }

  if (
    credentials.type === "basic" &&
    credentials.login &&
    credentials.password
  ) {
    return
  }

  throw new MedusaError(
    MedusaError.Types.INVALID_ARGUMENT,
    "Provide either a MoySklad token or a login and password."
  )
}

export function encryptMoyskladCredentials(credentials: MoyskladCredentials) {
  validateCredentials(credentials)
  return encryptSecret(JSON.stringify(credentials))
}

export function readMoyskladCredentials(
  encryptedCredentials: string
): {
  credentials: MoyskladCredentials
  reencryptedCredentials?: string
} {
  try {
    const decrypted = decryptSecret(encryptedCredentials, "moysklad-integration")
    const credentials = JSON.parse(decrypted.plaintext) as MoyskladCredentials

    validateCredentials(credentials)

    return {
      credentials,
      ...(decrypted.reencrypted
        ? { reencryptedCredentials: decrypted.reencrypted }
        : {}),
    }
  } catch (error) {
    if (error instanceof MedusaError) {
      if (error.message.startsWith("Provide either")) {
        throw new MoyskladCredentialsReentryError(
          "Stored MoySklad credentials are invalid. Enter the credentials again."
        )
      }
      throw error
    }
    if (error instanceof SecretCryptoError) {
      // If v2: format failed decryption, it's a PRIMARY KEY issue
      if (encryptedCredentials.startsWith("v2:") && error.message.includes("could not be decrypted")) {
        throw new MoyskladCredentialsReentryError(
          "Stored secret cannot be decrypted with SECRET_ENCRYPTION_KEY"
        )
      }
      // If v1. or v1: format failed, it's a LEGACY KEY issue
      if ((encryptedCredentials.startsWith("v1.") || encryptedCredentials.startsWith("v1:")) && error.message.includes("could not be decrypted")) {
        throw new MoyskladCredentialsReentryError(
          "Stored MoySklad credentials cannot be decrypted with MOYSKLAD_ENCRYPTION_KEY. Enter the credentials again."
        )
      }
      if (error.message.includes("invalid encryption format")) {
        throw new MoyskladCredentialsReentryError(
          "Stored MoySklad credentials have an invalid encryption format. Enter the credentials again."
        )
      }
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        error.message
      )
    }

    throw new MedusaError(
      MedusaError.Types.INVALID_ARGUMENT,
      error instanceof Error
        ? error.message
        : "Stored MoySklad credentials cannot be decrypted."
    )
  }
}

export function decryptMoyskladCredentials(
  encryptedCredentials: string
): MoyskladCredentials {
  return readMoyskladCredentials(encryptedCredentials).credentials
}
