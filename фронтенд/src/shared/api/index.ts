import "server-only";
export class TelegramError extends Error {
  constructor(public uncertain: boolean) {
    super(
      uncertain
        ? "Telegram delivery is uncertain"
        : "Telegram rejected the message",
    );
  }
}
export async function sendTelegramMessage(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN,
    chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("Telegram is not configured");
  // One request only. Automatic retries may duplicate an order after a timeout.
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
  } catch {
    throw new TelegramError(true);
  }
  let result: { ok?: boolean };
  try {
    result = await response.json();
  } catch {
    throw new TelegramError(true);
  }
  if (!response.ok || !result.ok)
    throw new TelegramError(response.status >= 500);
}
