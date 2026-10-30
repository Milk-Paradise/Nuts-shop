export type SmscCredentials = {
  login: string
  password: string
  sender?: string
}

export type SmscResponse = Record<string, unknown>

type Fetch = typeof fetch

export class SmscClient {
  constructor(private readonly request: Fetch = fetch) {}

  send(
    credentials: SmscCredentials,
    input: { id: string; phone: string; message: string }
  ) {
    return this.post("https://smsc.ru/sys/send.php", credentials, {
      phones: input.phone,
      mes: input.message,
      id: input.id,
      sender: credentials.sender,
    })
  }

  status(
    credentials: SmscCredentials,
    input: { id: string; phone: string }
  ) {
    return this.post("https://smsc.ru/sys/status.php", credentials, {
      phone: input.phone,
      id: input.id,
    })
  }

  private async post(
    url: string,
    credentials: SmscCredentials,
    values: Record<string, string | undefined>
  ): Promise<SmscResponse> {
    const body = new URLSearchParams({
      login: credentials.login,
      psw: credentials.password,
      fmt: "3",
      charset: "utf-8",
    })
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) body.set(key, value)
    }

    const response = await this.request(url, { method: "POST", body })
    if (!response.ok) throw new Error(`SMSC HTTP ${response.status}`)
    const payload = (await response.json()) as unknown
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Invalid SMSC response")
    }
    return payload as SmscResponse
  }
}
