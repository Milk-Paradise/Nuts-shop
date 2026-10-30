#!/usr/bin/env node

import { existsSync } from "node:fs"
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  copyFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const LIKEC4_VERSION = "1.59.4"
const VIEW_ELEMENT_LIMIT = 20
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"])

export const RULE_LEVELS = Object.freeze({
  "module-isolation": "warn",
  "api-no-put-patch": "warn",
  "external-config-anchor": "error",
  "code-map-freshness": "error",
  "readme-freshness": "error",
  "view-element-limit": "error",
  "likec4-validation": "error",
})

const MODULE_MODEL_IDS = Object.freeze({
  "abandoned-cart-reminder": "abandonedCartReminder",
  cart: "cartVersioning",
  "cart-merge-operation": "cartMergeOperation",
  "cms-snapshot": "cmsSnapshot",
  "erp-integration-registry": "erpIntegrationRegistry",
  meilisearch: "meilisearchModule",
  "moysklad-integration": "moyskladIntegration",
  "notification-domain": "notificationDomain",
  "notification-e2e": "notificationE2e",
  "notification-smtp": "notificationSmtp",
  "order-fixation": "orderFixation",
  "payment-operation": "paymentOperation",
  "payment-provider-config": "paymentProviderConfig",
  "shipping-provider-registry": "shippingProviderRegistry",
  "site-content": "siteContent",
  "store-pickup": "storePickup",
  wishlist: "wishlist",
})

const PROVIDER_MODEL_IDS = Object.freeze({
  "fulfillment-cdek": "fulfillmentCdek",
  "fulfillment-ozon": "fulfillmentOzon",
  "payment-e2e": "paymentE2e",
  "payment-yookassa-runtime": "paymentYookassaRuntime",
})

function diagnostic(rule, severity, message, file, line) {
  return { rule, severity, message, ...(file ? { file } : {}), ...(line ? { line } : {}) }
}

function extensionOf(path) {
  const match = /\.[^.\/]+$/.exec(path)
  return match?.[0] ?? ""
}

async function walkSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walkSourceFiles(path)))
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extensionOf(entry.name))) files.push(path)
  }
  return files
}

function withoutComments(source) {
  let output = ""
  let state = "code"
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (state === "line-comment") {
      if (char === "\n") {
        output += char
        state = "code"
      } else output += " "
      continue
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        output += "  "
        index += 1
        state = "code"
      } else output += char === "\n" ? "\n" : " "
      continue
    }
    if (state === "single" || state === "double" || state === "template") {
      output += char
      if (char === "\\") {
        output += next ?? ""
        index += 1
      } else if (
        (state === "single" && char === "'") ||
        (state === "double" && char === '"') ||
        (state === "template" && char === "`")
      ) state = "code"
      continue
    }
    if (char === "/" && next === "/") {
      output += "  "
      index += 1
      state = "line-comment"
    } else if (char === "/" && next === "*") {
      output += "  "
      index += 1
      state = "block-comment"
    } else {
      output += char
      if (char === "'") state = "single"
      else if (char === '"') state = "double"
      else if (char === "`") state = "template"
    }
  }
  return output
}

export function extractImportSpecifiers(source) {
  const code = withoutComments(source)
  const found = []
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:(?!\b(?:import|export)\b)[\s\S])*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const specifierOffset = match[0].lastIndexOf(match[1])
      found.push({ specifier: match[1], index: (match.index ?? 0) + specifierOffset })
    }
  }
  return found.sort((a, b) => a.index - b.index)
}

function importTarget(specifier, file, root) {
  if (specifier.startsWith(".")) return resolve(dirname(file), specifier)
  if (specifier.startsWith("src/modules/")) return resolve(root, specifier)
  if (specifier.startsWith("@/modules/")) {
    return resolve(root, "src", specifier.slice(2))
  }
  return null
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length
}

export async function checkModuleIsolation(root, severity = RULE_LEVELS["module-isolation"]) {
  const modulesRoot = resolve(root, "src/modules")
  if (!existsSync(modulesRoot)) return []
  const files = await walkSourceFiles(modulesRoot)
  const diagnostics = []
  for (const file of files) {
    const sourceModule = relative(modulesRoot, file).split(sep)[0]
    const source = await readFile(file, "utf8")
    for (const imported of extractImportSpecifiers(source)) {
      const target = importTarget(imported.specifier, file, root)
      if (!target) continue
      const relativeTarget = relative(modulesRoot, target)
      if (relativeTarget.startsWith(`..${sep}`) || relativeTarget === "..") continue
      const targetModule = relativeTarget.split(sep)[0]
      if (targetModule && targetModule !== sourceModule) {
        diagnostics.push(diagnostic(
          "module-isolation",
          severity,
          `${sourceModule} imports ${targetModule} via ${JSON.stringify(imported.specifier)}`,
          relative(root, file),
          lineAt(source, imported.index)
        ))
      }
    }
  }
  return diagnostics
}

