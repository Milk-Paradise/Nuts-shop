import {
  assertValidDocumentUpload,
  detectDocumentMimeType,
  DOCUMENT_UPLOAD_PURPOSE,
  MAX_DOCUMENT_SIZE,
  validateDocumentUploads,
  validateProductDocumentReferences,
} from "../document-validation"

function upload(buffer: Buffer, mimetype: string, originalname = "document") {
  return { buffer, mimetype, originalname }
}

describe("document upload validation", () => {
  const pdf = Buffer.from("%PDF-1.7\n")
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  it.each([
    [pdf, "application/pdf"],
    [jpeg, "image/jpeg"],
    [png, "image/png"],
  ])("detects supported content by signature", (buffer, expectedMime) => {
    expect(detectDocumentMimeType(buffer)).toBe(expectedMime)
  })

  it("rejects forged content despite a supported filename and MIME", () => {
    expect(() =>
      assertValidDocumentUpload(
        upload(Buffer.from("plain text"), "application/pdf", "forged.pdf"),
      ),
    ).toThrow("неподдерживаемое содержимое")
  })

  it("rejects a supported signature with a mismatching declared MIME", () => {
    expect(() =>
      assertValidDocumentUpload(upload(png, "application/pdf", "forged.pdf")),
    ).toThrow("не соответствует заявленному типу")
  })

  it("rejects a file larger than 10 MB", () => {
    const oversizedDocument = Buffer.alloc(MAX_DOCUMENT_SIZE + 1)
    pdf.copy(oversizedDocument)

    expect(() =>
      assertValidDocumentUpload(
        upload(oversizedDocument, "application/pdf", "oversized.pdf"),
      ),
    ).toThrow("превышает допустимый размер 10 МБ")
  })

  it("allows a file exactly 10 MB", () => {
    const maximumDocument = Buffer.alloc(MAX_DOCUMENT_SIZE)
    pdf.copy(maximumDocument)

    expect(() =>
      assertValidDocumentUpload(
        upload(maximumDocument, "application/pdf", "maximum.pdf"),
      ),
    ).not.toThrow()
  })

  it("leaves unrelated standard uploads to Medusa", () => {
    const next = jest.fn()

    validateDocumentUploads(
      {
        headers: {},
        files: [upload(Buffer.from("GIF89a"), "image/gif", "media.gif")],
      } as any,
      {} as any,
      next,
    )

    expect(next).toHaveBeenCalledWith()
  })

  it("validates uploads explicitly marked as product documents", () => {
    const next = jest.fn()

    validateDocumentUploads(
      {
        headers: { "x-upload-purpose": DOCUMENT_UPLOAD_PURPOSE },
        files: [upload(Buffer.from("GIF89a"), "image/gif", "document.gif")],
      } as any,
      {} as any,
      next,
    )

    expect(next.mock.calls[0][0]).toEqual(
      expect.objectContaining({ type: "invalid_data" }),
    )
  })

  it("revalidates stored file content before attaching it to a product", async () => {
    const next = jest.fn()
    const getAsBuffer = jest.fn().mockResolvedValue(Buffer.from("GIF89a"))
    const retrieveFile = jest.fn().mockResolvedValue({
      id: "uploaded-file-id",
      url: "https://storage.example.test/uploaded-file-id",
    })

    await validateProductDocumentReferences(
      {
        body: {
          metadata: {
            documents: [
              {
                id: "uploaded-file-id",
                name: "document.gif",
                url: "https://example.test/document.gif",
              },
            ],
          },
        },
        scope: { resolve: () => ({ getAsBuffer, retrieveFile }) },
      } as any,
      {} as any,
      next,
    )

    expect(getAsBuffer).toHaveBeenCalledWith("uploaded-file-id")
    expect(next.mock.calls[0][0]).toEqual(
      expect.objectContaining({ type: "invalid_data" }),
    )
  })

  it("allows a validated stored document reference", async () => {
    const next = jest.fn()
    const document = {
      id: "uploaded-file-id",
      name: "document.pdf",
      url: "https://attacker.example/payload.gif",
    }

    await validateProductDocumentReferences(
      {
        body: {
          metadata: {
            documents: [document],
          },
        },
        scope: {
          resolve: () => ({
            getAsBuffer: jest.fn().mockResolvedValue(Buffer.from("%PDF-1.7\n")),
            retrieveFile: jest.fn().mockResolvedValue({
              id: "uploaded-file-id",
              url: "https://storage.example.test/uploaded-file-id?signature=temporary",
            }),
          }),
        },
      } as any,
      {} as any,
      next,
    )

    expect(next).toHaveBeenCalledWith()
    expect(document.url).toBe("https://storage.example.test/uploaded-file-id")
  })
})
