import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import fs from "node:fs/promises"
import path from "node:path"

import { createAdminToken } from "./test-helpers/admin-token"

const testEnv = {
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  STORE_CORS:
    process.env.STORE_CORS ?? "http://localhost:8000,http://localhost:9000",
  ADMIN_CORS:
    process.env.ADMIN_CORS ?? "http://localhost:9000,http://localhost:7001",
  AUTH_CORS:
    process.env.AUTH_CORS ??
    "http://localhost:9000,http://localhost:7001,http://localhost:8000",
  JWT_SECRET: process.env.JWT_SECRET ?? "test-jwt-secret",
  COOKIE_SECRET: process.env.COOKIE_SECRET ?? "test-cookie-secret",
  AUTH_MFA_ENCRYPTION_KEY:
    process.env.AUTH_MFA_ENCRYPTION_KEY ?? "test-mfa-encryption-key",
}

jest.setTimeout(180 * 1000)

async function listStaticFiles(staticDir: string) {
  return (await fs.readdir(staticDir).catch(() => [])).sort()
}

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ api, getContainer }) => {
    let adminToken: string
    const uploadedFilePaths: string[] = []

    beforeAll(async () => {
      adminToken = await createAdminToken(
        getContainer(),
        "uploads-admin@test.com",
        testEnv.JWT_SECRET,
      )
    })

    afterEach(async () => {
      await Promise.all(
        uploadedFilePaths.splice(0).map(async (filePath) => {
          try {
            await fs.unlink(filePath)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error
            }
          }
        }),
      )
    })

    describe("admin uploads API", () => {
      it("rejects unauthenticated upload requests", async () => {
        await expect(api.post("/admin/uploads", {})).rejects.toMatchObject({
          response: { status: 401 },
        })
      })

      it("stores a validated product document and returns its public URL", async () => {
        const fileContent = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        )
        const form = new FormData()
        form.append(
          "files",
          new Blob([fileContent], { type: "image/png" }),
          "product-photo.png",
        )

        const response = await api.post("/admin/uploads", form, {
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "x-upload-purpose": "product-document",
          },
        })

        expect(response.status).toBe(200)
        expect(response.data.files).toHaveLength(1)
        const file = response.data.files[0]

        expect(file).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            url: expect.stringMatching(/^https?:\/\//),
          }),
        )

        const fileUrl = new URL(file.url)
        const fileKey = fileUrl.pathname.replace(/^\/static\//, "")
        const localFilePath = path.join(process.cwd(), "static", fileKey)
        uploadedFilePaths.push(localFilePath)

        await expect(fs.readFile(localFilePath)).resolves.toEqual(fileContent)
      })

      it("rejects a forged PNG before it reaches storage", async () => {
        const staticDir = path.join(process.cwd(), "static")
        const before = await listStaticFiles(staticDir)
        const form = new FormData()
        form.append(
          "files",
          new Blob([Buffer.from("plain text")], { type: "image/png" }),
          "t05-forged-image.png",
        )

        await expect(
          api.post("/admin/uploads", form, {
            headers: {
              Authorization: `Bearer ${adminToken}`,
              "x-upload-purpose": "product-document",
            },
          }),
        ).rejects.toMatchObject({
          response: {
            status: 400,
            data: {
              message: expect.stringContaining("неподдерживаемое содержимое"),
            },
          },
        })

        await expect(listStaticFiles(staticDir)).resolves.toEqual(before)
      })

      it("rejects a document larger than 10 MB before storage", async () => {
        const staticDir = path.join(process.cwd(), "static")
        const before = await listStaticFiles(staticDir)
        const oversizedPdf = Buffer.alloc(10 * 1024 * 1024 + 1)
        Buffer.from("%PDF-1.7\n").copy(oversizedPdf)
        const form = new FormData()
        form.append(
          "files",
          new Blob([oversizedPdf], { type: "application/pdf" }),
          "t05-oversized.pdf",
        )

        await expect(
          api.post("/admin/uploads", form, {
            headers: {
              Authorization: `Bearer ${adminToken}`,
              "x-upload-purpose": "product-document",
            },
          }),
        ).rejects.toMatchObject({
          response: {
            status: 400,
            data: {
              message: expect.stringContaining("размер 10 МБ"),
            },
          },
        })

        await expect(listStaticFiles(staticDir)).resolves.toEqual(before)
      })

      it("rejects a mixed document batch without storing its valid file", async () => {
        const staticDir = path.join(process.cwd(), "static")
        const before = await listStaticFiles(staticDir)
        const form = new FormData()
        form.append(
          "files",
          new Blob([Buffer.from("%PDF-1.7\n")], { type: "application/pdf" }),
          "t05-valid-first.pdf",
        )
        form.append(
          "files",
          new Blob([Buffer.from("plain text")], { type: "image/png" }),
          "t05-forged-second.png",
        )

        await expect(
          api.post("/admin/uploads", form, {
            headers: {
              Authorization: `Bearer ${adminToken}`,
              "x-upload-purpose": "product-document",
            },
          }),
        ).rejects.toMatchObject({ response: { status: 400 } })

        await expect(listStaticFiles(staticDir)).resolves.toEqual(before)
      })

      it("does not restrict standard Medusa uploads to document formats", async () => {
        const gifContent = Buffer.from("GIF89a")
        const form = new FormData()
        form.append(
          "files",
          new Blob([gifContent], { type: "image/gif" }),
          "standard-product-media.gif",
        )

        const response = await api.post("/admin/uploads", form, {
          headers: { Authorization: `Bearer ${adminToken}` },
        })
        const file = response.data.files[0]
        const fileKey = new URL(file.url).pathname.replace(/^\/static\//, "")
        const localFilePath = path.join(process.cwd(), "static", fileKey)
        uploadedFilePaths.push(localFilePath)

        expect(response.status).toBe(200)
        await expect(fs.readFile(localFilePath)).resolves.toEqual(gifContent)
      })

      it("rejects attaching a headerless unsupported upload as a document", async () => {
        const uploadForm = new FormData()
        uploadForm.append(
          "files",
          new Blob([Buffer.from("GIF89a")], { type: "image/gif" }),
          "headerless-document.gif",
        )
        const uploadResponse = await api.post("/admin/uploads", uploadForm, {
          headers: { Authorization: `Bearer ${adminToken}` },
        })
        const file = uploadResponse.data.files[0]
        const fileKey = new URL(file.url).pathname.replace(/^\/static\//, "")
        uploadedFilePaths.push(path.join(process.cwd(), "static", fileKey))

        const createResponse = await api.post(
          "/admin/products",
          {
            title: "T05 attachment boundary",
            options: [{ title: "Default option", values: ["Default value"] }],
          },
          { headers: { Authorization: `Bearer ${adminToken}` } },
        )
        const productId = createResponse.data.product.id

        await expect(
          api.post(
            `/admin/products/${productId}`,
            {
              metadata: {
                documents: [
                  {
                    id: file.id,
                    name: "headerless-document.gif",
                    url: file.url,
                  },
                ],
              },
            },
            { headers: { Authorization: `Bearer ${adminToken}` } },
          ),
        ).rejects.toMatchObject({
          response: {
            status: 400,
            data: {
              message: expect.stringContaining("неподдерживаемое содержимое"),
            },
          },
        })

        const productResponse = await api.get(`/admin/products/${productId}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        })
        expect(productResponse.data.product.metadata?.documents).toBeUndefined()
      })

      it("replaces a supplied document URL with the provider URL", async () => {
        const uploadForm = new FormData()
        uploadForm.append(
          "files",
          new Blob([Buffer.from("%PDF-1.7\n")], { type: "application/pdf" }),
          "canonical-document.pdf",
        )
        const uploadResponse = await api.post("/admin/uploads", uploadForm, {
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "x-upload-purpose": "product-document",
          },
        })
        const file = uploadResponse.data.files[0]
        const fileKey = new URL(file.url).pathname.replace(/^\/static\//, "")
        uploadedFilePaths.push(path.join(process.cwd(), "static", fileKey))

        const createResponse = await api.post(
          "/admin/products",
          {
            title: "T05 canonical document URL",
            options: [{ title: "Default option", values: ["Default value"] }],
          },
          { headers: { Authorization: `Bearer ${adminToken}` } },
        )
        const productId = createResponse.data.product.id
        const updateResponse = await api.post(
          `/admin/products/${productId}`,
          {
            metadata: {
              documents: [
                {
                  id: file.id,
                  name: "canonical-document.pdf",
                  url: "https://attacker.example/payload.gif",
                },
              ],
            },
          },
          { headers: { Authorization: `Bearer ${adminToken}` } },
        )

        expect(updateResponse.data.product.metadata.documents[0].url).toBe(
          file.url,
        )
      })

      it("removes a detached document from storage and its old public URL", async () => {
        const fileContent = Buffer.from("%PDF-1.7\nT06 removable document")
        const uploadForm = new FormData()
        uploadForm.append(
          "files",
          new Blob([fileContent], { type: "application/pdf" }),
          "removable-document.pdf",
        )
        const uploadResponse = await api.post("/admin/uploads", uploadForm, {
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "x-upload-purpose": "product-document",
          },
        })
        const file = uploadResponse.data.files[0]
        const filePathname = new URL(file.url).pathname
        const fileKey = filePathname.replace(/^\/static\//, "")
        const localFilePath = path.join(process.cwd(), "static", fileKey)
        uploadedFilePaths.push(localFilePath)

        const createResponse = await api.post(
          "/admin/products",
          {
            title: "T06 document cleanup",
            options: [{ title: "Default option", values: ["Default value"] }],
            metadata: {
              documents: [
                {
                  id: file.id,
                  name: "removable-document.pdf",
                  url: file.url,
                },
              ],
            },
          },
          { headers: { Authorization: `Bearer ${adminToken}` } },
        )
        const productId = createResponse.data.product.id

        await api.post(
          `/admin/products/${productId}`,
          { metadata: { documents: [] } },
          { headers: { Authorization: `Bearer ${adminToken}` } },
        )
        const deleteResponse = await api.delete(`/admin/uploads/${file.id}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        })

        expect(deleteResponse.status).toBe(200)
        expect(deleteResponse.data).toEqual(
          expect.objectContaining({ id: file.id, deleted: true }),
        )
        await expect(fs.readFile(localFilePath)).rejects.toMatchObject({
          code: "ENOENT",
        })
        await expect(api.get(filePathname)).rejects.toMatchObject({
          response: { status: 404 },
        })

        const productResponse = await api.get(`/admin/products/${productId}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        })
        expect(productResponse.data.product.metadata.documents).toEqual([])
      })

      it("deletes attached document files when their product is deleted", async () => {
        const fileContent = Buffer.from("%PDF-1.7\nT12 product lifecycle")
        const uploadForm = new FormData()
        uploadForm.append(
          "files",
          new Blob([fileContent], { type: "application/pdf" }),
          "product-lifecycle.pdf",
        )
        const uploadResponse = await api.post("/admin/uploads", uploadForm, {
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "x-upload-purpose": "product-document",
          },
        })
        const file = uploadResponse.data.files[0]
        const filePathname = new URL(file.url).pathname
        const fileKey = filePathname.replace(/^\/static\//, "")
        const localFilePath = path.join(process.cwd(), "static", fileKey)
        uploadedFilePaths.push(localFilePath)

        const createResponse = await api.post(
          "/admin/products",
          {
            title: "T12 product with document",
            options: [{ title: "Default option", values: ["Default value"] }],
            metadata: {
              documents: [
                {
                  id: file.id,
                  name: "product-lifecycle.pdf",
                  url: file.url,
                },
              ],
            },
          },
          { headers: { Authorization: `Bearer ${adminToken}` } },
        )
        const productId = createResponse.data.product.id

        const deleteResponse = await api.delete(`/admin/products/${productId}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        })

        expect(deleteResponse.status).toBe(200)
        expect(deleteResponse.data).toEqual(
          expect.objectContaining({ id: productId, deleted: true }),
        )
        await expect(fs.readFile(localFilePath)).rejects.toMatchObject({
          code: "ENOENT",
        })
        await expect(api.get(filePathname)).rejects.toMatchObject({
          response: { status: 404 },
        })
      })

      it("keeps a shared document until its last product is deleted", async () => {
        const fileContent = Buffer.from("%PDF-1.7\nT12 shared document")
        const uploadForm = new FormData()
        uploadForm.append(
          "files",
          new Blob([fileContent], { type: "application/pdf" }),
          "shared-product-document.pdf",
        )
        const uploadResponse = await api.post("/admin/uploads", uploadForm, {
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "x-upload-purpose": "product-document",
          },
        })
        const file = uploadResponse.data.files[0]
        const filePathname = new URL(file.url).pathname
        const fileKey = filePathname.replace(/^\/static\//, "")
        const localFilePath = path.join(process.cwd(), "static", fileKey)
        uploadedFilePaths.push(localFilePath)
        const document = {
          id: file.id,
          name: "shared-product-document.pdf",
          url: file.url,
        }

        const productIds: string[] = []
        for (const suffix of ["first", "second"]) {
          const response = await api.post(
            "/admin/products",
            {
              title: `T12 shared document ${suffix}`,
              options: [
                { title: "Default option", values: ["Default value"] },
              ],
              metadata: { documents: [document] },
            },
            { headers: { Authorization: `Bearer ${adminToken}` } },
          )
          productIds.push(response.data.product.id)
        }

        await api.delete(`/admin/products/${productIds[0]}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        })
        await expect(fs.readFile(localFilePath)).resolves.toEqual(fileContent)
        await expect(api.get(filePathname)).resolves.toMatchObject({ status: 200 })

        await api.delete(`/admin/products/${productIds[1]}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        })
        await expect(fs.readFile(localFilePath)).rejects.toMatchObject({
          code: "ENOENT",
        })
        await expect(api.get(filePathname)).rejects.toMatchObject({
          response: { status: 404 },
        })
      })

      it("deletes products without documents without touching file storage", async () => {
        const createResponse = await api.post(
          "/admin/products",
          {
            title: "T12 product without documents",
            options: [{ title: "Default option", values: ["Default value"] }],
          },
          { headers: { Authorization: `Bearer ${adminToken}` } },
        )
        const productId = createResponse.data.product.id

        const deleteResponse = await api.delete(`/admin/products/${productId}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        })

        expect(deleteResponse.status).toBe(200)
        expect(deleteResponse.data).toEqual(
          expect.objectContaining({ id: productId, deleted: true }),
        )
      })
    })
  },
})
