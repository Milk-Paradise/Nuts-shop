import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  updateInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows";

import {
  seedCommerceBaseline,
  type CommerceBaselineResult,
} from "./seed-commerce";
import { MEILISEARCH_MODULE } from "../modules/meilisearch";
import type MeilisearchModuleService from "../modules/meilisearch/service";
import { reindexCatalogDocuments } from "../modules/meilisearch/sync";
import type { AvailabilityStatus } from "../utils/availability";

const DEFAULT_TARGET_PRODUCTS = 300;
const DEFAULT_WARMUP_REQUESTS = 2;
const DEFAULT_ITERATIONS_PER_SCENARIO = 24;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_BUDGET_MS = 300;
const PRODUCT_CHUNK_SIZE = 50;

type QueryGraph = {
  graph(input: {
    entity: string;
    fields: string[];
    filters?: Record<string, unknown>;
    pagination?: Record<string, unknown>;
  }): Promise<{ data: Record<string, any>[] }>;
};

type PerfCategory = {
  id: string;
  name: string;
  handle: string;
};

type PerfProductDefinition = {
  title: string;
  handle: string;
  category: PerfCategory;
  brand: string;
  sku: string;
  price: number;
  allowBackorder: boolean;
  stockedQuantity: number;
};

type BenchmarkScenario = {
  name: string;
  params: Record<string, string | number>;
};

type Measurement = {
  scenario: string;
  durationMs: number;
  processingTimeMs: number | null;
};

type CatalogSearchBenchmarkResponse = {
  products: unknown[];
  total: number;
  processing_time_ms: number;
};

const perfCategories = [
  { handle: "perf-search-enamels", name: "Автоэмали" },
  { handle: "perf-search-primers", name: "Грунты" },
  { handle: "perf-search-clear-coats", name: "Лаки" },
  { handle: "perf-search-consumables", name: "Расходники" },
];

const brands = ["Sprint", "Mobihel", "Novol", "Reoflex", "Brulex", "Mipa"];

const productFamilies = [
  {
    code: "ENAMEL",
    title: "Акриловая эмаль",
    categoryHandle: "perf-search-enamels",
  },
  {
    code: "PRIMER",
    title: "Грунт акриловый",
    categoryHandle: "perf-search-primers",
  },
  { code: "CLEAR", title: "Лак HS", categoryHandle: "perf-search-clear-coats" },
  {
    code: "TAPE",
    title: "Малярная лента",
    categoryHandle: "perf-search-consumables",
  },
  {
    code: "THINNER",
    title: "Разбавитель",
    categoryHandle: "perf-search-consumables",
  },
];

const scenarios: BenchmarkScenario[] = [
  {
    name: "search + brand + in_stock",
    params: {
      q: "эмаль",
      brand: "Sprint",
      availability: "in_stock",
      limit: 24,
    },
  },
  {
    name: "search + category + price",
    params: {
      q: "грунт",
      category: "Грунты",
      min_price: 500,
      max_price: 5000,
      limit: 24,
    },
  },
  {
    name: "search + backorder",
    params: {
      q: "лак",
      availability: "backorder",
      limit: 24,
    },
  },
  {
    name: "filters only",
    params: {
      category: "Расходники",
      brand: "Reoflex",
      min_price: 300,
      max_price: 9000,
      limit: 24,
    },
  },
  {
    name: "article search",
    params: {
      q: "PERF-120",
      limit: 24,
    },
  },
];

function query(container: MedusaContainer) {
  return container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph;
}

function envInteger(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function envUrl() {
  const raw =
    process.env.CATALOG_SEARCH_BENCHMARK_URL ??
    process.env.MEDUSA_BACKEND_URL ??
    "http://localhost:9000";

  return raw.replace(/\/+$/, "");
}

function p95(values: number[]) {
  if (!values.length) return 0;

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * 0.95) - 1,
  );

  return sorted[index];
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

function productHandle(index: number) {
  return `perf-search-product-${String(index + 1).padStart(3, "0")}`;
}

function productSku(index: number, familyCode: string) {
  return `PERF-${String(index + 1).padStart(3, "0")}-${familyCode}`;
}

function expectedAvailability(
  definition: PerfProductDefinition,
): AvailabilityStatus {
  if (definition.stockedQuantity > 0) return "in_stock";
  if (definition.allowBackorder) return "backorder";

  return "out_of_stock";
}

