import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const AUTH_TAG_LENGTH = 16
const IV_LENGTH = 12
const PRIMARY_KEY_ENVIRONMENT_VARIABLE = "SECRET_ENCRYPTION_KEY"
const CURRENT_FORMAT = "v2"

type Encoding = "base64" | "base64url"

const legacySecretConfigurations = {
  "payment-provider-config": {
    environmentVariable: "PAYMENT_PROVIDER_CONFIG_ENCRYPTION_KEY",
    encoding: "base64" as const,
    separator: ":",
    key: (value: string, environmentVariable: string) =>
      parseBase64EncryptionKey(value, environmentVariable),
    cannotDecryptMessage:
      "Stored payment provider secret cannot be decrypted with PAYMENT_PROVIDER_CONFIG_ENCRYPTION_KEY. Enter the secret again.",
  },
  "shipping-provider-config": {
    environmentVariable: "SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY",
    encoding: "base64url" as const,
    separator: ".",
    key: (value: string) => createHash("sha256").update(value).digest(),
    cannotDecryptMessage:
      "Stored shipping provider credentials cannot be decrypted with SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY. Enter the credentials again.",
  },
  "moysklad-integration": {
    environmentVariable: "MOYSKLAD_ENCRYPTION_KEY",
    encoding: "base64url" as const,
    separator: ".",
    key: (value: string) => createHash("sha256").update(value).digest(),
    cannotDecryptMessage:
      "Stored MoySklad credentials cannot be decrypted with MOYSKLAD_ENCRYPTION_KEY. Enter the credentials again.",
  },
}

export type LegacySecretKind = keyof typeof legacySecretConfigurations

export type DecryptedSecret = {
  plaintext: string
  reencrypted?: string
}

export class SecretCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SecretCryptoError"
  }
}

export function parseBase64EncryptionKey(
  value: string,
  environmentVariable = "Encryption key"
) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new SecretCryptoError(
      `${environmentVariable} must be a base64-encoded 32-byte key`
    )
  }

  const key = Buffer.from(value, "base64")

  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new SecretCryptoError(
      `${environmentVariable} must be a base64-encoded 32-byte key`
    )
  }

  return key
}

function primaryEncryptionKey(required: true): Buffer
function primaryEncryptionKey(required: false): Buffer | undefined
function primaryEncryptionKey(required: boolean): Buffer | undefined {
  const configuredKey = process.env[PRIMARY_KEY_ENVIRONMENT_VARIABLE]

  if (!configuredKey) {
    if (!required) return undefined

    throw new SecretCryptoError(
      `${PRIMARY_KEY_ENVIRONMENT_VARIABLE} is required and must be a base64-encoded 32-byte key`
    )
  }

  return parseBase64EncryptionKey(
    configuredKey,
    PRIMARY_KEY_ENVIRONMENT_VARIABLE
  )
}

function decodePart(value: string, encoding: Encoding) {
  const isBase64 =
    encoding === "base64" &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value
    )
  const isBase64Url =
    encoding === "base64url" && /^[A-Za-z0-9_-]+$/.test(value)

  if (!isBase64 && !isBase64Url) {
    throw new SecretCryptoError("Stored secret has an invalid encryption format")
  }

  const decoded = Buffer.from(value, encoding)

  if (decoded.toString(encoding) !== value) {
    throw new SecretCryptoError("Stored secret has an invalid encryption format")
  }

  return decoded
}

function encryptedParts(
  encrypted: string,
  version: string,
  separator: string,
  encoding: Encoding
) {
  const [actualVersion, initializationVector, authTag, ciphertext, extra] =
    encrypted.split(separator)

  if (
    actualVersion !== version ||
    !initializationVector ||
    !authTag ||
    ciphertext === undefined ||
    extra !== undefined
  ) {
    throw new SecretCryptoError("Stored secret has an invalid encryption format")
  }

  const iv = decodePart(initializationVector, encoding)
  const tag = decodePart(authTag, encoding)
  const encryptedValue = ciphertext ? decodePart(ciphertext, encoding) : Buffer.alloc(0)

  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
    throw new SecretCryptoError("Stored secret has an invalid encryption format")
  }

  return { iv, tag, encryptedValue }
}

function encryptWithKey(secret: string, key: Buffer) {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  })
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()])

  return [
    CURRENT_FORMAT,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":")
}

function decryptWithKey(
  encrypted: string,
  key: Buffer,
  version: string,
  separator: string,
  encoding: Encoding,
  cannotDecryptMessage: string
) {
  const { iv, tag, encryptedValue } = encryptedParts(
    encrypted,
    version,
    separator,
    encoding
  )
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  })
  decipher.setAuthTag(tag)

  try {
    return Buffer.concat([
      decipher.update(encryptedValue),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    throw new SecretCryptoError(cannotDecryptMessage)
  }
}

function legacyEncryptionKey(kind: LegacySecretKind) {
  const configuration = legacySecretConfigurations[kind]
  const configuredKey = process.env[configuration.environmentVariable]

  if (!configuredKey) {
    const expectedFormat =
      kind === "payment-provider-config"
        ? "a base64-encoded 32-byte key"
        : "a non-empty string"
    throw new SecretCryptoError(
      `${configuration.environmentVariable} is required to decrypt legacy secrets and must be ${expectedFormat}`
    )
  }

  return configuration.key(configuredKey, configuration.environmentVariable)
}

/** Encrypts all new provider secrets with SECRET_ENCRYPTION_KEY and v2. */
export function encryptSecret(secret: string) {
  return encryptWithKey(secret, primaryEncryptionKey(true))
}

/**
 * Reads the current format and the three legacy formats. A legacy value gets a
 * replacement only when the new primary key is already configured, so rollout
 * does not interrupt environments that have not received that variable yet.
 */
export function decryptSecret(
  encrypted: string,
  legacyKind?: LegacySecretKind
): DecryptedSecret {
  if (encrypted.startsWith(`${CURRENT_FORMAT}:`)) {
    return {
      plaintext: decryptWithKey(
        encrypted,
        primaryEncryptionKey(true),
        CURRENT_FORMAT,
        ":",
        "base64",
        `Stored secret cannot be decrypted with ${PRIMARY_KEY_ENVIRONMENT_VARIABLE}`
      ),
    }
  }

  if (!legacyKind) {
    throw new SecretCryptoError("Stored secret has an unsupported legacy format")
  }

  const configuration = legacySecretConfigurations[legacyKind]
  const plaintext = decryptWithKey(
    encrypted,
    legacyEncryptionKey(legacyKind),
    "v1",
    configuration.separator,
    configuration.encoding,
    configuration.cannotDecryptMessage
  )
  const primaryKey = primaryEncryptionKey(false)

  return {
    plaintext,
    ...(primaryKey ? { reencrypted: encryptWithKey(plaintext, primaryKey) } : {}),
  }
}
