const fs = require("node:fs/promises");
async function main() {
  const configPath = process.env.NUTS_CONFIG_PATH || "/runtime/catalog.json";
  let settings;
  for (let attempt = 0; attempt < 180; attempt++) {
    try { settings = JSON.parse(await fs.readFile(configPath, "utf8")); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 2000)); }
  }
  if (!settings?.publishableKey || !settings?.regionId) throw new Error("Medusa storefront settings were not initialized");
  process.env.USE_MOCK = "false";
  process.env.CATALOG_API_FORMAT = "medusa";
  process.env.CATALOG_PRODUCTS_PATH = "/store/products";
  process.env.CATALOG_PUBLISHABLE_KEY = settings.publishableKey;
  process.env.CATALOG_REGION_ID = settings.regionId;
  require("./server.js");
}
main().catch((error) => { console.error(error); process.exit(1); });
