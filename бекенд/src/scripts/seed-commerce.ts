import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  batchLinksWorkflow,
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createLocationFulfillmentSetWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createServiceZonesWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateInventoryLevelsWorkflow,
  updateRegionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

const PAYMENT_PROVIDER_ID = "pp_system_default"
const TAX_PROVIDER_ID = "tp_system"
const FULFILLMENT_PROVIDER_ID = "manual_manual"

export const COMMERCE_BASELINE = {
  salesChannelName: "Auto Paint Storefront",
  apiKeyTitle: "Auto Paint Storefront Publishable API Key",
  storeName: "Auto Paint Store",
  regionName: "Russia",
  countryCode: "ru",
  currencyCode: "rub",
  stockLocationName: "Main Warehouse",
  fulfillmentSetName: "Main Warehouse Fulfillment",
  serviceZoneName: "Russia",
  shippingProfileName: "Default Shipping Profile",
  shippingOptionName: "Manual Delivery",
}

type DemoCategoryDefinition = {
  name: string
  handle: string
  parentHandle?: string
  rank: number
}

type DemoVariantDefinition = {
  title: string
  sku: string
  optionValue: string
  price: number
  stockedQuantity: number
  allowBackorder: boolean
}

type DemoProductDefinition = {
  title: string
  handle: string
  description: string
  categoryHandle: string
  brand: string
  optionTitle: string
  characteristics: Record<string, string>
  variants: DemoVariantDefinition[]
}

export type DemoCatalogResult = {
  categories: Record<string, any>[]
  products: Record<string, any>[]
}

