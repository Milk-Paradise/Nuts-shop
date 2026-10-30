export const PRODUCT_CONTENT_METADATA_KEYS = {
  videos: "video_urls",
  documents: "documents",
  searchKeywords: "search_keywords",
} as const

export type ProductDocument = {
  id: string
  name: string
  url: string
}

export type ProductContentMetadata = {
  videoUrls: string[]
  documents: ProductDocument[]
  searchKeywords: string[]
}

function readStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (typeof item !== "string") {
      return []
    }

    const normalized = item.trim()

    return normalized ? [normalized] : []
  })
}

function readDocuments(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return []
    }

    const candidate = item as Record<string, unknown>
    const id = typeof candidate.id === "string" ? candidate.id.trim() : ""
    const name = typeof candidate.name === "string" ? candidate.name.trim() : ""
    const url = typeof candidate.url === "string" ? candidate.url.trim() : ""

    return id && name && url ? [{ id, name, url }] : []
  })
}

export function readProductContentMetadata(
  metadata: Record<string, unknown> | null | undefined,
): ProductContentMetadata {
  return {
    videoUrls: readStringList(metadata?.[PRODUCT_CONTENT_METADATA_KEYS.videos]),
    documents: readDocuments(
      metadata?.[PRODUCT_CONTENT_METADATA_KEYS.documents],
    ),
    searchKeywords: readStringList(
      metadata?.[PRODUCT_CONTENT_METADATA_KEYS.searchKeywords],
    ),
  }
}

export function mergeProductContentMetadata(
  metadata: Record<string, unknown> | null | undefined,
  content: ProductContentMetadata,
) {
  return {
    ...(metadata ?? {}),
    [PRODUCT_CONTENT_METADATA_KEYS.videos]: content.videoUrls,
    [PRODUCT_CONTENT_METADATA_KEYS.documents]: content.documents,
    [PRODUCT_CONTENT_METADATA_KEYS.searchKeywords]: content.searchKeywords,
  }
}
