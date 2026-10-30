import fs from "node:fs";
import path from "node:path";
const layers = ["app", "pages", "widgets", "features", "entities", "shared"];
const errors = [];
function walk(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) walk(full);
    else if (/\.[jt]sx?$/.test(item.name)) inspect(full);
  }
}
function inspect(file) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative("src", file).replaceAll("\\", "/");
  const [layer, slice] = relative.split("/");
  for (const match of source.matchAll(
    /(?:from\s*|import\s*)['"](@\/[^'"]+|\.[^'"]+)['"]/g,
  )) {
    let target;
    if (match[1].startsWith("@/")) target = match[1].slice(2);
    else
      target = path
        .relative("src", path.resolve(path.dirname(file), match[1]))
        .replaceAll("\\", "/");
    const [dest, destSlice, ...rest] = target.split("/");
    const fromIndex = layers.indexOf(layer),
      toIndex = layers.indexOf(dest);
    if (toIndex < 0 || fromIndex < 0) continue;
    if (toIndex < fromIndex)
      errors.push(`${relative}: upward import ${match[1]}`);
    if (
      layer === dest &&
      slice !== destSlice &&
      !["app", "shared"].includes(layer)
    )
      errors.push(`${relative}: cross-slice import ${match[1]}`);
    if (
      layer !== dest &&
      dest !== "app" &&
      !["shared"].includes(dest) &&
      rest.length &&
      !(
        dest === "entities" &&
        destSlice === "product" &&
        rest.join("/") === "server"
      )
    )
      errors.push(`${relative}: non-public import ${match[1]}`);
  }
}
walk("src");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "FSD: all imports descend through public APIs; no cross-slice imports.",
  );
