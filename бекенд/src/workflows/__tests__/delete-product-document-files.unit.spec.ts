import { Modules } from "@medusajs/framework/utils"

import {
  deleteProductDocumentFiles,
  productDocumentFileIds,
} from "../delete-product-document-files"

describe("product document cleanup", () => {
  it("collects unique valid file IDs from product metadata", () => {
    expect(
      productDocumentFileIds([
        {
          metadata: {
            documents: [
              { id: " file_1 ", name: "One", url: "https://example.test/1" },
              { id: "file_1", name: "Duplicate", url: "https://example.test/1" },
              { id: "", name: "Missing ID", url: "https://example.test/2" },
              null,
            ],
          },
        },
        { metadata: { documents: [{ id: "file_2" }] } },
        { metadata: null },
      ]),
    ).toEqual(["file_1", "file_2"])
  })

  it("reads soft-deleted products and deletes their document files", async () => {
    const productService = {
      listProducts: jest.fn().mockImplementation(
        (_filters, config: { withDeleted?: boolean }) =>
          Promise.resolve(
            config.withDeleted
              ? [
                  {
                    metadata: {
                      documents: [{ id: "file_1" }, { id: "file_2" }],
                    },
                  },
                ]
              : [],
          ),
      ),
    }
    const fileService = {
      deleteFiles: jest.fn().mockResolvedValue(undefined),
    }
    const container = {
      resolve(key: string) {
        if (key === Modules.PRODUCT) return productService
        if (key === Modules.FILE) return fileService
        throw new Error(`Unexpected key: ${key}`)
      },
    }

    await deleteProductDocumentFiles(
      { ids: ["prod_1"] },
      { container } as any,
    )

    expect(productService.listProducts).toHaveBeenCalledWith(
      { id: ["prod_1"] },
      { select: ["id", "metadata"], withDeleted: true },
    )
    expect(fileService.deleteFiles).toHaveBeenCalledWith(["file_1", "file_2"])
  })

  it("keeps files that are still referenced by an active product", async () => {
    const productService = {
      listProducts: jest.fn().mockImplementation(
        (_filters, config: { withDeleted?: boolean }) =>
          Promise.resolve(
            config.withDeleted
              ? [{ metadata: { documents: [{ id: "shared_file" }] } }]
              : [{ metadata: { documents: [{ id: "shared_file" }] } }],
          ),
      ),
    }
    const container = {
      resolve(key: string) {
        if (key === Modules.PRODUCT) return productService
        throw new Error(`Unexpected key: ${key}`)
      },
    }

    await expect(
      deleteProductDocumentFiles(
        { ids: ["prod_deleted"] },
        { container } as any,
      ),
    ).resolves.toBeDefined()
  })

  it("does not touch the File Module when deleted products have no documents", async () => {
    const productService = {
      listProducts: jest.fn().mockResolvedValue([{ metadata: {} }]),
    }
    const container = {
      resolve(key: string) {
        if (key === Modules.PRODUCT) return productService
        throw new Error(`Unexpected key: ${key}`)
      },
    }

    await expect(
      deleteProductDocumentFiles(
        { ids: ["prod_without_documents"] },
        { container } as any,
      ),
    ).resolves.toBeDefined()
  })
})
