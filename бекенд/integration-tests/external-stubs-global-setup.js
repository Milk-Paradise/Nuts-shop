const { spawn } = require("node:child_process")
const net = require("node:net")
const path = require("node:path")

const state = require("./external-stubs-state")

const HOST = "127.0.0.1"
const START_TIMEOUT_MS = 10_000
const HEALTH_REQUEST_TIMEOUT_MS = 500
const STOP_TIMEOUT_MS = 5_000

async function allocatePort() {
  const server = net.createServer()
  const port = await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, HOST, () => resolve(server.address().port))
  })
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return port
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      resolve()
    }, STOP_TIMEOUT_MS)

    child.once("exit", () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill("SIGTERM")
  })
}

async function waitForHealth(label, child, url) {
  const deadline = Date.now() + START_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${label} exited before becoming healthy`)
    }

    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
      })
      if (response.ok) return
    } catch {
      // The child has not bound its port yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  throw new Error(`${label} did not become healthy within ${START_TIMEOUT_MS}ms`)
}

async function startStub(label, fileName) {
  const port = await allocatePort()
  const filePath = path.resolve(
    __dirname,
    "external-stubs",
    fileName
  )
  const nodeArgs = ["--experimental-strip-types"]
  if (
    process.allowedNodeEnvironmentFlags.has(
      "--experimental-default-type=module"
    )
  ) {
    nodeArgs.push("--experimental-default-type=module")
  }
  const child = spawn(
    process.execPath,
    [...nodeArgs, filePath, String(port)],
    { stdio: ["ignore", "inherit", "inherit"] }
  )
  state.children.push(child)
  const url = `http://${HOST}:${port}`
  await waitForHealth(label, child, url)
  return url
}

module.exports = async function externalStubsGlobalSetup() {
  try {
    const notificationUrl = await startStub(
      "notification-stub",
      "notification.ts"
    )

    process.env.E2E_NOTIFICATION_STUB_URL = notificationUrl
  } catch (error) {
    await Promise.all(state.children.map(stopChild))
    throw error
  }
}