export const DEMO_CATALOG: {
  categories: DemoCategoryDefinition[]
  products: DemoProductDefinition[]
} = {
  categories: [
    { name: "Paint", handle: "paint", rank: 0 },
    {
      name: "Base Coats",
      handle: "base-coats",
      parentHandle: "paint",
      rank: 0,
    },
    {
      name: "Acrylic Enamels",
      handle: "acrylic-enamels",
      parentHandle: "paint",
      rank: 1,
    },
    {
      name: "Clear Coats",
      handle: "clear-coats",
      parentHandle: "paint",
      rank: 2,
    },
    { name: "Primers", handle: "primers", rank: 1 },
    {
      name: "Acrylic Primers",
      handle: "acrylic-primers",
      parentHandle: "primers",
      rank: 0,
    },
    {
      name: "Epoxy Primers",
      handle: "epoxy-primers",
      parentHandle: "primers",
      rank: 1,
    },
    {
      name: "Fillers",
      handle: "fillers",
      parentHandle: "primers",
      rank: 2,
    },
    { name: "Materials", handle: "materials", rank: 2 },
    {
      name: "Thinners",
      handle: "thinners",
      parentHandle: "materials",
      rank: 0,
    },
    {
      name: "Abrasives",
      handle: "abrasives",
      parentHandle: "materials",
      rank: 1,
    },
    {
      name: "Masking",
      handle: "masking",
      parentHandle: "materials",
      rank: 2,
    },
  ],
  products: [
    {
      title: "Sprint Base Coat Arctic White",
      handle: "demo-sprint-base-coat-arctic-white",
      description: "Solvent base coat for spot repair and full panel painting.",
      categoryHandle: "base-coats",
      brand: "Sprint",
      optionTitle: "Package",
      characteristics: {
        Color: "Arctic white",
        System: "Solvent base",
        Finish: "Gloss before clear coat",
      },
      variants: [
        {
          title: "0.5 L",
          sku: "DEMO-SPRINT-BC-WHITE-05L",
          optionValue: "0.5 L",
          price: 1450,
          stockedQuantity: 18,
          allowBackorder: false,
        },
        {
          title: "1 L",
          sku: "DEMO-SPRINT-BC-WHITE-1L",
          optionValue: "1 L",
          price: 2500,
          stockedQuantity: 0,
          allowBackorder: true,
        },
      ],
    },
    {
      title: "Sprint Base Coat Deep Black",
      handle: "demo-sprint-base-coat-deep-black",
      description: "Ready-to-mix deep black base coat for automotive panels.",
      categoryHandle: "base-coats",
      brand: "Sprint",
      optionTitle: "Package",
      characteristics: {
        Color: "Deep black",
        System: "Solvent base",
        Use: "Body repair",
      },
      variants: [
        {
          title: "1 L",
          sku: "DEMO-SPRINT-BC-BLACK-1L",
          optionValue: "1 L",
          price: 2520,
          stockedQuantity: 0,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Sprint Base Coat Silver Metallic",
      handle: "demo-sprint-base-coat-silver-metallic",
      description: "Fine metallic base coat for silver finishes.",
      categoryHandle: "base-coats",
      brand: "Sprint",
      optionTitle: "Package",
      characteristics: {
        Color: "Silver metallic",
        Effect: "Fine metallic",
        System: "Solvent base",
      },
      variants: [
        {
          title: "0.5 L",
          sku: "DEMO-SPRINT-BC-SILVER-05L",
          optionValue: "0.5 L",
          price: 1680,
          stockedQuantity: 6,
          allowBackorder: false,
        },
        {
          title: "1 L",
          sku: "DEMO-SPRINT-BC-SILVER-1L",
          optionValue: "1 L",
          price: 2940,
          stockedQuantity: 2,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Mobihel Acrylic Enamel Signal Red",
      handle: "demo-mobihel-acrylic-enamel-signal-red",
      description: "Two-component acrylic enamel with strong color coverage.",
      categoryHandle: "acrylic-enamels",
      brand: "Mobihel",
      optionTitle: "Package",
      characteristics: {
        Color: "Signal red",
        System: "2K acrylic",
        Gloss: "High gloss",
      },
      variants: [
        {
          title: "0.8 L",
          sku: "DEMO-MOBIHEL-AE-RED-08L",
          optionValue: "0.8 L",
          price: 1780,
          stockedQuantity: 4,
          allowBackorder: false,
        },
        {
          title: "3.5 L",
          sku: "DEMO-MOBIHEL-AE-RED-35L",
          optionValue: "3.5 L",
          price: 6900,
          stockedQuantity: 0,
          allowBackorder: true,
        },
      ],
    },
    {
      title: "Mobihel Acrylic Enamel Bright Blue",
      handle: "demo-mobihel-acrylic-enamel-bright-blue",
      description: "Durable acrylic enamel for exterior automotive parts.",
      categoryHandle: "acrylic-enamels",
      brand: "Mobihel",
      optionTitle: "Package",
      characteristics: {
        Color: "Bright blue",
        System: "2K acrylic",
        Hardener: "Required",
      },
      variants: [
        {
          title: "0.8 L",
          sku: "DEMO-MOBIHEL-AE-BLUE-08L",
          optionValue: "0.8 L",
          price: 1820,
          stockedQuantity: 0,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Vika Acrylic Enamel Alpine White",
      handle: "demo-vika-acrylic-enamel-alpine-white",
      description: "Budget-friendly acrylic enamel for repair painting.",
      categoryHandle: "acrylic-enamels",
      brand: "Vika",
      optionTitle: "Package",
      characteristics: {
        Color: "Alpine white",
        System: "2K acrylic",
        Gloss: "Gloss",
      },
      variants: [
        {
          title: "0.8 L",
          sku: "DEMO-VIKA-AE-WHITE-08L",
          optionValue: "0.8 L",
          price: 1180,
          stockedQuantity: 12,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Brulex 2K Clear Coat HS",
      handle: "demo-brulex-2k-clear-coat-hs",
      description: "High-solid clear coat for durable gloss finish.",
      categoryHandle: "clear-coats",
      brand: "Brulex",
      optionTitle: "Package",
      characteristics: {
        Type: "HS clear coat",
        Gloss: "High gloss",
        Mix: "2:1",
      },
      variants: [
        {
          title: "1 L",
          sku: "DEMO-BRULEX-CLEAR-HS-1L",
          optionValue: "1 L",
          price: 2100,
          stockedQuantity: 8,
          allowBackorder: false,
        },
        {
          title: "5 L",
          sku: "DEMO-BRULEX-CLEAR-HS-5L",
          optionValue: "5 L",
          price: 8900,
          stockedQuantity: 0,
          allowBackorder: true,
        },
      ],
    },
    {
      title: "Novol Clear Coat MS",
      handle: "demo-novol-clear-coat-ms",
      description: "Medium-solid clear coat for everyday refinishing.",
      categoryHandle: "clear-coats",
      brand: "Novol",
      optionTitle: "Package",
      characteristics: {
        Type: "MS clear coat",
        Gloss: "Gloss",
        Mix: "2:1",
      },
      variants: [
        {
          title: "1 L",
          sku: "DEMO-NOVOL-CLEAR-MS-1L",
          optionValue: "1 L",
          price: 1850,
          stockedQuantity: 0,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Reoflex Matte Clear Coat",
      handle: "demo-reoflex-matte-clear-coat",
      description: "Matte clear coat for special finishes and repairs.",
      categoryHandle: "clear-coats",
      brand: "Reoflex",
      optionTitle: "Package",
      characteristics: {
        Type: "Matte clear coat",
        Finish: "Matte",
        Mix: "2:1",
      },
      variants: [
        {
          title: "1 L",
          sku: "DEMO-REOFLEX-CLEAR-MATTE-1L",
          optionValue: "1 L",
          price: 2050,
          stockedQuantity: 5,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Novol Protect 310 Acrylic Primer Gray",
      handle: "demo-novol-protect-310-acrylic-primer-gray",
      description: "Filling acrylic primer for sanding and surfacing.",
      categoryHandle: "acrylic-primers",
      brand: "Novol",
      optionTitle: "Package",
      characteristics: {
        Color: "Gray",
        Type: "Acrylic primer",
        Sanding: "Wet or dry",
      },
      variants: [
        {
          title: "1 L",
          sku: "DEMO-NOVOL-PRIMER-310-1L",
          optionValue: "1 L",
          price: 1350,
          stockedQuantity: 10,
          allowBackorder: false,
        },
        {
          title: "4 L",
          sku: "DEMO-NOVOL-PRIMER-310-4L",
          optionValue: "4 L",
          price: 4600,
          stockedQuantity: 2,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Reoflex Acrylic Primer White",
      handle: "demo-reoflex-acrylic-primer-white",
      description: "White acrylic primer for light base colors.",
      categoryHandle: "acrylic-primers",
      brand: "Reoflex",
      optionTitle: "Package",
      characteristics: {
        Color: "White",
        Type: "Acrylic primer",
        Use: "Under light colors",
      },
      variants: [
        {
          title: "1 L",
          sku: "DEMO-REOFLEX-PRIMER-WHITE-1L",
          optionValue: "1 L",
          price: 1280,
          stockedQuantity: 0,
          allowBackorder: true,
        },
      ],
    },
    {
      title: "Brulex 2K Epoxy Primer",
      handle: "demo-brulex-2k-epoxy-primer",
      description: "Epoxy anti-corrosion primer for bare metal.",
      categoryHandle: "epoxy-primers",
      brand: "Brulex",
      optionTitle: "Package",
      characteristics: {
        Color: "Light gray",
        Type: "Epoxy primer",
        Protection: "Anti-corrosion",
      },
      variants: [
        {
          title: "1 L",
          sku: "DEMO-BRULEX-EPOXY-PRIMER-1L",
          optionValue: "1 L",
          price: 2400,
          stockedQuantity: 0,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Body 989 Epoxy Primer Spray",
      handle: "demo-body-989-epoxy-primer-spray",
      description: "Aerosol epoxy primer for small repairs.",
      categoryHandle: "epoxy-primers",
      brand: "Body",
      optionTitle: "Package",
      characteristics: {
        Color: "Gray",
        Type: "Epoxy aerosol",
        Volume: "400 ml",
      },
      variants: [
        {
          title: "400 ml",
          sku: "DEMO-BODY-989-EPOXY-SPRAY-400ML",
          optionValue: "400 ml",
          price: 890,
          stockedQuantity: 25,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Novol Fiber Filler",
      handle: "demo-novol-fiber-filler",
      description: "Glass fiber reinforced filler for deeper repairs.",
      categoryHandle: "fillers",
      brand: "Novol",
      optionTitle: "Package",
      characteristics: {
        Type: "Fiber filler",
        Surface: "Metal and polyester laminate",
        Sanding: "Machine sanding",
      },
      variants: [
        {
          title: "1 kg",
          sku: "DEMO-NOVOL-FIBER-FILLER-1KG",
          optionValue: "1 kg",
          price: 980,
          stockedQuantity: 7,
          allowBackorder: false,
        },
        {
          title: "1.8 kg",
          sku: "DEMO-NOVOL-FIBER-FILLER-18KG",
          optionValue: "1.8 kg",
          price: 1650,
          stockedQuantity: 0,
          allowBackorder: true,
        },
      ],
    },
    {
      title: "Reoflex Finish Filler",
      handle: "demo-reoflex-finish-filler",
      description: "Fine finishing filler for small imperfections.",
      categoryHandle: "fillers",
      brand: "Reoflex",
      optionTitle: "Package",
      characteristics: {
        Type: "Finishing filler",
        Surface: "Metal and primer",
        Texture: "Fine",
      },
      variants: [
        {
          title: "1 kg",
          sku: "DEMO-REOFLEX-FINISH-FILLER-1KG",
          optionValue: "1 kg",
          price: 760,
          stockedQuantity: 0,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Chamaleon Universal Thinner Fast",
      handle: "demo-chamaleon-universal-thinner-fast",
      description: "Fast universal thinner for primers and enamels.",
      categoryHandle: "thinners",
      brand: "Chamaleon",
      optionTitle: "Package",
      characteristics: {
        Type: "Universal thinner",
        Speed: "Fast",
        Use: "Primers and enamels",
      },
      variants: [
        {
          title: "1 L",
          sku: "DEMO-CHAMALEON-THINNER-FAST-1L",
          optionValue: "1 L",
          price: 620,
          stockedQuantity: 20,
          allowBackorder: false,
        },
        {
          title: "5 L",
          sku: "DEMO-CHAMALEON-THINNER-FAST-5L",
          optionValue: "5 L",
          price: 2600,
          stockedQuantity: 3,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Brulex Thinner Slow",
      handle: "demo-brulex-thinner-slow",
      description: "Slow thinner for warm booth conditions.",
      categoryHandle: "thinners",
      brand: "Brulex",
      optionTitle: "Package",
      characteristics: {
        Type: "Thinner",
        Speed: "Slow",
        Use: "High temperature",
      },
      variants: [
        {
          title: "1 L",
          sku: "DEMO-BRULEX-THINNER-SLOW-1L",
          optionValue: "1 L",
          price: 790,
          stockedQuantity: 0,
          allowBackorder: true,
        },
      ],
    },
    {
      title: "APP Silicone Remover",
      handle: "demo-app-silicone-remover",
      description: "Cleaner and degreaser before painting.",
      categoryHandle: "thinners",
      brand: "APP",
      optionTitle: "Package",
      characteristics: {
        Type: "Silicone remover",
        Use: "Degreasing",
        Volume: "1 L",
      },
      variants: [
        {
          title: "1 L",
          sku: "DEMO-APP-SILICONE-REMOVER-1L",
          optionValue: "1 L",
          price: 700,
          stockedQuantity: 11,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Mirka Abranet P80",
      handle: "demo-mirka-abranet-p80",
      description: "Net abrasive sheets for dust extraction sanding.",
      categoryHandle: "abrasives",
      brand: "Mirka",
      optionTitle: "Pack",
      characteristics: {
        Grit: "P80",
        Format: "Sheet",
        Pack: "50 pcs",
      },
      variants: [
        {
          title: "50 pcs",
          sku: "DEMO-MIRKA-ABRANET-P80-50",
          optionValue: "50 pcs",
          price: 3100,
          stockedQuantity: 0,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Mirka Abranet P240",
      handle: "demo-mirka-abranet-p240",
      description: "Net abrasive sheets for primer sanding.",
      categoryHandle: "abrasives",
      brand: "Mirka",
      optionTitle: "Pack",
      characteristics: {
        Grit: "P240",
        Format: "Sheet",
        Pack: "50 pcs",
      },
      variants: [
        {
          title: "50 pcs",
          sku: "DEMO-MIRKA-ABRANET-P240-50",
          optionValue: "50 pcs",
          price: 3300,
          stockedQuantity: 16,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "3M Masking Tape 233 Plus",
      handle: "demo-3m-masking-tape-233-plus",
      description: "Automotive masking tape for paint booth use.",
      categoryHandle: "masking",
      brand: "3M",
      optionTitle: "Width",
      characteristics: {
        Type: "Masking tape",
        Temperature: "Paint booth",
        Adhesive: "Automotive",
      },
      variants: [
        {
          title: "18 mm",
          sku: "DEMO-3M-MASKING-TAPE-18MM",
          optionValue: "18 mm",
          price: 390,
          stockedQuantity: 30,
          allowBackorder: false,
        },
        {
          title: "48 mm",
          sku: "DEMO-3M-MASKING-TAPE-48MM",
          optionValue: "48 mm",
          price: 820,
          stockedQuantity: 0,
          allowBackorder: true,
        },
      ],
    },
    {
      title: "Colad Mixing Cups",
      handle: "demo-colad-mixing-cups",
      description: "Graduated cups for paint and clear coat mixing.",
      categoryHandle: "masking",
      brand: "Colad",
      optionTitle: "Volume",
      characteristics: {
        Type: "Mixing cup",
        Material: "PP",
        Scale: "Graduated",
      },
      variants: [
        {
          title: "385 ml",
          sku: "DEMO-COLAD-MIXING-CUP-385ML",
          optionValue: "385 ml",
          price: 24,
          stockedQuantity: 40,
          allowBackorder: false,
        },
        {
          title: "700 ml",
          sku: "DEMO-COLAD-MIXING-CUP-700ML",
          optionValue: "700 ml",
          price: 32,
          stockedQuantity: 0,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Sata Paint Strainer 125 Micron",
      handle: "demo-sata-paint-strainer-125-micron",
      description: "Disposable paint strainers for base coats and clears.",
      categoryHandle: "masking",
      brand: "Sata",
      optionTitle: "Pack",
      characteristics: {
        Mesh: "125 micron",
        Type: "Paint strainer",
        Pack: "100 pcs",
      },
      variants: [
        {
          title: "100 pcs",
          sku: "DEMO-SATA-STRAINER-125-100",
          optionValue: "100 pcs",
          price: 1150,
          stockedQuantity: 0,
          allowBackorder: false,
        },
      ],
    },
    {
      title: "Carsystem Tack Cloth",
      handle: "demo-carsystem-tack-cloth",
      description: "Antistatic tack cloths for dust removal before painting.",
      categoryHandle: "masking",
      brand: "Carsystem",
      optionTitle: "Pack",
      characteristics: {
        Type: "Tack cloth",
        Use: "Dust removal",
        Pack: "10 pcs",
      },
      variants: [
        {
          title: "10 pcs",
          sku: "DEMO-CARSYSTEM-TACK-CLOTH-10",
          optionValue: "10 pcs",
          price: 920,
          stockedQuantity: 9,
          allowBackorder: false,
        },
      ],
    },
  ],
}

type QueryGraph = {
  graph(input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: Record<string, unknown>
  }): Promise<{ data: Record<string, any>[] }>
}

export type CommerceBaselineResult = {
  salesChannel: Record<string, any>
  publishableApiKey: Record<string, any>
  region: Record<string, any>
  stockLocation: Record<string, any>
  fulfillmentSet: Record<string, any>
  serviceZone: Record<string, any>
  shippingProfile: Record<string, any>
  shippingOption: Record<string, any>
  store: Record<string, any>
}

function query(container: MedusaContainer) {
  return container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
}

async function queryMany(
  container: MedusaContainer,
  entity: string,
  fields: string[],
  filters?: Record<string, unknown>
) {
  const { data } = await query(container).graph({
    entity,
    fields,
    filters,
  })

  return data
}

async function queryFirst(
  container: MedusaContainer,
  entity: string,
  fields: string[],
  filters?: Record<string, unknown>
) {
  const data = await queryMany(container, entity, fields, filters)

  return data[0]
}

async function linkExists(
  container: MedusaContainer,
  entity: string,
  filters: Record<string, unknown>
) {
  const links = await queryMany(container, entity, ["id"], filters)

  return links.length > 0
}

async function ensureSalesChannel(container: MedusaContainer) {
  const existing = await queryFirst(
    container,
    "sales_channel",
    ["id", "name"],
    { name: COMMERCE_BASELINE.salesChannelName }
  )

  if (existing) {
    return existing
  }

  const {
    result: [salesChannel],
  } = await createSalesChannelsWorkflow(container).run({
    input: {
      salesChannelsData: [
        {
          name: COMMERCE_BASELINE.salesChannelName,
          description: "Public storefront sales channel",
        },
      ],
    },
  })

  return salesChannel
}

async function ensurePublishableApiKey(
  container: MedusaContainer,
  salesChannelId: string
) {
  const existingKeys = await queryMany(
    container,
    "api_key",
    ["id", "title", "type", "revoked_at", "sales_channels.id"],
    {
      title: COMMERCE_BASELINE.apiKeyTitle,
      type: "publishable",
    }
  )
  let apiKey = existingKeys.find((key) => !key.revoked_at)

  if (!apiKey) {
    const {
      result: [createdApiKey],
    } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          {
            title: COMMERCE_BASELINE.apiKeyTitle,
            type: "publishable",
            created_by: "",
          },
        ],
      },
    })

    apiKey = createdApiKey
  }

  const isLinked = await linkExists(
    container,
    "publishable_api_key_sales_channel",
    {
      publishable_key_id: apiKey.id,
      sales_channel_id: salesChannelId,
    }
  )

  if (!isLinked) {
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: {
        id: apiKey.id,
        add: [salesChannelId],
      },
    })
  }

  return apiKey
}

async function ensureRegion(container: MedusaContainer) {
  const existing = await queryFirst(
    container,
    "region",
    [
      "id",
      "name",
      "currency_code",
      "countries.iso_2",
      "payment_providers.id",
    ],
    { name: COMMERCE_BASELINE.regionName }
  )

  if (!existing) {
    const {
      result: [region],
    } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: COMMERCE_BASELINE.regionName,
            currency_code: COMMERCE_BASELINE.currencyCode,
            countries: [COMMERCE_BASELINE.countryCode],
            payment_providers: [PAYMENT_PROVIDER_ID],
          },
        ],
      },
    })

    return region
  }

  const {
    result: [region],
  } = await updateRegionsWorkflow(container).run({
    input: {
      selector: {
        id: existing.id,
      },
      update: {
        name: COMMERCE_BASELINE.regionName,
        currency_code: COMMERCE_BASELINE.currencyCode,
        countries: [COMMERCE_BASELINE.countryCode],
        payment_providers: [PAYMENT_PROVIDER_ID],
      },
    },
  })

  return region
}

async function ensureTaxRegion(container: MedusaContainer) {
  const existing = await queryFirst(
    container,
    "tax_region",
    ["id", "country_code", "provider_id"],
    { country_code: COMMERCE_BASELINE.countryCode }
  )

  if (existing) {
    return existing
  }

  const {
    result: [taxRegion],
  } = await createTaxRegionsWorkflow(container).run({
    input: [
      {
        country_code: COMMERCE_BASELINE.countryCode,
        provider_id: TAX_PROVIDER_ID,
      },
    ],
  })

  return taxRegion
}

async function ensureStockLocation(
  container: MedusaContainer,
  salesChannelId: string
) {
  let stockLocation = await queryFirst(
    container,
    "stock_location",
    [
      "id",
      "name",
      "address.city",
      "address.country_code",
      "sales_channels.id",
      "fulfillment_providers.id",
      "fulfillment_sets.id",
    ],
    { name: COMMERCE_BASELINE.stockLocationName }
  )

  if (!stockLocation) {
    const {
      result: [createdStockLocation],
    } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: COMMERCE_BASELINE.stockLocationName,
            address: {
              city: "Moscow",
              country_code: COMMERCE_BASELINE.countryCode.toUpperCase(),
              address_1: "",
            },
          },
        ],
      },
    })

    stockLocation = createdStockLocation
  }

  const salesChannelLinked = await linkExists(container, "sales_channel_location", {
    sales_channel_id: salesChannelId,
    stock_location_id: stockLocation.id,
  })

  if (!salesChannelLinked) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: {
        id: stockLocation.id,
        add: [salesChannelId],
      },
    })
  }

  const fulfillmentProviderLinked = await linkExists(
    container,
    "location_fulfillment_provider",
    {
      stock_location_id: stockLocation.id,
      fulfillment_provider_id: FULFILLMENT_PROVIDER_ID,
    }
  )

  if (!fulfillmentProviderLinked) {
    await batchLinksWorkflow(container).run({
      input: {
        create: [
          {
            [Modules.STOCK_LOCATION]: {
              stock_location_id: stockLocation.id,
            },
            [Modules.FULFILLMENT]: {
              fulfillment_provider_id: FULFILLMENT_PROVIDER_ID,
            },
          },
        ],
      },
    })
  }

  return stockLocation
}

async function ensureFulfillmentSet(
  container: MedusaContainer,
  stockLocationId: string
) {
  let fulfillmentSet = await queryFirst(
    container,
    "fulfillment_set",
    ["id", "name", "type", "service_zones.id", "service_zones.name"],
    { name: COMMERCE_BASELINE.fulfillmentSetName }
  )

  if (!fulfillmentSet) {
    await createLocationFulfillmentSetWorkflow(container).run({
      input: {
        location_id: stockLocationId,
        fulfillment_set_data: {
          name: COMMERCE_BASELINE.fulfillmentSetName,
          type: "shipping",
        },
      },
    })

    fulfillmentSet = await queryFirst(
      container,
      "fulfillment_set",
      ["id", "name", "type", "service_zones.id", "service_zones.name"],
      { name: COMMERCE_BASELINE.fulfillmentSetName }
    )
  }

  if (!fulfillmentSet?.id) {
    throw new Error("Commerce baseline fulfillment set was not created")
  }

  const isLinked = await linkExists(container, "location_fulfillment_set", {
    stock_location_id: stockLocationId,
    fulfillment_set_id: fulfillmentSet.id,
  })

  if (!isLinked) {
    await batchLinksWorkflow(container).run({
      input: {
        create: [
          {
            [Modules.STOCK_LOCATION]: {
              stock_location_id: stockLocationId,
            },
            [Modules.FULFILLMENT]: {
              fulfillment_set_id: fulfillmentSet.id,
            },
          },
        ],
      },
    })
  }

  return fulfillmentSet
}

async function ensureServiceZone(
  container: MedusaContainer,
  fulfillmentSetId: string
) {
  const existing = await queryFirst(
    container,
    "service_zone",
    ["id", "name", "fulfillment_set_id", "geo_zones.country_code"],
    {
      fulfillment_set_id: fulfillmentSetId,
      name: COMMERCE_BASELINE.serviceZoneName,
    }
  )

  if (existing) {
    return existing
  }

  const {
    result: [serviceZone],
  } = await createServiceZonesWorkflow(container).run({
    input: {
      data: [
        {
          name: COMMERCE_BASELINE.serviceZoneName,
          fulfillment_set_id: fulfillmentSetId,
          geo_zones: [
            {
              type: "country",
              country_code: COMMERCE_BASELINE.countryCode,
            },
          ],
        },
      ],
    },
  })

  return serviceZone
}

async function ensureShippingProfile(container: MedusaContainer) {
  const existingProfiles = await queryMany(container, "shipping_profile", [
    "id",
    "name",
    "type",
  ])
  const existing =
    existingProfiles.find((profile) => profile.type === "default") ??
    existingProfiles[0]

  if (existing) {
    return existing
  }

  const {
    result: [shippingProfile],
  } = await createShippingProfilesWorkflow(container).run({
    input: {
      data: [
        {
          name: COMMERCE_BASELINE.shippingProfileName,
          type: "default",
        },
      ],
    },
  })

  return shippingProfile
}

async function ensureShippingOption(
  container: MedusaContainer,
  regionId: string,
  serviceZoneId: string,
  shippingProfileId: string
) {
  const existing = await queryFirst(
    container,
    "shipping_option",
    ["id", "name", "service_zone_id", "provider_id"],
    {
      name: COMMERCE_BASELINE.shippingOptionName,
      service_zone_id: serviceZoneId,
    }
  )

  if (existing) {
    return existing
  }

  const {
    result: [shippingOption],
  } = await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: COMMERCE_BASELINE.shippingOptionName,
        price_type: "flat",
        provider_id: FULFILLMENT_PROVIDER_ID,
        service_zone_id: serviceZoneId,
        shipping_profile_id: shippingProfileId,
        type: {
          label: "Manual Delivery",
          description: "Delivery is coordinated by the manager",
          code: "manual",
        },
        prices: [
          {
            currency_code: COMMERCE_BASELINE.currencyCode,
            amount: 0,
          },
          {
            region_id: regionId,
            amount: 0,
          },
        ],
        rules: [
          {
            attribute: "enabled_in_store",
            value: "true",
            operator: "eq",
          },
          {
            attribute: "is_return",
            value: "false",
            operator: "eq",
          },
        ],
      },
    ],
  })

  return shippingOption
}

async function ensureStore(
  container: MedusaContainer,
  salesChannelId: string,
  regionId: string,
  stockLocationId: string
) {
  const stores = await queryMany(container, "store", [
    "id",
    "name",
    "default_sales_channel_id",
    "default_region_id",
    "default_location_id",
    "supported_currencies.currency_code",
    "supported_currencies.is_default",
  ])
  const existing =
    stores.find((store) => store.name === COMMERCE_BASELINE.storeName) ??
    stores[0]

  if (!existing) {
    const {
      result: [store],
    } = await createStoresWorkflow(container).run({
      input: {
        stores: [
          {
            name: COMMERCE_BASELINE.storeName,
            supported_currencies: [
              {
                currency_code: COMMERCE_BASELINE.currencyCode,
                is_default: true,
              },
            ],
            default_sales_channel_id: salesChannelId,
            default_region_id: regionId,
            default_location_id: stockLocationId,
          },
        ],
      },
    })

    return store
  }

  const {
    result: [store],
  } = await updateStoresWorkflow(container).run({
    input: {
      selector: {
        id: existing.id,
      },
      update: {
        name: COMMERCE_BASELINE.storeName,
        supported_currencies: [
          {
            currency_code: COMMERCE_BASELINE.currencyCode,
            is_default: true,
          },
        ],
        default_sales_channel_id: salesChannelId,
        default_region_id: regionId,
        default_location_id: stockLocationId,
      },
    },
  })

  return store
}

async function ensureDemoCategory(
  container: MedusaContainer,
  definition: DemoCategoryDefinition,
  parentCategoryId?: string
) {
  const existing = await queryFirst(
    container,
    "product_category",
    ["id", "name", "handle", "parent_category_id"],
    { handle: definition.handle }
  )

  if (existing) {
    return existing
  }

  const {
    result: [category],
  } = await createProductCategoriesWorkflow(container).run({
    input: {
      product_categories: [
        {
          name: definition.name,
          handle: definition.handle,
          is_active: true,
          is_internal: false,
          rank: definition.rank,
          parent_category_id: parentCategoryId ?? null,
        },
      ],
    },
  })

  return category
}

async function ensureDemoCategories(container: MedusaContainer) {
  const categoriesByHandle = new Map<string, Record<string, any>>()

  for (const definition of DEMO_CATALOG.categories.filter(
    (category) => !category.parentHandle
  )) {
    const category = await ensureDemoCategory(container, definition)
    categoriesByHandle.set(definition.handle, category)
  }

  for (const definition of DEMO_CATALOG.categories.filter(
    (category) => category.parentHandle
  )) {
    const parent = definition.parentHandle
      ? categoriesByHandle.get(definition.parentHandle)
      : null

    if (!parent?.id) {
      throw new Error(
        `Missing parent category '${definition.parentHandle}' for '${definition.handle}'`
      )
    }

    const category = await ensureDemoCategory(container, definition, parent.id)
    categoriesByHandle.set(definition.handle, category)
  }

  return categoriesByHandle
}

async function queryDemoProduct(container: MedusaContainer, productId: string) {
  return queryFirst(
    container,
    "product",
    [
      "id",
      "handle",
      "variants.id",
      "variants.sku",
      "variants.allow_backorder",
      "variants.inventory_items.inventory_item_id",
    ],
    { id: productId }
  )
}

async function ensureDemoProduct(
  container: MedusaContainer,
  definition: DemoProductDefinition,
  baseline: CommerceBaselineResult,
  categoriesByHandle: Map<string, Record<string, any>>
) {
  const existing = await queryFirst(
    container,
    "product",
    [
      "id",
      "handle",
      "variants.id",
      "variants.sku",
      "variants.allow_backorder",
      "variants.inventory_items.inventory_item_id",
    ],
    { handle: definition.handle }
  )

  if (existing) {
    return existing
  }

  const category = categoriesByHandle.get(definition.categoryHandle)

  if (!category?.id) {
    throw new Error(
      `Missing category '${definition.categoryHandle}' for '${definition.handle}'`
    )
  }

  const optionValues = [
    ...new Set(definition.variants.map((variant) => variant.optionValue)),
  ]

  const {
    result: [product],
  } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: definition.title,
          handle: definition.handle,
          description: definition.description,
          status: ProductStatus.PUBLISHED,
          category_ids: [category.id],
          shipping_profile_id: baseline.shippingProfile.id,
          metadata: {
            brand: definition.brand,
            characteristics: definition.characteristics,
          },
          options: [
            {
              title: definition.optionTitle,
              values: optionValues,
            },
          ],
          variants: definition.variants.map((variant) => ({
            title: variant.title,
            sku: variant.sku,
            manage_inventory: true,
            allow_backorder: variant.allowBackorder,
            options: {
              [definition.optionTitle]: variant.optionValue,
            },
            prices: [
              {
                amount: variant.price,
                currency_code: COMMERCE_BASELINE.currencyCode,
              },
            ],
          })),
          sales_channels: [{ id: baseline.salesChannel.id }],
        },
      ],
    },
  })

  const created = await queryDemoProduct(container, product.id)

  if (!created) {
    throw new Error(`Demo product '${definition.handle}' was not created`)
  }

  return created
}

async function ensureDemoInventoryLevel(
  container: MedusaContainer,
  inventoryItemId: string,
  locationId: string,
  stockedQuantity: number
) {
  const existing = await queryFirst(
    container,
    "inventory_level",
    ["id", "inventory_item_id", "location_id", "stocked_quantity"],
    {
      inventory_item_id: inventoryItemId,
      location_id: locationId,
    }
  )

  if (existing) {
    await updateInventoryLevelsWorkflow(container).run({
      input: {
        updates: [
          {
            id: existing.id,
            inventory_item_id: inventoryItemId,
            location_id: locationId,
            stocked_quantity: stockedQuantity,
          },
        ],
      },
    })

    return
  }

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: [
        {
          inventory_item_id: inventoryItemId,
          location_id: locationId,
          stocked_quantity: stockedQuantity,
        },
      ],
    },
  })
}

