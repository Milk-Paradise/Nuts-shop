import { createHmac } from "node:crypto"
import { MedusaError } from "@medusajs/framework/utils"

import type { CheckoutCatalogOrderBody } from "../api/catalog/validators"
import { parseBase64EncryptionKey } from "./secret-crypto"

export type CatalogOrderFixationInput = CheckoutCatalogOrderBody & {
  customer_id?: string | null
}

export class CatalogOrderFixationConflictError extends MedusaError {
  constructor() {
    super(
      MedusaError.Types.CONFLICT,
      "Checkout request does not match the request already used for this cart"
    )
    this.name = "CatalogOrderFixationConflictError"
  }
}

export function isCatalogOrderFixationConflictError(error: unknown): boolean {
  return (
    error instanceof CatalogOrderFixationConflictError ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "CatalogOrderFixationConflictError")
  )
}

export function catalogOrderFixationFingerprint(
  input: CatalogOrderFixationInput
) {
  const configuredKey = process.env.SECRET_ENCRYPTION_KEY
  if (!configuredKey) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "SECRET_ENCRYPTION_KEY is required for checkout idempotency"
    )
  }

  const key = parseBase64EncryptionKey(configuredKey, "SECRET_ENCRYPTION_KEY")
  const canonicalRequest = JSON.stringify({
    cart_id: input.cart_id,
    customer_id: input.customer_id ?? null,
    name: input.name.trim(),
    phone: input.phone.trim(),
    email: input.email.trim().toLowerCase(),
    city: input.city.trim(),
    street: input.street?.trim() ?? null,
    house: input.house?.trim() ?? null,
    apartment: input.apartment?.trim() ?? null,
    comment: input.comment?.trim() ?? "",
  })

  return createHmac("sha256", key).update(canonicalRequest).digest("hex")
}
