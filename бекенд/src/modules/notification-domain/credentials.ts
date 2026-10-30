import { decryptSecret, encryptSecret } from "../../lib/secret-crypto"

export function encryptNotificationCredentials(
  credentials: Record<string, unknown>
) {
  return encryptSecret(JSON.stringify(credentials))
}

export function decryptNotificationCredentials(encrypted: string) {
  const { plaintext } = decryptSecret(encrypted)
  return JSON.parse(plaintext) as Record<string, unknown>
}
