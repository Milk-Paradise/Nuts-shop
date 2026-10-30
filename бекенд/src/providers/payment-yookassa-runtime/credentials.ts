import { MedusaError } from "@medusajs/framework/utils"

const YOOKASSA_API_URL = "https://api.yookassa.ru/v3"

export type YooKassaCredentials = {
  shop_id: string
  secret_key: string
}

type CredentialCheckRequest = typeof fetch

export async function verifyYooKassaCredentials(
  credentials: YooKassaCredentials,
  request: CredentialCheckRequest = fetch
) {
  try {
    const response = await request(`${YOOKASSA_API_URL}/me`, {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${credentials.shop_id}:${credentials.secret_key}`
        ).toString("base64")}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "YooKassa credentials could not be verified"
      )
    }
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "YooKassa credentials could not be verified"
    )
  }
}
