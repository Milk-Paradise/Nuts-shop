import { randomBytes } from "node:crypto"

import {
  MoyskladApiError,
  MoyskladClient,
  type MoyskladFetch,
} from "../modules/moysklad-integration/client"
import {
  encryptMoyskladCredentials,
  type MoyskladCredentials,
} from "../modules/moysklad-integration/credentials"

type ProbeEnvironment = Record<string, string | undefined>

export type ProbeResult = {
  name: string
  passed: boolean
  detail: string
}

export type MoyskladProbeReport = {
  results: ProbeResult[]
  missingVariables: string[]
}

export function readMoyskladProbeCredentials(
  environment: ProbeEnvironment
): { credentials?: MoyskladCredentials; missingVariables: string[] } {
  if (environment.MOYSKLAD_TOKEN?.trim()) {
    return {
      credentials: {
        type: "token",
        token: environment.MOYSKLAD_TOKEN.trim(),
      },
      missingVariables: [],
    }
  }

  const missingVariables = ["MOYSKLAD_LOGIN", "MOYSKLAD_PASSWORD"].filter(
    (name) => !environment[name]?.trim()
  )

  if (missingVariables.length) {
    return { missingVariables: ["MOYSKLAD_TOKEN", ...missingVariables] }
  }

  return {
    credentials: {
      type: "basic",
      login: environment.MOYSKLAD_LOGIN!.trim(),
      password: environment.MOYSKLAD_PASSWORD!.trim(),
    },
    missingVariables: [],
  }
}

function errorMessage(error: unknown) {
  if (error instanceof MoyskladApiError) {
    return error.status
      ? `МойСклад вернул HTTP ${error.status}`
      : error.message
  }

  return error instanceof Error ? error.message : String(error)
}

async function check(
  results: ProbeResult[],
  name: string,
  operation: () => Promise<string>
) {
  try {
    results.push({ name, passed: true, detail: await operation() })
  } catch (error) {
    results.push({ name, passed: false, detail: errorMessage(error) })
  }
}

/**
 * Performs only GET requests. The injected fetch makes the no-credentials path
 * testable and guarantees that validation happens before any API access.
 */
export async function runMoyskladReadOnlyProbe(options: {
  environment?: ProbeEnvironment
  fetch?: MoyskladFetch
} = {}): Promise<MoyskladProbeReport> {
  const environment = options.environment ?? process.env
  const parsed = readMoyskladProbeCredentials(environment)

  if (!parsed.credentials) {
    return { results: [], missingVariables: parsed.missingVariables }
  }

  const previousEncryptionKey = process.env.MOYSKLAD_ENCRYPTION_KEY
  process.env.MOYSKLAD_ENCRYPTION_KEY =
    previousEncryptionKey || randomBytes(32).toString("hex")

  try {
    const encryptedCredentials = encryptMoyskladCredentials(parsed.credentials)
    const client = new MoyskladClient(options.fetch)
    const results: ProbeResult[] = []
    let firstProductCode: string | undefined

    await check(results, "Проверка реквизитов", async () => {
      await client.testCredentials(parsed.credentials!)
      return "доступ подтверждён"
    })

    await check(results, "Справочник организаций", async () => {
      const organization = await client.findDefaultOrganization(
        encryptedCredentials
      )

      if (!organization.id || !organization.meta?.href) {
        throw new Error("в ответе отсутствуют id или meta.href")
      }

      return "организация получена"
    })

    await check(results, "Справочник номенклатуры", async () => {
      for await (const batch of client.getProductBatches(
        encryptedCredentials
      )) {
        firstProductCode = batch.rows.find((product) => product.code)?.code
        return `получено позиций: ${batch.total}`
      }

      return "справочник пуст"
    })

    await check(results, "Остатки с пагинацией", async () => {
      let pages = 0
      let rows = 0

      for await (const batch of client.getStockBatches(encryptedCredentials)) {
        pages += 1
        rows += batch.rows.length
        firstProductCode ||= batch.rows.find((row) => row.code)?.code
      }

      return `страниц: ${pages}, позиций: ${rows}`
    })

    await check(results, "Поиск по коду номенклатуры", async () => {
      if (!firstProductCode) {
        throw new Error("в справочнике и остатках нет позиции с заполненным code")
      }

      const products = await client.findProductsBySku(
        encryptedCredentials,
        firstProductCode
      )

      if (products.length !== 1) {
        throw new Error(
          `код из справочника сопоставился с ${products.length} позициями`
        )
      }

      return "код однозначно найден"
    })

    await check(results, "Обработка ошибки API", async () => {
      const invalidClient = new MoyskladClient(options.fetch)

      try {
        await invalidClient.testCredentials({
          type: "token",
          token: "read-only-probe-intentionally-invalid",
        })
      } catch (error) {
        if (error instanceof MoyskladApiError) {
          return error.status
            ? `ошибка поднята как MoyskladApiError (HTTP ${error.status})`
            : "ошибка поднята как MoyskladApiError"
        }

        throw error
      }

      throw new Error("заведомо неверные реквизиты были приняты")
    })

    return { results, missingVariables: [] }
  } finally {
    if (previousEncryptionKey === undefined) {
      delete process.env.MOYSKLAD_ENCRYPTION_KEY
    } else {
      process.env.MOYSKLAD_ENCRYPTION_KEY = previousEncryptionKey
    }
  }
}
