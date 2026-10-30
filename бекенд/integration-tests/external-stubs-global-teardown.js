const state = require("./external-stubs-state")

const STOP_TIMEOUT_MS = 5_000

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`Stub process ${child.pid} did not stop after SIGTERM`))
    }, STOP_TIMEOUT_MS)

    child.once("exit", () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill("SIGTERM")
  })
}

module.exports = async function externalStubsGlobalTeardown() {
  await Promise.all(state.children.map(stopChild))
  state.children.length = 0
}
