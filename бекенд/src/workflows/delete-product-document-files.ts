import type {
  IFileModuleService,
  IProductModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { deleteProductsWorkflow } from "@medusajs/medusa/core-flows"

type ProductWithMetadata = {
  metadata?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function productDocumentFileIds(products: ProductWithMetadata[]) {
  const ids = products.flatMap((product) => {
    if (!isRecord(product.metadata)) {
      return []
    }

    const documents = product.metadata.documents

    if (!Array.isArray(documents)) {
      return []
    }

    return documents.flatMap((document) => {
      if (!isRecord(document) || typeof document.id !== "string") {
        return []
      }

      const id = document.id.trim()
      return id ? [id] : []
    })
  })

  return Array.from(new Set(ids))
}

export async function deleteProductDocumentFiles(
  { ids }: { ids: string[] },
  { container }: { container: MedusaContainer },
) {
  if (!ids.length) {
    return new StepResponse({ deleted: 0 })
  }

  const productService = container.resolve<IProductModuleService>(
    Modules.PRODUCT,
  )
  const products = await productService.listProducts(
    { id: ids },
    { select: ["id", "metadata"], withDeleted: true },
  )
  const documentIds = productDocumentFileIds(products)

  if (!documentIds.length) {
    return new StepResponse({ deleted: 0 })
  }

  const activeProducts = await productService.listProducts(
    {},
    { select: ["id", "metadata"] },
  )
  const activeDocumentIds = new Set(productDocumentFileIds(activeProducts))
  const unreferencedDocumentIds = documentIds.filter(
    (documentId) => !activeDocumentIds.has(documentId),
  )

  if (!unreferencedDocumentIds.length) {
    return new StepResponse({ deleted: 0 })
  }

  const fileService = container.resolve<IFileModuleService>(Modules.FILE)
  await fileService.deleteFiles(unreferencedDocumentIds)

  return new StepResponse({ deleted: unreferencedDocumentIds.length })
}

deleteProductsWorkflow.hooks.productsDeleted(deleteProductDocumentFiles)
