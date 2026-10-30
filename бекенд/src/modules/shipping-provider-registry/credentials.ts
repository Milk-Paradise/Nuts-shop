import { MedusaError } from "@medusajs/framework/utils"
import { decryptSecret, encryptSecret, SecretCryptoError } from "../../lib/secret-crypto"

export type ShippingProviderCredentials = {
  client_id: string
  client_secret: string
}

function validateCredentials(credentials: ShippingProviderCredentials) {
  if (credentials.client_id.trim() && credentials.client_secret) {
    return
  }

  throw new MedusaError(
    MedusaError.Types.INVALID_ARGUMENT,
    "CDEK client_id and client_secret are required."
  )
}

export function encryptShippingProviderCredentials(
  credentials: ShippingProviderCredentials
) {
  validateCredentials(credentials)
  return encryptSecret(JSON.stringify(credentials))
}

export function readShippingProviderCredentials(
  encryptedCredentials: string
): {
  credentials: ShippingProviderCredentials
  reencryptedCredentials?: string
} {
  try {
    const decrypted = decryptSecret(
      encryptedCredentials,
      "shipping-provider-config"
    )
    const credentials = JSON.parse(decrypted.plaintext) as ShippingProviderCredentials
    validateCredentials(credentials)
    return {
      credentials,
      ...(decrypted.reencrypted
        ? { reencryptedCredentials: decrypted.reencrypted }
        : {}),
    }
  } catch (error) {
    if (error instanceof MedusaError) throw error
    if (error instanceof SecretCryptoError) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        error.message
      )
    }
    throw new MedusaError(
      MedusaError.Types.INVALID_ARGUMENT,
      error instanceof Error
        ? error.message
        : "Stored shipping provider credentials cannot be decrypted."
    )
  }
}

export function decryptShippingProviderCredentials(
  encryptedCredentials: string
): ShippingProviderCredentials {
  return readShippingProviderCredentials(encryptedCredentials).credentials
}

export function maskShippingProviderSecret(value: string) {
  if (value.length <= 8) return "*".repeat(value.length)
  return `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`
}
