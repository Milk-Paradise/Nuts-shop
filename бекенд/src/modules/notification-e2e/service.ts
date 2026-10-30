import type {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils"

type InjectedDependencies = {
  logger: Logger
}

type E2ENotificationOptions = {
  base_url?: string
}

class E2ENotificationService extends AbstractNotificationProviderService {
  static identifier = "e2e"

  protected logger_: Logger
  protected baseUrl_: string

  constructor(
    { logger }: InjectedDependencies,
    options: E2ENotificationOptions
  ) {
    super()
    const isTestRun = process.env.NODE_ENV === "test"
    const isE2ERun = process.env.E2E_RUN === "true"

    if ((!isTestRun && !isE2ERun) || !options.base_url) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The notification stub provider is available only in test/e2e runs with E2E_NOTIFICATION_STUB_URL"
      )
    }

    this.logger_ = logger
    this.baseUrl_ = options.base_url.replace(/\/$/, "")
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    if (!notification) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No notification information provided"
      )
    }

    const response = await fetch(`${this.baseUrl_}/notifications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(notification),
      signal: AbortSignal.timeout(5_000),
    })

    if (!response.ok) {
      const body = await response.text()
      this.logger_.error(
        `Notification interception failed: HTTP ${response.status} ${body}`
      )
      throw new Error(
        `Notification interception failed with HTTP ${response.status}`
      )
    }

    const result = (await response.json()) as { id?: unknown }

    if (typeof result.id !== "string") {
      throw new Error("Notification interception returned no notification id")
    }

    return { id: result.id }
  }
}

export default E2ENotificationService
