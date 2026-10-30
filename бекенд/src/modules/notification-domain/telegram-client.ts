export type TelegramSendMessageResult = {
  ok?: boolean
  result?: { message_id?: number }
  error_code?: number
}

export class TelegramBotClient {
  constructor(
    private readonly request: typeof fetch = fetch,
    private readonly timeoutMs = 10_000
  ) {}

  async sendMessage(botToken: string, chatId: string, text: string) {
    const response = await this.request(
      `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(this.timeoutMs),
      }
    )
    let payload: TelegramSendMessageResult = {}
    try {
      payload = (await response.json()) as TelegramSendMessageResult
    } catch {
      // A response without a valid Telegram body is classified by HTTP status.
    }
    return { status: response.status, payload }
  }
}
