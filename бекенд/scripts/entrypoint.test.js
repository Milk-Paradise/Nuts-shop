const test = require("node:test")
const assert = require("node:assert/strict")
const { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs")
const { tmpdir } = require("node:os")
const { join } = require("node:path")
const { spawnSync } = require("node:child_process")

const entrypoint = join(__dirname, "entrypoint.sh")

/**
 * Запускает точку входа со подставным `npx`, который ведёт журнал вызовов и
 * отвечает так, как задано сценарием. Настоящая Medusa здесь не нужна: проверяем
 * порядок шагов и трактовку их исходов.
 */
function runEntrypoint({ npxScript, env = {}, command = ["/bin/echo", "started"] }) {
  const directory = mkdtempSync(join(tmpdir(), "catalog-entrypoint-"))
  const binDirectory = join(directory, "bin")
  mkdirSync(binDirectory)
  const callLog = join(directory, "calls.log")

  writeFileSync(join(binDirectory, "npx"), npxScript)
  chmodSync(join(binDirectory, "npx"), 0o755)
  // Пауза между попытками не должна стоить теста реального времени.
  writeFileSync(join(binDirectory, "sleep"), "#!/bin/sh\nexit 0\n")
  chmodSync(join(binDirectory, "sleep"), 0o755)

  const result = spawnSync("sh", [entrypoint, ...command], {
    cwd: directory,
    encoding: "utf8",
    env: {
      PATH: `${binDirectory}:${process.env.PATH}`,
      DATABASE_URL: "postgres://user:pass@postgres:5432/db",
      CALL_LOG: callLog,
      ...env,
    },
  })

  const calls = readFileSync(callLog, { encoding: "utf8", flag: "a+" }).trim().split("\n").filter(Boolean)
  rmSync(directory, { recursive: true, force: true })
  return { ...result, calls }
}

const npxRecording = (body) => `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
${body}
`

test("migrations run before the administrator and the application starts last", () => {
  const result = runEntrypoint({
    npxScript: npxRecording("exit 0"),
    env: { ADMIN_EMAIL: "admin@test.com", ADMIN_PASSWORD: "supersecret" },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.calls, [
    "medusa db:migrate",
    "medusa user -e admin@test.com -p supersecret",
  ])
  assert.match(result.stdout, /started/)
})

test("an existing administrator is a normal repeat, not a failure", () => {
  const result = runEntrypoint({
    npxScript: npxRecording(`
case "$*" in
  *"medusa user"*) printf 'User with email already exists\\n'; exit 1 ;;
  *) exit 0 ;;
esac
`),
    env: { ADMIN_EMAIL: "admin@test.com", ADMIN_PASSWORD: "supersecret" },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /administrator already initialized/)
  assert.match(result.stdout, /started/)
})

test("any other administrator failure stops the container before it serves", () => {
  const result = runEntrypoint({
    npxScript: npxRecording(`
case "$*" in
  *"medusa user"*) printf 'connection refused\\n'; exit 1 ;;
  *) exit 0 ;;
esac
`),
    env: { ADMIN_EMAIL: "admin@test.com", ADMIN_PASSWORD: "supersecret" },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /administrator creation failed/)
  assert.doesNotMatch(result.stdout, /started/)
})

test("a database that is not ready yet is waited for, not given up on", () => {
  const result = runEntrypoint({
    npxScript: npxRecording(`
case "$*" in
  *db:migrate*)
    attempts="$(grep -c 'db:migrate' "$CALL_LOG")"
    [ "$attempts" -ge 3 ] || exit 1
    exit 0
    ;;
  *) exit 0 ;;
esac
`),
    env: { ADMIN_EMAIL: "admin@test.com", ADMIN_PASSWORD: "supersecret" },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.calls.filter((call) => call.includes("db:migrate")).length, 3)
  assert.match(result.stdout, /started/)
})

test("a database that never becomes ready stops the container", () => {
  const result = runEntrypoint({
    npxScript: npxRecording(`
case "$*" in
  *db:migrate*) exit 1 ;;
  *) exit 0 ;;
esac
`),
    env: { INIT_MAX_ATTEMPTS: "4" },
  })
  assert.notEqual(result.status, 0)
  assert.equal(result.calls.length, 4, "every attempt is spent and no more")
  assert.match(result.stderr, /migrations did not succeed/)
  assert.doesNotMatch(result.stdout, /started/)
})

test("without administrator credentials the step is skipped, not failed", () => {
  const result = runEntrypoint({ npxScript: npxRecording("exit 0") })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.calls, ["medusa db:migrate"])
  assert.match(result.stdout, /skipping administrator creation/)
  assert.match(result.stdout, /started/)
})

test("a missing database address fails before anything is attempted", () => {
  const result = runEntrypoint({ npxScript: npxRecording("exit 0"), env: { DATABASE_URL: "" } })
  assert.notEqual(result.status, 0)
  assert.equal(result.calls.length, 0)
  assert.match(result.stderr, /DATABASE_URL is not set/)
})