export function exportedForbiddenMethods(source) {
  const code = withoutComments(source)
  const findings = []
  const directPatterns = [
    /^\s*export\s+(?:async\s+)?function\s+(PUT|PATCH)\b/gm,
    /^\s*export\s+(?:const|let|var)\s+(PUT|PATCH)\b/gm,
  ]
  for (const pattern of directPatterns) {
    for (const match of code.matchAll(pattern)) {
      findings.push({ method: match[1], index: match.index ?? 0 })
    }
  }
  for (const match of code.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const item of match[1].split(",")) {
      const alias = /(?:^|\s)as\s+(PUT|PATCH)\s*$/.exec(item)
      const direct = /^\s*(PUT|PATCH)\s*$/.exec(item)
      const method = alias?.[1] ?? direct?.[1]
      if (method) findings.push({ method, index: match.index ?? 0 })
    }
  }
  return findings.sort((a, b) => a.index - b.index)
}

export async function checkApiMethods(root, severity = RULE_LEVELS["api-no-put-patch"]) {
  const apiRoot = resolve(root, "src/api")
  if (!existsSync(apiRoot)) return []
  const diagnostics = []
  for (const file of await walkSourceFiles(apiRoot)) {
    const source = await readFile(file, "utf8")
    for (const finding of exportedForbiddenMethods(source)) {
      diagnostics.push(diagnostic(
        "api-no-put-patch",
        severity,
        `API route exports forbidden ${finding.method} handler`,
        relative(root, file),
        lineAt(source, finding.index)
      ))
    }
  }
  return diagnostics
}

function balancedBlock(source, openingBrace) {
  let depth = 0
  let quote = null
  for (let index = openingBrace; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === "\\") index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === "{") depth += 1
    else if (char === "}") {
      depth -= 1
      if (depth === 0) return { body: source.slice(openingBrace + 1, index), end: index }
    }
  }
  throw new Error(`Unclosed block at offset ${openingBrace}`)
}

function parseQuoted(value) {
  if (value.startsWith('"')) return JSON.parse(value)
  return value.slice(1, -1).replaceAll("\\'", "'").replaceAll("\\\\", "\\")
}

