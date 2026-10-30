// Проверка схемы базы перед стартом бэкенда.
//
// Зачем: 13 сентября 2026 приложение на проде стартовало штатно, отрапортовало
// "Server is ready" и больше суток работало с базой, в которой не было таблицы
// store_pickup_setting. Расхождение нашёл живой покупатель, а не мы.
//
// Владелец сознательно выбрал жёсткий отказ: лучше заметная недоступность,
// чем тихая работа на несовпадающей схеме.
//
// Коды возврата:
//   0 — схема совпадает с кодом
//   3 — есть непринятые миграции (event=schema_drift)
//   4 — база недоступна (event=schema_check_db_unavailable)
//   5 — не удалось загрузить конфигурацию или активные модули
//       (event=schema_check_modules_unavailable)

const fs = require("node:fs")
const path = require("node:path")

const EXIT_DRIFT = 3
const EXIT_DB_UNAVAILABLE = 4
const EXIT_MODULES_UNAVAILABLE = 5
const CONNECT_ATTEMPTS = 5
const CONNECT_RETRY_MS = 2000

// Чистая функция — её и покрывает тест. Имена приводим к общему виду:
// в базе MikroORM хранит имя файла, иногда с путём и расширением.
//
// Сравниваем только по имени, без модуля: в таблицах миграций модуль не
// записан, взять его неоткуда. Цена известна — у разных модулей встречаются
// миграции с одинаковым timestamp в имени (например Migration20231228143900),
// и если одна из них применена, вторая сойдёт за применённую тоже.
function normalizeMigrationName(name) {
  return String(name)
    .replace(/\\/g, "/")
    .replace(/^.*\//, "")
    .replace(/\.[jt]s$/, "")
}

function findPendingMigrations(applied, expected) {
  const appliedSet = new Set(applied.map(normalizeMigrationName))

  return expected
    .map((item) =>
      typeof item === "string"
        ? { name: normalizeMigrationName(item), module: null }
        : { name: normalizeMigrationName(item.name), module: item.module ?? null }
    )
    .filter((item) => !appliedSet.has(item.name))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Файлы миграций только активных модулей. Имя модуля передаётся отдельно,
// потому что каталог пакета core-модуля обычно называется `dist`.
function collectMigrationFiles(roots) {
  const found = []

  const walk = (dir, depth, module) => {
    if (depth > 8) {
      return
    }

    // Ошибку чтения не проглатываем: каталог активного модуля обязан читаться,
    // и «не смогли посмотреть» здесь неотличимо от «миграций нет» — а это
    // ровно тот тихий пропуск, ради которого сторож и написан. Исключение
    // одно: подкаталога может не быть, это нормальная структура пакета.
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      if (error && error.code === "ENOENT" && depth > 0) {
        return
      }
      throw error
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (entry.name === "migrations") {
          for (const file of fs.readdirSync(full)) {
            if (/^Migration.*\.js$/.test(file)) {
              found.push({
                name: file,
                module: module ?? path.basename(path.dirname(full)),
              })
            }
          }
          continue
        }

        if (entry.name === "node_modules" && depth > 0) {
          continue
        }

        walk(full, depth + 1, module)
      }
    }
  }

  for (const root of roots) {
    const entry = typeof root === "string" ? { path: root } : root
    walk(entry.path, 0, entry.module)
  }

  return found
}

function getModuleMigrationRoot(modulePath, loadModule = require) {
  // Пустой путь — не поломка: так выглядят резолюции без собственного пакета
  // (например, модуль, объявленный прямо в конфигурации). Файлов миграций у
  // них нет, и пропуск ничего не прячет, а require("") уронил бы сторожа.
  if (typeof modulePath !== "string" || modulePath === "") {
    return null
  }

  const moduleExports = loadModule(modulePath)
  const discoveryPath = moduleExports?.discoveryPath ?? moduleExports?.default?.discoveryPath

  return path.dirname(discoveryPath ?? modulePath)
}

// MedusaAppLoader уже отсеял выключенные модули и разрешил проектные, ядровые
// и плагинные. Этот переходник превращает его резолюции в каталоги с миграциями,
// ничего при этом не применяя.
function getMigrationRootsFromResolutions(
  resolutions,
  {
    rootDirectory = process.cwd(),
    loadModule = require,
    resolveModulePath = require.resolve,
  } = {}
) {
  const roots = []

  const addModuleRoot = (modulePath, module) => {
    const migrationRoot = getModuleMigrationRoot(modulePath, loadModule)

    if (migrationRoot) {
      roots.push({ path: migrationRoot, module })
    }
  }

  for (const resolution of resolutions) {
    addModuleRoot(resolution.resolutionPath, resolution.definition.key)

    for (const provider of resolution.options?.providers ?? []) {
      // resolve бывает и объектом — это уже загруженный пакет провайдера.
      // Тогда путь берём из него самого, а не через resolveModulePath.
      if (provider.resolve && typeof provider.resolve === "object") {
        const discoveryPath =
          provider.resolve.discoveryPath ?? provider.resolve.default?.discoveryPath

        if (typeof discoveryPath === "string" && discoveryPath !== "") {
          roots.push({ path: path.dirname(discoveryPath), module: provider.id })
        }

        continue
      }

      if (typeof provider.resolve !== "string" || provider.resolve === "") {
        continue
      }

      const providerPath = resolveModulePath(provider.resolve, {
        paths: [rootDirectory],
      })
      addModuleRoot(providerPath, provider.id)
    }
  }

  return roots
}

class ProcessExitError extends Error {
  constructor(code) {
    super(`Medusa configuration loader requested process exit ${code}`)
    this.code = code
  }
}

