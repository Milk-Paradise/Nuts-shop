jest.mock("@medusajs/medusa/core-flows", () => ({
  createProductVariantsWorkflow: jest.fn(),
  createProductsWorkflow: jest.fn(),
  updateProductVariantsWorkflow: jest.fn(),
  updateProductsWorkflow: jest.fn(),
}))

import {
  createProductVariantsWorkflow,
  createProductsWorkflow,
  updateProductVariantsWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows"
import { applyMoyskladCatalogProduct } from "../apply-moysklad-catalog-product"

const container = {} as any

function workflow(result: unknown = { result: [{ id: "created-product" }] }) {
  return { run: jest.fn().mockResolvedValue(result) }
}

const baseInput = {
  product: {
    title: "Грунт",
    description: "Описание",
    metadata: { moysklad_id: "ms-1" },
    sales_channels: [{ id: "sales-channel" }],
  },
  options: [{ title: "Цвет", values: ["Красный"] }],
  variants: [
    {
      title: "Красный",
      sku: "PRIMER-RED",
      options: { Цвет: "Красный" },
      prices: [{ amount: 100, currency_code: "rub" }],
    },
  ],
}

describe("applyMoyskladCatalogProduct", () => {
  beforeEach(() => jest.clearAllMocks())

  it("creates a complete product and its variants through core workflows", async () => {
    const create = workflow()
    ;(createProductsWorkflow as unknown as jest.Mock).mockReturnValue(create)

    await expect(
      applyMoyskladCatalogProduct(container, { ...baseInput, action: "create" })
    ).resolves.toBe("created-product")

    expect(create.run).toHaveBeenCalledWith({
      input: { products: [{ ...baseInput.product, options: baseInput.options, variants: baseInput.variants }] },
    })
  })

  it("updates existing variants and adds new variants in one product mutation", async () => {
    const updateVariants = workflow()
    const createVariants = workflow()
    const updateProduct = workflow()
    ;(updateProductVariantsWorkflow as unknown as jest.Mock).mockReturnValue(updateVariants)
    ;(createProductVariantsWorkflow as unknown as jest.Mock).mockReturnValue(createVariants)
    ;(updateProductsWorkflow as unknown as jest.Mock).mockReturnValue(updateProduct)

    await expect(
      applyMoyskladCatalogProduct(container, {
        ...baseInput,
        action: "update",
        variants: [
          { ...baseInput.variants[0], id: "variant-existing" },
          { ...baseInput.variants[0], sku: "PRIMER-BLUE" },
        ],
        existing: { id: "product-1", metadata: {}, salesChannelIds: [] },
      })
    ).resolves.toBe("product-1")

    expect(updateVariants.run).toHaveBeenCalledTimes(1)
    expect(createVariants.run).toHaveBeenCalledTimes(1)
    expect(updateProduct.run).toHaveBeenCalledTimes(1)
  })

  it("archives an existing product without mutating its variants", async () => {
    const updateProduct = workflow()
    ;(updateProductsWorkflow as unknown as jest.Mock).mockReturnValue(updateProduct)

    await expect(
      applyMoyskladCatalogProduct(container, {
        ...baseInput,
        action: "archive",
        variants: [],
        existing: { id: "product-1", metadata: {}, salesChannelIds: [] },
      })
    ).resolves.toBe("product-1")

    expect(updateProduct.run).toHaveBeenCalledTimes(1)
    expect(updateProductVariantsWorkflow).not.toHaveBeenCalled()
    expect(createProductVariantsWorkflow).not.toHaveBeenCalled()
  })
})
