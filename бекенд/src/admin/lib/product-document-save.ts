export class DocumentCleanupError<TUpdateResult> extends Error {
  readonly updateResult: TUpdateResult
  readonly failedDocumentIds: string[]

  constructor(updateResult: TUpdateResult, failedDocumentIds: string[]) {
    super("Контент товара сохранён, но не все файлы удалось удалить")
    this.name = "DocumentCleanupError"
    this.updateResult = updateResult
    this.failedDocumentIds = failedDocumentIds
  }
}

type UpdateThenDeleteDocumentsOptions<TUpdateResult> = {
  documentIds: string[]
  update: () => Promise<TUpdateResult>
  remove: (documentId: string) => Promise<unknown>
}

export async function updateThenDeleteDocuments<TUpdateResult>({
  documentIds,
  update,
  remove,
}: UpdateThenDeleteDocumentsOptions<TUpdateResult>): Promise<TUpdateResult> {
  const updateResult = await update()
  const cleanupResults = await Promise.allSettled(
    documentIds.map((documentId) => remove(documentId)),
  )
  const failedDocumentIds = cleanupResults.flatMap((result, index) =>
    result.status === "rejected" ? [documentIds[index]] : [],
  )

  if (failedDocumentIds.length) {
    throw new DocumentCleanupError(updateResult, failedDocumentIds)
  }

  return updateResult
}
