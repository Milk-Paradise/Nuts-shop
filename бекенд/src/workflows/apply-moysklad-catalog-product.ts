import {
  createProductVariantsWorkflow,
  createProductsWorkflow,
  updateProductVariantsWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

export type MoyskladCatalogVariantMutation = {
  id?: string
  title: string
  sku: string
  options: Record<string, string>
  prices: Array<{ amount: number; currency_code: string }>
  metadata?: Record<string, unknown>
  barcode?: string
  weight?: number
  manage_inventory?: boolean
  allow_backorder?: boolean
}

export type ApplyMoyskladCatalogProductInput = {
  action: "create" | "update" | "archive"
  product: {
    id?: string
    title: string
    handle?: string
    description?: string | null
    external_id?: string
    status?: string
    category_ids?: string[]
    shipping_profile_id?: string
    metadata?: Record<string, unknown>
    sales_channels?: Array<{ id: string }>
  }
  options: Array<{ title: string; values: string[] }>
  variants: MoyskladCatalogVariantMutation[]
  existing?: {
    id: string
    metadata?: Record<string, unknown> | null
    salesChannelIds: string[]
  }
}

export async function applyMoyskladCatalogProduct(
  container: MedusaContainer,
  input: ApplyMoyskladCatalogProductInput
) {
  if (input.action !== "archive" && !input.variants.length) {
    throw new Error("Нельзя применить товар МойСклад без вариантов.")
  }

  if (input.action === "archive") {
    if (!input.existing?.id) {
      throw new Error("Для архивирования товара МойСклад не найден Medusa product.")
    }

    await updateProductsWorkflow(container).run({
      input: {
        selector: { id: input.existing.id },
        update: {
          status: "draft" as never,
          metadata: {
            ...(input.existing.metadata ?? {}),
            ...(input.product.metadata ?? {}),
            moysklad_archived: true,
          },
        },
      },
    })
    return input.existing.id
  }

  if (input.action === "create") {
    const { result } = await createProductsWorkflow(container).run({
      input: {
        products: [
          {
            ...input.product,
            status: input.product.status as never,
            options: input.options,
            variants: input.variants,
          },
        ],
      },
    })
    return result[0].id
  }

  const existing = input.existing
  if (!existing?.id) {
    throw new Error("Для обновления товара МойСклад не найден Medusa product.")
  }

  const updates = input.variants.filter((variant) => variant.id)
  const creates = input.variants.filter((variant) => !variant.id)

  if (updates.length) {
    await updateProductVariantsWorkflow(container).run({
      input: {
        product_variants: updates.map((variant) => ({
          id: variant.id!,
          ...variant,
        })),
      },
    })
  }

  if (creates.length) {
    await createProductVariantsWorkflow(container).run({
      input: {
        product_variants: creates.map((variant) => ({
          product_id: existing.id,
          ...variant,
        })),
      },
    })
  }

  await updateProductsWorkflow(container).run({
    input: {
      selector: { id: existing.id },
      update: {
        ...input.product,
        title: input.product.title,
        description: input.product.description ?? null,
        external_id: input.product.external_id,
        status: input.product.status as never,
        metadata: {
          ...(existing.metadata ?? {}),
          ...(input.product.metadata ?? {}),
        },
        sales_channels: input.product.sales_channels,
      },
    },
  })

  return existing.id
}

export const applyMoyskladCatalogProductStep = createStep(
  "apply-moysklad-catalog-product",
  async (input: ApplyMoyskladCatalogProductInput, { container }) =>
    new StepResponse(await applyMoyskladCatalogProduct(container, input))
)

export const applyMoyskladCatalogProductWorkflow = createWorkflow(
  "apply-moysklad-catalog-product",
  (input: ApplyMoyskladCatalogProductInput) => {
    const productId = applyMoyskladCatalogProductStep(input)
    return new WorkflowResponse(productId)
  }
)

export default applyMoyskladCatalogProductWorkflow
