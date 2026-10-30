// Medusa's main tsconfig excludes CLI and migration scripts. Ship them as JS
// so fresh production databases can run the same migrations as development.
const fs = require("node:fs")
const path = require("node:path")
const ts = require("typescript")
function compile(directory) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue
    const sourcePath = path.join(directory, entry.name)
    if (entry.isDirectory()) { compile(sourcePath); continue }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue
    const outputPath = path.join(".medusa/server", sourcePath.replace(/\.ts$/, ".js"))
    const result = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
      fileName: sourcePath,
    })
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, result.outputText)
  }
}
compile("src/scripts")
compile("src/migration-scripts")
