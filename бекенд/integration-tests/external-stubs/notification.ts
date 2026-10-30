import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"
import { fileURLToPath } from "node:url"

const HOST = "127.0.0.1"

export type InterceptedNotification = Record<string, unknown> & {
  id: string
  received_at: string
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  })
  response.end(JSON.stringify(body))
}

async function requestBody(
  request: IncomingMessage
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.from(chunk as Uint8Array)
    )
  }
  return JSON.parse(
    Buffer.concat(chunks).toString("utf8") || "{}"
  ) as Record<string, unknown>
}

export function createNotificationStubServer(): Server {
  const notifications: InterceptedNotification[] = []

  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    try {
      const url = new URL(request.url ?? "/", `http://${HOST}`)

      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, {
          status: "ok",
          notifications: notifications.length,
        })
        return
      }

      if (request.method === "POST" && url.pathname === "/notifications") {
        const body = await requestBody(request)

        if (typeof body.to !== "string" || typeof body.channel !== "string") {
          json(response, 400, {
            message: "Notification recipient and channel are required",
          })
          return
        }

        const notification: InterceptedNotification = {
          ...body,
          id: `notification_${notifications.length + 1}`,
          received_at: new Date().toISOString(),
        }
        notifications.push(notification)
        json(response, 201, { id: notification.id })
        return
      }

      if (request.method === "GET" && url.pathname === "/notifications") {
        const to = url.searchParams.get("to")
        const template = url.searchParams.get("template")
        const matches = notifications.filter(
          (item) =>
            (!to || item.to === to) &&
            (!template || item.template === template)
        )
        json(response, 200, { notifications: matches })
        return
      }

      if (request.method === "DELETE" && url.pathname === "/notifications") {
        notifications.length = 0
        response.writeHead(204).end()
        return
      }

      json(response, 404, {
        message: `Unsupported notification stub request: ${request.method} ${url.pathname}`,
      })
    } catch (error) {
      json(response, 400, {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return createServer((request, response) => {
    void handleRequest(request, response)
  })
}

export async function startNotificationStub(port: number): Promise<Server> {
  const server = createNotificationStubServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, HOST, resolve)
  })
  return server
}

async function main(): Promise<void> {
  const port = Number(process.argv[2])

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      "Usage: node --experimental-strip-types stubs/notification.ts <port>"
    )
  }

  const server = await startNotificationStub(port)
  console.log(`[notification-stub] Ready at http://${HOST}:${port}`)
  const close = () => server.close(() => process.exit(0))
  process.once("SIGTERM", close)
  process.once("SIGINT", close)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(
      `[notification-stub] ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    process.exitCode = 1
  })
}