async function ensureDemoProductInventory(
  container: MedusaContainer,
  definition: DemoProductDefinition,
  product: Record<string, any>,
  locationId: string
) {
  for (const variantDefinition of definition.variants) {
    const variant = product.variants?.find(
      (item: Record<string, any>) => item.sku === variantDefinition.sku
    )
    const inventoryItemId = variant?.inventory_items?.[0]?.inventory_item_id

    if (!inventoryItemId) {
      throw new Error(
        `Missing inventory item for demo variant '${variantDefinition.sku}'`
      )
    }

    await ensureDemoInventoryLevel(
      container,
      inventoryItemId,
      locationId,
      variantDefinition.stockedQuantity
    )
  }
}

export async function seedDemoCatalog(
  container: MedusaContainer,
  baseline: CommerceBaselineResult
): Promise<DemoCatalogResult> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  logger.info("Seeding Auto Paint Store demo catalog...")

  const categoriesByHandle = await ensureDemoCategories(container)
  const products: Record<string, any>[] = []

  for (const productDefinition of DEMO_CATALOG.products) {
    const product = await ensureDemoProduct(
      container,
      productDefinition,
      baseline,
      categoriesByHandle
    )

    await ensureDemoProductInventory(
      container,
      productDefinition,
      product,
      baseline.stockLocation.id
    )

    products.push(product)
  }

  logger.info("Finished Auto Paint Store demo catalog.")

  return {
    categories: [...categoriesByHandle.values()],
    products,
  }
}