async function existingHandles(container: MedusaContainer, handles: string[]) {
  if (!handles.length) return new Set<string>();

  const { data } = await query(container).graph({
    entity: "product",
    fields: ["handle"],
    filters: { handle: handles },
    pagination: { take: handles.length, skip: 0 },
  });

  return new Set(
    data
      .map((product) => product.handle)
      .filter((handle): handle is string => typeof handle === "string"),
  );
}

async function ensurePerfCategories(container: MedusaContainer) {
  const handles = perfCategories.map((category) => category.handle);
  const { data: existing } = await query(container).graph({
    entity: "product_category",
    fields: ["id", "name", "handle"],
    filters: { handle: handles },
    pagination: { take: handles.length, skip: 0 },
  });
  const byHandle = new Map<string, PerfCategory>(
    existing
      .filter((category) => category.id && category.handle && category.name)
      .map((category) => [
        category.handle as string,
        {
          id: category.id as string,
          name: category.name as string,
          handle: category.handle as string,
        },
      ]),
  );
  const missing = perfCategories.filter(
    (category) => !byHandle.has(category.handle),
  );

  if (missing.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missing.map((category) => ({
          name: category.name,
          handle: category.handle,
          is_active: true,
        })),
      },
    });

    for (const category of result) {
      byHandle.set(category.handle, {
        id: category.id,
        name: category.name,
        handle: category.handle,
      });
    }
  }

  return byHandle;
}

function productDefinition(
  index: number,
  categories: Map<string, PerfCategory>,
): PerfProductDefinition {
  const family = productFamilies[index % productFamilies.length];
  const category = categories.get(family.categoryHandle);

  if (!category) {
    throw new Error(
      `Performance category ${family.categoryHandle} was not created`,
    );
  }

  const brand = brands[index % brands.length];
  const availability = index % 3;
  const allowBackorder = availability === 1;
  const stockedQuantity = availability === 0 ? 4 + (index % 30) : 0;
  const price = 450 + ((index * 73) % 9000);

  return {
    title: `${family.title} ${brand} ${String(index + 1).padStart(3, "0")}`,
    handle: productHandle(index),
    category,
    brand,
    sku: productSku(index, family.code),
    price,
    allowBackorder,
    stockedQuantity,
  };
}

async function seedPerfProducts(
  container: MedusaContainer,
  baseline: CommerceBaselineResult,
  targetProducts: number,
) {
  const categories = await ensurePerfCategories(container);
  const definitions = Array.from({ length: targetProducts }, (_, index) =>
    productDefinition(index, categories),
  );
  const handles = definitions.map((product) => product.handle);
  const existing = await existingHandles(container, handles);
  const missing = definitions.filter(
    (product) => !existing.has(product.handle),
  );
  const createdHandles: string[] = [];

  for (let index = 0; index < missing.length; index += PRODUCT_CHUNK_SIZE) {
    const chunk = missing.slice(index, index + PRODUCT_CHUNK_SIZE);
    const { result } = await createProductsWorkflow(container).run({
      input: {
        products: chunk.map((product) => ({
          title: product.title,
          handle: product.handle,
          description: `Performance fixture for catalog search benchmark ${product.sku}.`,
          status: ProductStatus.PUBLISHED,
          category_ids: [product.category.id],
          shipping_profile_id: baseline.shippingProfile.id,
          thumbnail: `https://example.test/perf/${product.handle}.jpg`,
          metadata: {
            brand: product.brand,
            characteristics: {
              Серия: "Performance",
              Индекс: product.sku,
            },
          },
          options: [{ title: "Фасовка", values: ["1 л"] }],
          variants: [
            {
              title: "1 л",
              sku: product.sku,
              manage_inventory: true,
              allow_backorder: product.allowBackorder,
              options: { Фасовка: "1 л" },
              prices: [
                {
                  amount: product.price,
                  currency_code: "rub",
                },
              ],
            },
          ],
          sales_channels: [{ id: baseline.salesChannel.id }],
        })),
      },
    });

    createdHandles.push(...result.map((product) => product.handle));
  }

  await ensurePerfInventory(container, baseline, definitions);

  return {
    targetProducts,
    createdProducts: createdHandles.length,
    existingProducts: targetProducts - missing.length,
    definitions,
  };
}