function parseMetadata(body) {
  const match = /\bmetadata\s*\{/.exec(body)
  if (!match) return {}
  const openingBrace = (match.index ?? 0) + match[0].lastIndexOf("{")
  const metadataBody = balancedBlock(body, openingBrace).body
  const result = {}
  const propertyPattern = /\b([A-Za-z_][\w-]*)\s+(\[(?:[^\]"']|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')*\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g
  for (const property of metadataBody.matchAll(propertyPattern)) {
    const raw = property[2].trim()
    result[property[1]] = raw.startsWith("[")
      ? [...raw.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g)].map((item) => parseQuoted(item[0]))
      : [parseQuoted(raw)]
  }
  return result
}

export function externalElements(modelSource) {
  const elements = []
  const pattern = /\b([A-Za-z_][\w-]*)\s*=\s*external\b[^\{]*\{/g
  for (const match of modelSource.matchAll(pattern)) {
    const openingBrace = (match.index ?? 0) + match[0].lastIndexOf("{")
    const block = balancedBlock(modelSource, openingBrace)
    elements.push({ id: match[1], metadata: parseMetadata(block.body) })
  }
  return elements
}

export function checkExternalConfigAnchors(
  modelSource,
  configSource,
  severity = RULE_LEVELS["external-config-anchor"]
) {
  const diagnostics = []
  const configuredEnv = new Set(
    [...configSource.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1])
  )
  for (const external of externalElements(modelSource)) {
    const anchors = external.metadata.configAnchor ?? []
    if (anchors.length === 0) {
      diagnostics.push(diagnostic(
        "external-config-anchor",
        severity,
        `External ${external.id} has no configAnchor metadata`
      ))
    }
    for (const anchor of anchors) {
      if (!configSource.includes(anchor)) {
        diagnostics.push(diagnostic(
          "external-config-anchor",
          severity,
          `External ${external.id} anchor ${JSON.stringify(anchor)} is absent from medusa-config.ts`
        ))
      }
    }

    const declaredEnv = new Set(external.metadata.env ?? [])
    for (const envName of declaredEnv) {
      if (!configuredEnv.has(envName)) {
        diagnostics.push(diagnostic(
          "external-config-anchor",
          severity,
          `External ${external.id} env ${envName} is absent from medusa-config.ts`
        ))
      }
    }
    for (const prefix of external.metadata.envPrefix ?? []) {
      for (const envName of configuredEnv) {
        if (envName.startsWith(prefix) && !declaredEnv.has(envName)) {
          diagnostics.push(diagnostic(
            "external-config-anchor",
            severity,
            `External ${external.id} omits modeled config env ${envName}`
          ))
        }
      }
    }
  }
  return diagnostics
}

function viewBlocks(modelSource) {
  const blocks = []
  const pattern = /\bview\s+([A-Za-z_][\w-]*)(?:\s+of\s+[A-Za-z_][\w.-]*)?\s*\{/g
  for (const match of modelSource.matchAll(pattern)) {
    const openingBrace = (match.index ?? 0) + match[0].lastIndexOf("{")
    const block = balancedBlock(modelSource, openingBrace)
    blocks.push({ id: match[1], body: block.body })
  }
  return blocks
}

export function viewElementCounts(modelSource) {
  const counts = new Map()
  for (const view of viewBlocks(modelSource)) {
    const elements = new Set()
    const includePattern = /(?:^|\n)\s*include\s+([\s\S]*?)(?=\n\s*(?:include|exclude|style|autoLayout|routing|title|description|link)\b|$)/g
    for (const include of view.body.matchAll(includePattern)) {
      for (const expression of include[1].split(",")) {
        const normalized = expression.trim().replace(/\s+with\s*\{[\s\S]*$/, "")
        if (normalized) elements.add(normalized)
      }
    }
    counts.set(view.id, elements.size)
  }
  return counts
}

export function checkViewElementLimit(
  modelSource,
  limit = VIEW_ELEMENT_LIMIT,
  severity = RULE_LEVELS["view-element-limit"]
) {
  const diagnostics = []
  for (const [view, count] of viewElementCounts(modelSource)) {
    if (count > limit) {
      diagnostics.push(diagnostic(
        "view-element-limit",
        severity,
        `View ${view} includes ${count} elements; limit is ${limit}`
      ))
    }
  }
  return diagnostics
}

export function checkGeneratedFreshness(
  actual,
  expected,
  rule = "code-map-freshness",
  file = "docs/c4/code-map.md",
  severity = RULE_LEVELS[rule] ?? "error"
) {
  return actual === expected
    ? []
    : [diagnostic(rule, severity, `${file} is stale; run npm run architecture:write`, file)]
}

async function directoryNames(path) {
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function markdownList(values) {
  return values.map((value) => `\`${value}\``).join(", ")
}

export async function generateCodeMap(root) {
  const modules = await directoryNames(resolve(root, "src/modules"))
  const providers = await directoryNames(resolve(root, "src/providers"))
  const adminGroups = await directoryNames(resolve(root, "src/api/admin"))
  const storeGroups = await directoryNames(resolve(root, "src/api/store"))

  const lines = [
    "<!-- GENERATED by scripts/architecture-check.mjs. DO NOT EDIT. -->",
    "",
    "# Architecture code map",
    "",
    "## Entry points",
    "",
    "| Model element | Source | Discovered groups |",
    "|---|---|---|",
    `| \`backend.adminApi\` | \`src/api/admin\` | ${markdownList(adminGroups)} |`,
    `| \`backend.storeApi\` | \`src/api/store\` | ${markdownList(storeGroups)} |`,
    "| `backend.workflows` | `src/workflows` | one component by design |",
    "| `backend.subscribers` | `src/subscribers` | one component by design |",
    "| `backend.jobs` | `src/jobs` | one component by design |",
    "",
    "## Modules",
    "",
    "| Model element | Source |",
    "|---|---|",
  ]
  for (const moduleName of modules) {
    const modelId = MODULE_MODEL_IDS[moduleName] ?? `UNMAPPED:${moduleName}`
    lines.push(`| \`backend.${modelId}\` | \`src/modules/${moduleName}\` |`)
  }
  lines.push(
    "",
    "## Providers",
    "",
    "| Model element | Source |",
    "|---|---|"
  )
  for (const providerName of providers) {
    const modelId = PROVIDER_MODEL_IDS[providerName] ?? `UNMAPPED:${providerName}`
    lines.push(`| \`backend.${modelId}\` | \`src/providers/${providerName}\` |`)
  }
  lines.push(
    "",
    "## Deliberately not modeled as components",
    "",
    "- `src/modules/README.md` is the Medusa generator template, not a module.",
    "- `src/links/README.md` is the only file under `src/links`; no module link exists to model.",
    "- `src/admin` is a client customization bundled with this backend and calls the Admin API; it is not another deployable service.",
    "- `@medusajs/medusa/fulfillment-manual` is a built-in package registered in `medusa-config.ts`, not a custom provider under `src/providers`.",
    "- E2E notification/payment stubs are modeled as local components where source directories exist, but not as production external systems.",
    ""
  )
  return lines.join("\n")
}

function likec4Invocation(root, args) {
  const localBinary = resolve(root, "node_modules/.bin/likec4")
  if (existsSync(localBinary)) return { command: localBinary, args }
  return {
    command: "npx",
    args: ["--yes", `likec4@${LIKEC4_VERSION}`, ...args],
  }
}

function runLikec4(root, args, cwd = root) {
  const invocation = likec4Invocation(root, args)
  const toolStateRoot = join(tmpdir(), "catalog-backend-architecture-check")
  return spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(toolStateRoot, "config"),
      npm_config_cache: join(toolStateRoot, "npm-cache"),
    },
  })
}

function likec4ValidationDiagnostic(result) {
  if (result.status === 0) return []
  const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
  return [diagnostic(
    "likec4-validation",
    RULE_LEVELS["likec4-validation"],
    `LikeC4 validation failed${detail ? `:\n${detail}` : ""}`,
    "docs/c4/model.likec4"
  )]
}

async function exportReadme(root, targetDirectory) {
  // --no-use-dot: outside a container the CLI defaults to its bundled WASM layouter, but it
  // auto-detects a container and tries the system `dot` binary there instead. CI runs in
  // node:22-bookworm without Graphviz installed, so the auto-detection picks the wrong engine.
  const result = runLikec4(root, ["export", "markdown", "--no-use-dot", targetDirectory])
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
    throw new Error(`likec4 export markdown failed${detail ? `:\n${detail}` : ""}`)
  }
  return readFile(resolve(targetDirectory, "README.md"), "utf8")
}

async function expectedReadme(root) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "catalog-c4-"))
  try {
    await copyFile(resolve(root, "docs/c4/model.likec4"), resolve(temporaryRoot, "model.likec4"))
    await copyFile(
      resolve(root, "docs/c4/likec4.config.json"),
      resolve(temporaryRoot, "likec4.config.json")
    )
    return await exportReadme(root, temporaryRoot)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

function printDiagnostics(diagnostics) {
  for (const item of diagnostics) {
    const location = item.file ? `${item.file}${item.line ? `:${item.line}` : ""}: ` : ""
    const stream = item.severity === "error" ? process.stderr : process.stdout
    stream.write(`${item.severity.toUpperCase()} [${item.rule}] ${location}${item.message}\n`)
  }
}

export async function runArchitectureCheck({ root, write = false }) {
  const modelPath = resolve(root, "docs/c4/model.likec4")
  const codeMapPath = resolve(root, "docs/c4/code-map.md")
  const readmePath = resolve(root, "docs/c4/README.md")
  const modelSource = await readFile(modelPath, "utf8")
  const configSource = await readFile(resolve(root, "medusa-config.ts"), "utf8")
  const generatedCodeMap = await generateCodeMap(root)

  if (write) {
    await mkdir(dirname(codeMapPath), { recursive: true })
    await writeFile(codeMapPath, generatedCodeMap)
    await exportReadme(root, resolve(root, "docs/c4"))
  }

  const diagnostics = [
    ...(await checkModuleIsolation(root)),
    ...(await checkApiMethods(root)),
    ...checkExternalConfigAnchors(modelSource, configSource),
    ...checkViewElementLimit(modelSource),
  ]

  const actualCodeMap = existsSync(codeMapPath) ? await readFile(codeMapPath, "utf8") : ""
  diagnostics.push(...checkGeneratedFreshness(actualCodeMap, generatedCodeMap))

  try {
    const generatedReadme = await expectedReadme(root)
    const actualReadme = existsSync(readmePath) ? await readFile(readmePath, "utf8") : ""
    diagnostics.push(...checkGeneratedFreshness(
      actualReadme,
      generatedReadme,
      "readme-freshness",
      "docs/c4/README.md"
    ))
  } catch (error) {
    diagnostics.push(diagnostic(
      "likec4-validation",
      "error",
      error instanceof Error ? error.message : String(error),
      "docs/c4/model.likec4"
    ))
  }

  const validation = runLikec4(root, [
    "validate",
    "--json",
    "--no-layout",
    "--file",
    "docs/c4/model.likec4",
    "docs/c4",
  ])
  diagnostics.push(...likec4ValidationDiagnostic(validation))

  printDiagnostics(diagnostics)
  const errors = diagnostics.filter((item) => item.severity === "error")
  const warnings = diagnostics.filter((item) => item.severity === "warn")
  process.stdout.write(
    `Architecture check: ${errors.length} error(s), ${warnings.length} warning(s).\n`
  )
  return { diagnostics, exitCode: errors.length === 0 ? 0 : 1 }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const result = await runArchitectureCheck({ root, write: process.argv.includes("--write") })
  process.exitCode = result.exitCode
}
