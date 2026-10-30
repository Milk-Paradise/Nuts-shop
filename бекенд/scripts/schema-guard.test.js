const test = require("node:test")
const assert = require("node:assert/strict")

const {
  collectMigrationFiles,
  findPendingMigrations,
  getMigrationRootsFromResolutions,
  normalizeMigrationName,
  runGuardAndExit,
  withDisposedContainer,
} = require("./schema-guard")

function resolveActiveMigrations(resolutions) {
  const modules = {
    "/modules/product-wrapper.js": { discoveryPath: "/modules/product/index.js" },
    "/modules/store-pickup/index.js": {},
    "/modules/new-project-module/index.js": {},
    "/providers/active-provider-wrapper.js": {
      discoveryPath: "/providers/active-provider/index.js",
    },
  }
  const providerPaths = {
    "active-provider": "/providers/active-provider-wrapper.js",
  }
  const migrationFiles = {
    "/modules/product": [{ name: "Migration20260101000000.js", module: "product" }],
    "/modules/store-pickup": [
      { name: "Migration20260910120000.js", module: "store-pickup" },
    ],
    "/modules/new-project-module": [
      { name: "Migration20260911120000.js", module: "new-project-module" },
    ],
    "/providers/active-provider": [
      { name: "Migration20260912120000.js", module: "active-provider" },
    ],
  }

  const roots = getMigrationRootsFromResolutions(resolutions, {
    rootDirectory: "/project",
    loadModule(modulePath) {
      return modules[modulePath]
    },
    resolveModulePath(provider) {
      return providerPaths[provider]
    },
  })

  return roots.flatMap((root) => migrationFiles[root.path] ?? [])
}

test("совпадающая схема не даёт непринятых миграций", () => {
  const pending = findPendingMigrations(
    ["Migration20260910120000", "Migration20260101000000"],
    ["Migration20260910120000.js", "Migration20260101000000.js"]
  )

  assert.deepEqual(pending, [])
})

test("непринятая миграция модуля находится вместе с именем модуля", () => {
  const pending = findPendingMigrations(
    ["Migration20260101000000"],
    [
      { name: "Migration20260101000000.js", module: "core" },
      { name: "Migration20260910120000.js", module: "store-pickup" },
    ]
  )

  assert.deepEqual(pending, [
    { name: "Migration20260910120000", module: "store-pickup" },
  ])
})

test("активный модуль с непринятой миграцией даёт drift", () => {
  const expected = resolveActiveMigrations([
    {
      resolutionPath: "/modules/store-pickup/index.js",
      definition: { key: "store-pickup" },
    },
  ])

  assert.deepEqual(findPendingMigrations([], expected), [
    { name: "Migration20260910120000", module: "store-pickup" },
  ])
})

test("отключённый translation и не настроенный index не попадают в ожидания", () => {
  // Результат MedusaAppLoader содержит только активные резолюции. В нём нет
  // отключённого translation и index, присутствующего лишь в ModulesDefinition.
  const expected = resolveActiveMigrations([
    {
      resolutionPath: "/modules/product-wrapper.js",
      definition: { key: "product" },
    },
  ])

  assert.deepEqual(findPendingMigrations(["Migration20260101000000"], expected), [])
  assert.deepEqual(expected, [
    { name: "Migration20260101000000.js", module: "product" },
  ])
})

test("новый проектный модуль с непринятой миграцией даёт drift", () => {
  const expected = resolveActiveMigrations([
    {
      resolutionPath: "/modules/new-project-module/index.js",
      definition: { key: "new-project-module" },
    },
  ])

  assert.deepEqual(findPendingMigrations([], expected), [
    { name: "Migration20260911120000", module: "new-project-module" },
  ])
})

test("provider учитывается только если он есть в активной резолюции", () => {
  const expectedWithoutProvider = resolveActiveMigrations([
    {
      resolutionPath: "/modules/product-wrapper.js",
      definition: { key: "product" },
    },
  ])
  const expectedWithProvider = resolveActiveMigrations([
    {
      resolutionPath: "/modules/product-wrapper.js",
      definition: { key: "product" },
      options: { providers: [{ resolve: "active-provider", id: "active-provider" }] },
    },
  ])

  assert.equal(
    findPendingMigrations(["Migration20260101000000"], expectedWithoutProvider).length,
    0
  )
  assert.deepEqual(
    findPendingMigrations(["Migration20260101000000"], expectedWithProvider),
    [{ name: "Migration20260912120000", module: "active-provider" }]
  )
})

test("имена сходятся независимо от пути и расширения", () => {
  const pending = findPendingMigrations(
    ["/app/src/modules/store-pickup/migrations/Migration20260910120000.ts"],
    ["Migration20260910120000.js"]
  )

  assert.deepEqual(pending, [])
})

