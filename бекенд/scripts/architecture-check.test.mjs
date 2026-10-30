import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, test } from "node:test"

import {
  checkApiMethods,
  checkExternalConfigAnchors,
  checkGeneratedFreshness,
  checkModuleIsolation,
  checkViewElementLimit,
} from "./architecture-check.mjs"

const temporaryDirectories = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "architecture-check-test-"))
  temporaryDirectories.push(root)
  return root
}

async function put(root, path, contents) {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, contents)
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

test("module isolation accepts local imports", async () => {
  const root = await fixture()
  await put(root, "src/modules/alpha/index.ts", 'export { value } from "./value"\n')
  await put(root, "src/modules/alpha/value.ts", "export const value = 1\n")

  assert.deepEqual(await checkModuleIsolation(root, "error"), [])
})

test("module isolation reports an import from another module", async () => {
  const root = await fixture()
  await put(
    root,
    "src/modules/alpha/index.ts",
    'import {\n  betaValue,\n} from "../beta"\n'
  )
  await put(root, "src/modules/beta/index.ts", "export default {}\n")

  const diagnostics = await checkModuleIsolation(root, "error")
  assert.equal(diagnostics.length, 1)
  assert.match(diagnostics[0].message, /alpha imports beta/)
})

test("API method rule accepts GET, POST and DELETE", async () => {
  const root = await fixture()
  await put(
    root,
    "src/api/store/example/route.ts",
    "export async function GET() {}\nexport const POST = () => {}\nexport { remove as DELETE }\n"
  )

  assert.deepEqual(await checkApiMethods(root, "error"), [])
})

test("API method rule reports PUT and PATCH exports", async () => {
  const root = await fixture()
  await put(
    root,
    "src/api/store/example/route.ts",
    "export async function PUT() {}\nconst update = () => {}\nexport { update as PATCH }\n"
  )

  const diagnostics = await checkApiMethods(root, "error")
  assert.deepEqual(diagnostics.map((item) => item.message), [
    "API route exports forbidden PUT handler",
    "API route exports forbidden PATCH handler",
  ])
})

test("external anchors accept registered providers and complete env prefixes", () => {
  const model = `
    model {
      mail = external 'Mail' {
        metadata {
          configAnchor './mail-provider'
          env ['MAIL_HOST', 'MAIL_TOKEN']
          envPrefix 'MAIL_'
        }
      }
      billing = external 'Billing' {
        metadata { configAnchor './billing-provider'; credentials 'database-managed' }
      }
    }
  `
  const config = `
    resolve: './mail-provider', host: process.env.MAIL_HOST, token: process.env.MAIL_TOKEN
    resolve: './billing-provider'
  `

  assert.deepEqual(checkExternalConfigAnchors(model, config), [])
})

test("external anchors report missing forward and reverse mappings", () => {
  const model = `
    model {
      mail = external 'Mail' {
        metadata {
          configAnchor './wrong-provider'
          env ['MAIL_HOST']
          envPrefix 'MAIL_'
        }
      }
    }
  `
  const config = `
    resolve: './mail-provider', host: process.env.MAIL_HOST, token: process.env.MAIL_TOKEN
  `

  const messages = checkExternalConfigAnchors(model, config).map((item) => item.message)
  assert.ok(messages.some((message) => message.includes("anchor")))
  assert.ok(messages.some((message) => message.includes("MAIL_TOKEN")))
})

test("generated-file freshness accepts equal content", () => {
  assert.deepEqual(checkGeneratedFreshness("same\n", "same\n"), [])
})

test("generated-file freshness reports drift", () => {
  const diagnostics = checkGeneratedFreshness("old\n", "new\n")
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].rule, "code-map-freshness")
})

test("view ceiling accepts a view with twenty explicit elements", () => {
  const elements = Array.from({ length: 20 }, (_, index) => `item${index}`).join(", ")
  const source = `views { view index { include ${elements}\n autoLayout LeftRight } }`
  assert.deepEqual(checkViewElementLimit(source), [])
})

test("view ceiling rejects a view with twenty-one explicit elements", () => {
  const elements = Array.from({ length: 21 }, (_, index) => `item${index}`).join(", ")
  const source = `views { view crowded { include ${elements}\n autoLayout LeftRight } }`
  const diagnostics = checkViewElementLimit(source)
  assert.equal(diagnostics.length, 1)
  assert.match(diagnostics[0].message, /21 elements; limit is 20/)
})