// Загрузчик конфигурации Medusa на битом конфиге зовёт process.exit. На время
// вызова подменяем его обычной ошибкой, иначе сторож не успеет сказать, что
// случилось, своим кодом возврата и своим событием в логе.
async function preventProcessExit(callback) {
  const exit = process.exit
  process.exit = (code) => {
    throw new ProcessExitError(code)
  }

  try {
    return await callback()
  } finally {
    process.exit = exit
  }
}

async function withDisposedContainer(container, callback) {
  try {
    return await callback(container)
  } finally {
    await container.dispose()
  }
}

async function loadActiveModuleMigrationRoots(rootDirectory = process.cwd()) {
  const { initializeContainer } = require("@medusajs/medusa/loaders/index")
  const { MedusaAppLoader } = require("@medusajs/framework")
  const { ContainerRegistrationKeys, getResolvedPlugins, mergePluginModules } = require(
    "@medusajs/framework/utils"
  )
  const { MedusaModule } = require("@medusajs/framework/modules-sdk")

  return preventProcessExit(async () => {
    const container = await initializeContainer(rootDirectory, {
      skipDbConnection: true,
    })

    // Loading medusa-config can create providers with live connections (such
    // as Redis locking). Dispose them so the one-shot guard can exit and the
    // container entrypoint can continue to `medusa start`.
    return withDisposedContainer(container, async (container) => {
      const configModule = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
      const plugins = await getResolvedPlugins(rootDirectory, configModule, true)
      mergePluginModules(configModule, plugins)

      const appLoader = new MedusaAppLoader({ container, cwd: rootDirectory })
      await appLoader.load({ migrationOnly: true, registerInContainer: false })

      return getMigrationRootsFromResolutions(MedusaModule.getAllModuleResolutions(), {
        rootDirectory,
      })
    })
  })
}

function formatErrorMessage(error, fallback) {
  return String(error?.message ?? fallback).replace(/[\r\n"]/g, " ")
}

async function readAppliedMigrations(connectionString) {
  // pg приходит вместе с Medusa — отдельной зависимости не заводим.
  const { Client } = require("pg")

  let lastError

  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    const client = new Client({ connectionString })

    try {
      await client.connect()

      const tables = await client.query(
        "select table_name from information_schema.tables where table_name like 'mikro_orm_migrations%'"
      )

      const names = []

      for (const row of tables.rows) {
        const result = await client.query(`select name from "${row.table_name}"`)
        names.push(...result.rows.map((r) => r.name))
      }

      return names
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_MS))
    } finally {
      await client.end().catch(() => {})
    }
  }

  throw lastError
}

async function main() {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    console.error(
      "[schema-guard] level=ERROR event=schema_check_db_unavailable message=\"DATABASE_URL не задан\""
    )
    process.exit(EXIT_DB_UNAVAILABLE)
  }

  let expected

  try {
    const roots = await loadActiveModuleMigrationRoots(process.cwd())
    expected = collectMigrationFiles(roots)
  } catch (error) {
    console.error(
      `[schema-guard] level=ERROR event=schema_check_modules_unavailable message="${formatErrorMessage(
        error,
        "не удалось загрузить конфигурацию или активные модули"
      )}"`
    )
    process.exit(EXIT_MODULES_UNAVAILABLE)
  }

  let applied

  try {
    applied = await readAppliedMigrations(connectionString)
  } catch (error) {
    console.error(
      `[schema-guard] level=ERROR event=schema_check_db_unavailable attempts=${CONNECT_ATTEMPTS} message="${
        error && error.message ? error.message : "нет соединения с базой"
      }"`
    )
    process.exit(EXIT_DB_UNAVAILABLE)
  }

  const pending = findPendingMigrations(applied, expected)

  if (pending.length === 0) {
    console.log(
      `[schema-guard] level=INFO event=schema_check_ok applied=${applied.length} expected=${expected.length}`
    )
    return
  }

  const list = pending
    .map((item) => (item.module ? `${item.module}/${item.name}` : item.name))
    .join(",")

  console.error(
    `[schema-guard] level=ERROR event=schema_drift pending=${pending.length} migrations="${list}" ` +
      'message="Схема базы не соответствует коду. Приложение не запущено. ' +
      'Применить: npx medusa db:migrate (или scripts/check-schema.sh --stack <стек> --apply)"'
  )
  process.exit(EXIT_DRIFT)
}

// This is a one-shot process. Some Medusa providers keep handles alive outside
// the disposed Awilix container, so returning from main() alone may leave the
// shell blocked before it can continue to `medusa start`. Flush the final log,
// then exit explicitly with the guard's result.
async function runGuardAndExit(runGuard = main, processLike = process) {
  let exitCode = 0
  let errorMessage = ""

  try {
    await runGuard()
  } catch (error) {
    exitCode = EXIT_MODULES_UNAVAILABLE
    errorMessage =
      `[schema-guard] level=ERROR event=schema_check_modules_unavailable message="${formatErrorMessage(
        error,
        "не удалось выполнить проверку схемы"
      )}"\n`
  }

  const output = exitCode === 0 ? processLike.stdout : processLike.stderr
  await new Promise((resolve) => output.write(errorMessage, resolve)).catch(() => {})
  processLike.exit(exitCode)
}

module.exports = {
  collectMigrationFiles,
  findPendingMigrations,
  getMigrationRootsFromResolutions,
  runGuardAndExit,
  withDisposedContainer,
  normalizeMigrationName,
}

if (require.main === module) {
  runGuardAndExit()
}