test("пустая база даёт все миграции как непринятые", () => {
  const pending = findPendingMigrations([], ["Migration20260910120000.js"])

  assert.equal(pending.length, 1)
  assert.equal(pending[0].name, "Migration20260910120000")
})

test("лишняя миграция в базе не считается расхождением", () => {
  // Откат кода на предыдущую версию оставляет в базе миграцию, которой
  // больше нет в файлах. Это не повод не пускать приложение.
  const pending = findPendingMigrations(
    ["Migration20260910120000", "Migration20260911000000"],
    ["Migration20260910120000.js"]
  )

  assert.deepEqual(pending, [])
})

test("normalizeMigrationName срезает путь и расширение", () => {
  assert.equal(
    normalizeMigrationName("/app/node_modules/@medusajs/cart/migrations/Migration1.js"),
    "Migration1"
  )
  assert.equal(normalizeMigrationName("Migration1"), "Migration1")
})

test("резолюция без пути пропускается, а не роняет сторожа", () => {
  const roots = getMigrationRootsFromResolutions(
    [
      { resolutionPath: "", definition: { key: "declared-inline" } },
      { resolutionPath: undefined, definition: { key: "no-path" } },
      {
        resolutionPath: "/app/node_modules/active/index.js",
        definition: { key: "active" },
        options: { providers: [{ resolve: "", id: "empty-provider" }] },
      },
    ],
    { loadModule: () => ({}), resolveModulePath: () => "/unused" }
  )

  assert.deepEqual(roots, [{ path: "/app/node_modules/active", module: "active" }])
})

test("provider, заданный объектом, тоже попадает в проверку", () => {
  const roots = getMigrationRootsFromResolutions(
    [
      {
        resolutionPath: "/app/node_modules/active/index.js",
        definition: { key: "active" },
        options: {
          providers: [
            { resolve: { discoveryPath: "/app/node_modules/provider/dist/index.js" }, id: "object-provider" },
            { resolve: {}, id: "provider-without-path" },
          ],
        },
      },
    ],
    { loadModule: () => ({}), resolveModulePath: () => "/unused" }
  )

  assert.deepEqual(roots, [
    { path: "/app/node_modules/active", module: "active" },
    { path: "/app/node_modules/provider/dist", module: "object-provider" },
  ])
})

test("нечитаемый каталог активного модуля роняет проверку, а не молчит", () => {
  assert.throws(
    () => collectMigrationFiles([{ path: "/nope/does-not-exist", module: "active" }]),
    /ENOENT/
  )
})

test("контейнер Medusa освобождается после чтения конфигурации", async () => {
  let disposed = false
  const container = {
    async dispose() {
      disposed = true
    },
  }

  const roots = await withDisposedContainer(container, async () => [
    { path: "/app/node_modules/locking-redis", module: "locking" },
  ])

  assert.deepEqual(roots, [
    { path: "/app/node_modules/locking-redis", module: "locking" },
  ])
  assert.equal(disposed, true)
})

test("контейнер Medusa освобождается при ошибке чтения конфигурации", async () => {
  let disposed = false
  const container = {
    async dispose() {
      disposed = true
    },
  }

  await assert.rejects(
    withDisposedContainer(container, async () => {
      throw new Error("module loader failed")
    }),
    /module loader failed/
  )
  assert.equal(disposed, true)
})

test("одноразовый schema guard завершает процесс после успешной проверки", async () => {
  const writes = []
  const exits = []
  const processLike = {
    stdout: {
      write(text, callback) {
        writes.push({ stream: "stdout", text })
        callback()
      },
    },
    stderr: {
      write(text, callback) {
        writes.push({ stream: "stderr", text })
        callback()
      },
    },
    exit(code) {
      exits.push(code)
    },
  }

  await runGuardAndExit(async () => {}, processLike)

  assert.deepEqual(writes, [{ stream: "stdout", text: "" }])
  assert.deepEqual(exits, [0])
})

test("одноразовый schema guard завершает процесс с ошибкой после сбоя", async () => {
  const writes = []
  const exits = []
  const processLike = {
    stdout: {
      write(text, callback) {
        writes.push({ stream: "stdout", text })
        callback()
      },
    },
    stderr: {
      write(text, callback) {
        writes.push({ stream: "stderr", text })
        callback()
      },
    },
    exit(code) {
      exits.push(code)
    },
  }

  await runGuardAndExit(
    async () => {
      throw new Error("unexpected loader error")
    },
    processLike
  )

  assert.equal(writes.length, 1)
  assert.equal(writes[0].stream, "stderr")
  assert.match(writes[0].text, /unexpected loader error/)
  assert.deepEqual(exits, [5])
})