async function ensurePerfInventory(
  container: MedusaContainer,
  baseline: CommerceBaselineResult,
  definitions: PerfProductDefinition[],
) {
  const definitionByHandle = new Map(
    definitions.map((definition) => [definition.handle, definition]),
  );
  const { data: products } = await query(container).graph({
    entity: "product",
    fields: [
      "handle",
      "variants.sku",
      "variants.inventory_items.inventory_item_id",
    ],
    filters: { handle: definitions.map((definition) => definition.handle) },
    pagination: { take: definitions.length, skip: 0 },
  });
  const desiredLevels = products.map((product) => {
    const handle = product.handle as string;
    const definition = definitionByHandle.get(handle);
    const variant = product.variants?.[0];
    const inventoryItemId = variant?.inventory_items?.[0]?.inventory_item_id;

    if (!definition || !inventoryItemId) {
      throw new Error(
        `Performance product ${handle} is missing inventory linkage`,
      );
    }

    return {
      inventory_item_id: inventoryItemId,
      location_id: baseline.stockLocation.id,
      stocked_quantity: definition.stockedQuantity,
    };
  });
  const { data: existingLevels } = await query(container).graph({
    entity: "inventory_level",
    fields: ["id", "inventory_item_id"],
    filters: {
      inventory_item_id: desiredLevels.map((level) => level.inventory_item_id),
      location_id: baseline.stockLocation.id,
    },
    pagination: { take: desiredLevels.length, skip: 0 },
  });
  const existingByInventoryItem = new Map(
    existingLevels.map((level) => [
      level.inventory_item_id as string,
      level.id as string,
    ]),
  );
  const updates = desiredLevels.flatMap((level) => {
    const id = existingByInventoryItem.get(level.inventory_item_id);

    return id ? [{ id, ...level }] : [];
  });
  const creates = desiredLevels.filter(
    (level) => !existingByInventoryItem.has(level.inventory_item_id),
  );

  if (updates.length) {
    await updateInventoryLevelsWorkflow(container).run({
      input: { updates },
    });
  }

  if (creates.length) {
    await createInventoryLevelsWorkflow(container).run({
      input: { inventory_levels: creates },
    });
  }
}

async function validateIndexedPerfProducts(
  container: MedusaContainer,
  definitions: PerfProductDefinition[],
) {
  const service =
    container.resolve<MeilisearchModuleService>(MEILISEARCH_MODULE);
  const result = await service.searchCatalogDocuments({
    query: "PERF-",
    page: 1,
    hitsPerPage: definitions.length,
  });

  if (
    result.totalHits !== definitions.length ||
    result.hits.length !== definitions.length
  ) {
    throw new Error(
      `Expected ${definitions.length} indexed performance products, found ${result.totalHits}`,
    );
  }

  const bySku = new Map(
    result.hits.flatMap((document) =>
      document.articles.map((article) => [article, document] as const),
    ),
  );
  const invalid = definitions.flatMap((definition) => {
    const document = bySku.get(definition.sku);
    const matches =
      document &&
      document.title === definition.title &&
      document.category === definition.category.name &&
      document.brand === definition.brand &&
      document.price === definition.price &&
      document.availability === expectedAvailability(definition);

    return matches ? [] : [definition.sku];
  });

  if (invalid.length) {
    throw new Error(
      `Indexed performance fixtures do not match their definitions: ${invalid
        .slice(0, 10)
        .join(", ")}${invalid.length > 10 ? ", ..." : ""}`,
    );
  }

  return result.totalHits;
}

function isCatalogSearchBenchmarkResponse(
  body: unknown,
): body is CatalogSearchBenchmarkResponse {
  return (
    !!body &&
    typeof body === "object" &&
    "products" in body &&
    Array.isArray(body.products) &&
    "total" in body &&
    typeof body.total === "number" &&
    "processing_time_ms" in body &&
    typeof body.processing_time_ms === "number"
  );
}

function scenarioUrl(baseUrl: string, scenario: BenchmarkScenario) {
  const url = new URL("/catalog/search", baseUrl);

  for (const [key, value] of Object.entries(scenario.params)) {
    url.searchParams.set(key, String(value));
  }

  return url;
}

async function measureScenario(
  baseUrl: string,
  scenario: BenchmarkScenario,
): Promise<Measurement> {
  const url = scenarioUrl(baseUrl, scenario);
  const startedAt = performance.now();
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new Error(
      `${scenario.name} returned a non-JSON response from ${url.toString()}`,
    );
  }
  const durationMs = performance.now() - startedAt;

  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof body.message === "string"
        ? body.message
        : response.statusText;

    throw new Error(
      `${scenario.name} failed with HTTP ${response.status}: ${message}`,
    );
  }

  if (
    !isCatalogSearchBenchmarkResponse(body) ||
    body.products.length === 0 ||
    body.total <= 0
  ) {
    throw new Error(
      `${scenario.name} returned an invalid or empty catalog search response from ${url.toString()}`,
    );
  }

  return {
    scenario: scenario.name,
    durationMs,
    processingTimeMs: body.processing_time_ms,
  };
}

