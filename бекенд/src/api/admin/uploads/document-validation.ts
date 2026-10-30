import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IFileModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { NextFunction } from "express"

export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024
export const DOCUMENT_UPLOAD_PURPOSE = "product-document"

type SupportedDocumentMime = "application/pdf" | "image/jpeg" | "image/png"

type UploadedFile = {
  buffer: Buffer
  mimetype: string
  originalname: string
}

type UploadRequest = MedusaRequest & {
  files?: UploadedFile[]
}

const PDF_SIGNATURE = Buffer.from("%PDF-")
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

function startsWith(buffer: Buffer, signature: Buffer) {
  return (
    buffer.length >= signature.length &&
    buffer.subarray(0, signature.length).equals(signature)
  )
}

export function detectDocumentMimeType(
  buffer: Buffer,
): SupportedDocumentMime | null {
  if (startsWith(buffer, PDF_SIGNATURE)) {
    return "application/pdf"
  }

  if (startsWith(buffer, JPEG_SIGNATURE)) {
    return "image/jpeg"
  }

  if (startsWith(buffer, PNG_SIGNATURE)) {
    return "image/png"
  }

  return null
}

function declaredMimeMatches(
  declaredMime: string,
  detectedMime: SupportedDocumentMime,
) {
  const normalized = declaredMime.trim().toLowerCase()

  if (detectedMime === "image/jpeg") {
    return normalized === "image/jpeg" || normalized === "image/jpg"
  }

  return normalized === detectedMime
}

export function assertSupportedDocumentContent(
  filename: string,
  buffer: Buffer,
) {
  if (buffer.byteLength > MAX_DOCUMENT_SIZE) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Файл «${filename}» превышает допустимый размер 10 МБ`,
    )
  }

  const detectedMime = detectDocumentMimeType(buffer)

  if (!detectedMime) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Файл «${filename}» имеет неподдерживаемое содержимое. Разрешены PDF, JPG и PNG`,
    )
  }

  return detectedMime
}

export function assertValidDocumentUpload(file: UploadedFile) {
  const detectedMime = assertSupportedDocumentContent(
    file.originalname,
    file.buffer,
  )

  if (!declaredMimeMatches(file.mimetype, detectedMime)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Содержимое файла «${file.originalname}» не соответствует заявленному типу`,
    )
  }
}

export function validateDocumentUploads(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: NextFunction,
) {
  if (req.headers["x-upload-purpose"] !== DOCUMENT_UPLOAD_PURPOSE) {
    return next()
  }

  try {
    const files = (req as UploadRequest).files ?? []

    files.forEach(assertValidDocumentUpload)
    return next()
  } catch (error) {
    return next(error)
  }
}

type ProductDocumentReference = {
  id: string
  name: string
  record: Record<string, unknown>
}

function productDocumentReferences(body: unknown): ProductDocumentReference[] {
  if (!body || typeof body !== "object") {
    return []
  }

  const metadata = (body as Record<string, unknown>).metadata

  if (!metadata || typeof metadata !== "object") {
    return []
  }

  const metadataRecord = metadata as Record<string, unknown>

  if (!("documents" in metadataRecord)) {
    return []
  }

  if (!Array.isArray(metadataRecord.documents)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Список документов товара имеет неверный формат",
    )
  }

  return metadataRecord.documents.map((document) => {
    if (!document || typeof document !== "object") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Документ товара имеет неверный формат",
      )
    }

    const record = document as Record<string, unknown>
    const id = typeof record.id === "string" ? record.id.trim() : ""
    const name = typeof record.name === "string" ? record.name.trim() : ""
    const url = typeof record.url === "string" ? record.url.trim() : ""

    if (!id || !name || !url) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Для документа товара обязательны ID файла, название и URL",
      )
    }

    record.id = id
    record.name = name

    return { id, name, record }
  })
}

function canonicalDocumentUrl(id: string, providerUrl: string) {
  if (process.env.NODE_ENV !== "test" && process.env.S3_FILE_URL) {
    const encodedId = id.split("/").map(encodeURIComponent).join("/")

    return `${process.env.S3_FILE_URL.replace(/\/$/, "")}/${encodedId}`
  }

  const url = new URL(providerUrl)
  url.search = ""
  url.hash = ""

  return url.toString()
}

function requestBody(req: MedusaRequest) {
  return (
    (req as MedusaRequest & { validatedBody?: unknown }).validatedBody ??
    req.body
  )
}

export async function validateProductDocumentReferences(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: NextFunction,
) {
  try {
    const documents = productDocumentReferences(requestBody(req))

    if (!documents.length) {
      return next()
    }

    const fileModule = req.scope.resolve(Modules.FILE) as IFileModuleService

    await Promise.all(
      documents.map(async (document) => {
        let buffer: Buffer
        let storedFile: Awaited<ReturnType<IFileModuleService["retrieveFile"]>>

        try {
          ;[buffer, storedFile] = await Promise.all([
            fileModule.getAsBuffer(document.id),
            fileModule.retrieveFile(document.id),
          ])
        } catch {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Файл документа «${document.name}» не найден в хранилище`,
          )
        }

        assertSupportedDocumentContent(document.name, buffer)
        document.record.url = canonicalDocumentUrl(document.id, storedFile.url)
      }),
    )

    return next()
  } catch (error) {
    return next(error)
  }
}
