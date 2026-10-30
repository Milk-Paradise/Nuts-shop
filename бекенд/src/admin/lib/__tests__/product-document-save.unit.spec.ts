import {
  DocumentCleanupError,
  updateThenDeleteDocuments,
} from "../product-document-save"

describe("updateThenDeleteDocuments", () => {
  it("updates product metadata before deleting files", async () => {
    const calls: string[] = []
    const result = { product: { id: "prod_1" } }

    await expect(
      updateThenDeleteDocuments({
        documentIds: ["file_1", "file_2"],
        update: async () => {
          calls.push("update")
          return result
        },
        remove: async (id) => {
          calls.push(`remove:${id}`)
        },
      }),
    ).resolves.toBe(result)

    expect(calls).toEqual(["update", "remove:file_1", "remove:file_2"])
  })

  it("does not delete files when the product update fails", async () => {
    const remove = jest.fn()

    await expect(
      updateThenDeleteDocuments({
        documentIds: ["file_1"],
        update: async () => {
          throw new Error("update failed")
        },
        remove,
      }),
    ).rejects.toThrow("update failed")
    expect(remove).not.toHaveBeenCalled()
  })

  it("reports only failed cleanup IDs and preserves the update result", async () => {
    const result = { product: { id: "prod_1" } }

    await expect(
      updateThenDeleteDocuments({
        documentIds: ["file_ok", "file_failed"],
        update: async () => result,
        remove: async (id) => {
          if (id === "file_failed") {
            throw new Error("storage unavailable")
          }
        },
      }),
    ).rejects.toMatchObject({
      name: "DocumentCleanupError",
      updateResult: result,
      failedDocumentIds: ["file_failed"],
    } satisfies Partial<DocumentCleanupError<typeof result>>)
  })
})