export async function seedCommerceBaseline(
  container: MedusaContainer
): Promise<CommerceBaselineResult> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  logger.info("Seeding Auto Paint Store commerce baseline...")

  const salesChannel = await ensureSalesChannel(container)
  const publishableApiKey = await ensurePublishableApiKey(
    container,
    salesChannel.id
  )
  const region = await ensureRegion(container)
  await ensureTaxRegion(container)
  const stockLocation = await ensureStockLocation(container, salesChannel.id)
  const fulfillmentSet = await ensureFulfillmentSet(
    container,
    stockLocation.id
  )
  const serviceZone = await ensureServiceZone(container, fulfillmentSet.id)
  const shippingProfile = await ensureShippingProfile(container)
  const shippingOption = await ensureShippingOption(
    container,
    region.id,
    serviceZone.id,
    shippingProfile.id
  )
  const store = await ensureStore(
    container,
    salesChannel.id,
    region.id,
    stockLocation.id
  )

  logger.info("Finished Auto Paint Store commerce baseline.")

  return {
    salesChannel,
    publishableApiKey,
    region,
    stockLocation,
    fulfillmentSet,
    serviceZone,
    shippingProfile,
    shippingOption,
    store,
  }
}

export default async function seed_commerce({
  container,
}: {
  container: MedusaContainer
}) {
  const baseline = await seedCommerceBaseline(container)
  await seedDemoCatalog(container, baseline)
}