async function runBenchmark(
  baseUrl: string,
  warmupRequests: number,
  iterationsPerScenario: number,
  concurrency: number,
) {
  for (const scenario of scenarios) {
    for (let index = 0; index < warmupRequests; index++) {
      await measureScenario(baseUrl, scenario);
    }
  }

  const queue = scenarios.flatMap((scenario) =>
    Array.from({ length: iterationsPerScenario }, () => scenario),
  );
  const measurements: Measurement[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < queue.length) {
      const scenario = queue[nextIndex++];
      measurements.push(await measureScenario(baseUrl, scenario));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()),
  );

  return measurements;
}

function summarize(measurements: Measurement[]) {
  const overallP95 = p95(
    measurements.map((measurement) => measurement.durationMs),
  );
  const byScenario = scenarios.map((scenario) => {
    const scenarioMeasurements = measurements.filter(
      (measurement) => measurement.scenario === scenario.name,
    );
    const durations = scenarioMeasurements.map(
      (measurement) => measurement.durationMs,
    );
    const processingTimes = scenarioMeasurements
      .map((measurement) => measurement.processingTimeMs)
      .filter((value): value is number => typeof value === "number");

    return {
      name: scenario.name,
      requests: scenarioMeasurements.length,
      p95_ms: rounded(p95(durations)),
      max_ms: rounded(Math.max(...durations)),
      meili_processing_p95_ms: processingTimes.length
        ? rounded(p95(processingTimes))
        : null,
    };
  });

  return {
    requests: measurements.length,
    p95_ms: rounded(overallP95),
    max_ms: rounded(
      Math.max(...measurements.map((measurement) => measurement.durationMs)),
    ),
    scenarios: byScenario,
  };
}

export default async function benchmarkCatalogSearch({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const baseUrl = envUrl();
  const targetProducts = envInteger(
    "CATALOG_SEARCH_BENCHMARK_PRODUCTS",
    DEFAULT_TARGET_PRODUCTS,
  );
  const warmupRequests = envInteger(
    "CATALOG_SEARCH_BENCHMARK_WARMUP",
    DEFAULT_WARMUP_REQUESTS,
  );
  const iterationsPerScenario = envInteger(
    "CATALOG_SEARCH_BENCHMARK_ITERATIONS",
    DEFAULT_ITERATIONS_PER_SCENARIO,
  );
  const concurrency = envInteger(
    "CATALOG_SEARCH_BENCHMARK_CONCURRENCY",
    DEFAULT_CONCURRENCY,
  );
  const budgetMs = envInteger(
    "CATALOG_SEARCH_BENCHMARK_BUDGET_MS",
    DEFAULT_BUDGET_MS,
  );

  logger.info(
    `Preparing catalog search benchmark with ${targetProducts} performance products...`,
  );

  const baseline = await seedCommerceBaseline(container);
  const seed = await seedPerfProducts(container, baseline, targetProducts);
  const reindex = await reindexCatalogDocuments(container);
  const validatedPerfDocuments = await validateIndexedPerfProducts(
    container,
    seed.definitions,
  );

  logger.info(
    `Benchmark seed ready: ${seed.createdProducts} created, ${seed.existingProducts} reused, ${validatedPerfDocuments} performance fixtures validated (${reindex.indexed} total documents indexed).`,
  );

  const measurements = await runBenchmark(
    baseUrl,
    warmupRequests,
    iterationsPerScenario,
    concurrency,
  );
  const summary = {
    base_url: baseUrl,
    target_products: targetProducts,
    validated_performance_documents: validatedPerfDocuments,
    indexed_documents: reindex.indexed,
    warmup_per_scenario: warmupRequests,
    iterations_per_scenario: iterationsPerScenario,
    concurrency,
    budget_ms: budgetMs,
    ...summarize(measurements),
  };

  logger.info(
    `Catalog search benchmark summary:\n${JSON.stringify(summary, null, 2)}`,
  );

  const overBudgetScenarios = summary.scenarios.filter(
    (scenario) => scenario.p95_ms > budgetMs,
  );

  if (summary.p95_ms > budgetMs || overBudgetScenarios.length) {
    const scenarioDetails = overBudgetScenarios.length
      ? `; scenarios: ${overBudgetScenarios
          .map((scenario) => `${scenario.name} (${scenario.p95_ms}ms)`)
          .join(", ")}`
      : "";

    throw new Error(
      `Catalog search performance budget ${budgetMs}ms exceeded: overall P95 ${summary.p95_ms}ms${scenarioDetails}`,
    );
  }
}
