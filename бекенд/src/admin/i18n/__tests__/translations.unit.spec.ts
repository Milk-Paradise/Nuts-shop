import { readFileSync } from "node:fs"
import { resolve } from "node:path"

type TranslationTree = Record<string, unknown>

const coreTranslationsPath = resolve(
  process.cwd(),
  "node_modules/@medusajs/dashboard/src/i18n/translations"
)
const projectTranslationsPath = resolve(process.cwd(), "src/admin/i18n/json/ru.json")

function readJson(path: string): TranslationTree {
  return JSON.parse(readFileSync(path, "utf8")) as TranslationTree
}

function missingCoreKeys(
  source: TranslationTree,
  russian: TranslationTree,
  overlay: TranslationTree,
  prefix = ""
): string[] {
  return Object.entries(source).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    const existing = russian[key]
    const project = overlay[key]

    if (value && typeof value === "object" && !Array.isArray(value)) {
      return missingCoreKeys(
        value as TranslationTree,
        (existing as TranslationTree | undefined) ?? {},
        (project as TranslationTree | undefined) ?? {},
        path
      )
    }

    return existing === undefined && project === undefined ? [path] : []
  })
}

function placeholders(value: string) {
  return [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}|\{([^{}]+)\}|<\/?(\d+)\/?\s*>/g)]
    .map((match) => match[1] ?? match[2] ?? `<${match[3]}>`)
    .sort()
}

function placeholderMismatches(
  source: TranslationTree,
  overlay: TranslationTree,
  prefix = ""
): string[] {
  return Object.entries(source).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    const translated = overlay[key]

    if (value && typeof value === "object" && !Array.isArray(value)) {
      return placeholderMismatches(
        value as TranslationTree,
        (translated as TranslationTree | undefined) ?? {},
        path
      )
    }

    if (typeof value !== "string" || typeof translated !== "string") {
      return []
    }

    return JSON.stringify(placeholders(value)) ===
      JSON.stringify(placeholders(translated))
      ? []
      : [path]
  })
}

describe("Russian Admin translations", () => {
  const english = readJson(resolve(coreTranslationsPath, "en.json"))
  const coreRussian = readJson(resolve(coreTranslationsPath, "ru.json"))
  const projectRussian = readJson(projectTranslationsPath)

  it("covers every untranslated key in the installed Medusa dashboard locale", () => {
    expect(missingCoreKeys(english, coreRussian, projectRussian)).toEqual([])
  })

  it("preserves interpolation and rich-text placeholders", () => {
    expect(placeholderMismatches(english, projectRussian)).toEqual([])
  })
})
