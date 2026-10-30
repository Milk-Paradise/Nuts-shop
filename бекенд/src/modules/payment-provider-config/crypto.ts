import {
  decryptSecret,
  encryptSecret,
  SecretCryptoError,
} from "../../lib/secret-crypto"

export class PaymentProviderConfigEncryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PaymentProviderConfigEncryptionError"
  }
}

function paymentEncryption<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof SecretCryptoError) {
      throw new PaymentProviderConfigEncryptionError(error.message)
    }
    throw new PaymentProviderConfigEncryptionError(
      error instanceof Error
        ? error.message
        : "Payment provider secret could not be encrypted or decrypted"
    )
  }
}

export function encryptPaymentProviderSecret(secret: string) {
  return paymentEncryption(() => encryptSecret(secret))
}

export function readPaymentProviderSecret(
  encryptedSecret: string
): { plaintext: string; reencrypted?: string } {
  return paymentEncryption(() =>
    decryptSecret(encryptedSecret, "payment-provider-config")
  )
}

export function decryptPaymentProviderSecret(encryptedSecret: string) {
  return readPaymentProviderSecret(encryptedSecret).plaintext
}
