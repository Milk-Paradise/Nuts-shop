import { useEffect, useRef, useState } from "react"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { ArrowUpTray, PencilSquare, Plus, Trash } from "@medusajs/icons"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import {
  Button,
  Container,
  Drawer,
  Heading,
  IconButton,
  Input,
  Text,
  toast,
} from "@medusajs/ui"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { sdk } from "../lib/sdk"
import {
  mergeProductContentMetadata,
  readProductContentMetadata,
  type ProductContentMetadata,
  type ProductDocument,
} from "../lib/product-content-metadata"
import {
  DocumentCleanupError,
  updateThenDeleteDocuments,
} from "../lib/product-document-save"
import { validateVideoUrl } from "../lib/product-content-validation"

type VideoDraftRow = {
  id: string
  value: string
}

type KeywordDraftRow = {
  id: string
  value: string
}

type ProductContentDraft = {
  videoUrls: VideoDraftRow[]
  documents: ProductDocument[]
  searchKeywords: KeywordDraftRow[]
}

let videoDraftRowSequence = 0
let keywordDraftRowSequence = 0

function createVideoDraftRow(value = ""): VideoDraftRow {
  videoDraftRowSequence += 1

  return {
    id: `video-url-${videoDraftRowSequence}`,
    value,
  }
}

function createKeywordDraftRow(value = ""): KeywordDraftRow {
  keywordDraftRowSequence += 1

  return {
    id: `search-keyword-${keywordDraftRowSequence}`,
    value,
  }
}

function toDraft(content: ProductContentMetadata): ProductContentDraft {
  return {
    videoUrls: content.videoUrls.map(createVideoDraftRow),
    documents: content.documents,
    searchKeywords: content.searchKeywords.map(createKeywordDraftRow),
  }
}

function countLabel(count: number, singular: string, plural: string) {
  return count ? `${count} ${count === 1 ? singular : plural}` : "Не добавлено"
}

const ProductContentWidget = ({
  data: product,
}: DetailWidgetProps<AdminProduct>) => {
  const initialContent = readProductContentMetadata(product.metadata)
  const [content, setContent] = useState(initialContent)
  const [draft, setDraft] = useState(() => toDraft(initialContent))
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [videoErrors, setVideoErrors] = useState<Record<string, string>>({})
  const [keywordErrors, setKeywordErrors] = useState<Record<string, string>>({})
  const [documentsToDelete, setDocumentsToDelete] = useState<ProductDocument[]>(
    [],
  )
  const [hasPendingDocumentCleanup, setHasPendingDocumentCleanup] =
    useState(false)
  const lastProductMetadata = useRef(product.metadata)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (open || lastProductMetadata.current === product.metadata) {
      return
    }

    const nextContent = readProductContentMetadata(product.metadata)
    lastProductMetadata.current = product.metadata
    setContent(nextContent)
    setDraft(toDraft(nextContent))
  }, [open, product.metadata])

  const updateProduct = useMutation({
    mutationFn: ({
      nextContent,
      documentIdsToDelete,
    }: {
      nextContent: ProductContentMetadata
      documentIdsToDelete: string[]
    }) =>
      updateThenDeleteDocuments({
        documentIds: documentIdsToDelete,
        update: () =>
          sdk.admin.product.update(
            product.id,
            {
              metadata: mergeProductContentMetadata(
                product.metadata,
                nextContent,
              ),
            },
            {
              fields: "id,metadata",
            },
          ),
        remove: (documentId) => sdk.admin.upload.delete(documentId),
      }),
    onSuccess: ({ product: updatedProduct }) => {
      const nextContent = readProductContentMetadata(updatedProduct.metadata)

      setContent(nextContent)
      setDraft(toDraft(nextContent))
      setDocumentsToDelete([])
      setHasPendingDocumentCleanup(false)
      setError(null)
      setOpen(false)
      queryClient.invalidateQueries({
        queryKey: ["products", "detail", product.id],
      })
      toast.success("Контент товара сохранён")
    },
    onError: (mutationError: Error) => {
      if (mutationError instanceof DocumentCleanupError) {
        const updateResult = mutationError.updateResult as {
          product: AdminProduct
        }
        const nextContent = readProductContentMetadata(
          updateResult.product.metadata,
        )

        setContent(nextContent)
        setDraft(toDraft(nextContent))
        setDocumentsToDelete((current) =>
          current.filter((document) =>
            mutationError.failedDocumentIds.includes(document.id),
          ),
        )
        setHasPendingDocumentCleanup(true)
        setError(
          "Карточка сохранена, но часть файлов не удалилась. Нажмите «Сохранить», чтобы повторить удаление.",
        )
        queryClient.invalidateQueries({
          queryKey: ["products", "detail", product.id],
        })
        toast.error("Не удалось удалить часть файлов")
        return
      }

      const message =
        mutationError.message || "Не удалось сохранить контент товара"

      setError(message)
      toast.error(message)
    },
  })

  const uploadDocuments = useMutation({
    mutationFn: (files: File[]) =>
      sdk.admin.upload.create({ files }, undefined, {
        "x-upload-purpose": "product-document",
      }),
    onSuccess: ({ files: uploadedFiles }, selectedFiles) => {
      const uploadedDocuments = uploadedFiles.flatMap((file, index) => {
        const selectedFile = selectedFiles[index]

        if (!selectedFile) {
          return []
        }

        return [
          {
            id: file.id,
            name: selectedFile.name,
            url: file.url,
          },
        ]
      })

      setDraft((current) => ({
        ...current,
        documents: [...current.documents, ...uploadedDocuments],
      }))
      setUploadError(null)
      toast.success(
        uploadedDocuments.length === 1
          ? "Документ загружен"
          : `Загружено документов: ${uploadedDocuments.length}`,
      )
    },
    onError: (uploadMutationError: Error) => {
      const message =
        uploadMutationError.message || "Не удалось загрузить документы"

      setUploadError(message)
      toast.error(message)
    },
  })

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (updateProduct.isPending || uploadDocuments.isPending)) {
      return
    }

    if (nextOpen) {
      setDraft(toDraft(content))
      if (!hasPendingDocumentCleanup) {
        setDocumentsToDelete([])
      }
    } else {
      setDraft(toDraft(content))
      if (!hasPendingDocumentCleanup) {
        setDocumentsToDelete([])
        setError(null)
      }
      setUploadError(null)
    }

    setVideoErrors({})
    setKeywordErrors({})
    setOpen(nextOpen)
  }

  const handleSave = () => {
    const nextVideoErrors = Object.fromEntries(
      draft.videoUrls.flatMap((row) => {
        const validationError = validateVideoUrl(row.value)

        return validationError ? [[row.id, validationError]] : []
      }),
    )
    const nextKeywordErrors = Object.fromEntries(
      draft.searchKeywords.flatMap((row) =>
        row.value.trim() ? [] : [[row.id, "Введите ключевое слово"]],
      ),
    )

    setVideoErrors(nextVideoErrors)
    setKeywordErrors(nextKeywordErrors)

    if (
      Object.keys(nextVideoErrors).length ||
      Object.keys(nextKeywordErrors).length
    ) {
      return
    }

    setError(null)
    updateProduct.mutate({
      nextContent: {
        videoUrls: draft.videoUrls.map((row) => row.value.trim()),
        searchKeywords: draft.searchKeywords.map((row) => row.value.trim()),
        documents: draft.documents,
      },
      documentIdsToDelete: documentsToDelete.map((document) => document.id),
    })
  }

  return (
    <>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between gap-x-4 px-6 py-4">
          <div>
            <Heading level="h2">Контент товара</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Видео, документация и ключевые слова для поиска
            </Text>
          </div>
          <Button
            size="small"
            variant="secondary"
            onClick={() => handleOpenChange(true)}
          >
            <PencilSquare />
            Изменить
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 px-6 py-4 small:grid-cols-3">
          <div>
            <Text size="small" className="text-ui-fg-subtle">
              Видео
            </Text>
            <Text size="small" weight="plus">
              {countLabel(content.videoUrls.length, "ссылка", "ссылок")}
            </Text>
          </div>
          <div>
            <Text size="small" className="text-ui-fg-subtle">
              Документация
            </Text>
            <Text size="small" weight="plus">
              {countLabel(content.documents.length, "файл", "файлов")}
            </Text>
          </div>
          <div>
            <Text size="small" className="text-ui-fg-subtle">
              Ключевые слова
            </Text>
            <Text size="small" weight="plus">
              {countLabel(
                content.searchKeywords.length,
                "элемент",
                "элементов",
              )}
            </Text>
          </div>
        </div>
      </Container>

      <Drawer open={open} onOpenChange={handleOpenChange}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Контент товара</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex-1 overflow-auto">
            <div className="flex flex-col gap-y-6">
              <div className="flex flex-col gap-y-2">
                <Text size="small" weight="plus">
                  Ссылки на видео
                </Text>
                {draft.videoUrls.length ? (
                  <div className="flex flex-col gap-y-3">
                    {draft.videoUrls.map((row, index) => (
                      <div key={row.id} className="flex flex-col gap-y-1">
                        <div className="flex items-start gap-x-2">
                          <Input
                            aria-label={`Ссылка на видео ${index + 1}`}
                            value={row.value}
                            disabled={updateProduct.isPending}
                            onChange={(event) => {
                              const value = event.target.value

                              setDraft((current) => ({
                                ...current,
                                videoUrls: current.videoUrls.map((item) =>
                                  item.id === row.id
                                    ? { ...item, value }
                                    : item,
                                ),
                              }))
                              setVideoErrors((current) => {
                                const { [row.id]: _removed, ...rest } = current

                                return rest
                              })
                            }}
                            placeholder="https://…"
                            aria-invalid={Boolean(videoErrors[row.id])}
                            aria-describedby={
                              videoErrors[row.id]
                                ? `${row.id}-error`
                                : undefined
                            }
                          />
                          <IconButton
                            type="button"
                            size="small"
                            variant="transparent"
                            disabled={updateProduct.isPending}
                            aria-label={`Удалить ссылку на видео ${index + 1}`}
                            onClick={() => {
                              setDraft((current) => ({
                                ...current,
                                videoUrls: current.videoUrls.filter(
                                  (item) => item.id !== row.id,
                                ),
                              }))
                              setVideoErrors((current) => {
                                const { [row.id]: _removed, ...rest } = current

                                return rest
                              })
                            }}
                          >
                            <Trash />
                          </IconButton>
                        </div>
                        {videoErrors[row.id] ? (
                          <Text
                            id={`${row.id}-error`}
                            role="alert"
                            size="xsmall"
                            className="text-ui-fg-error"
                          >
                            {videoErrors[row.id]}
                          </Text>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">
                    Ссылки пока не добавлены.
                  </Text>
                )}
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={updateProduct.isPending}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      videoUrls: [...current.videoUrls, createVideoDraftRow()],
                    }))
                  }
                >
                  <Plus />
                  Добавить ссылку
                </Button>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Поддерживаются ссылки, начинающиеся с http:// или https://.
                </Text>
              </div>

              <div className="flex flex-col gap-y-2">
                <Text size="small" weight="plus">
                  Ключевые слова
                </Text>
                {draft.searchKeywords.length ? (
                  <div className="flex flex-col gap-y-3">
                    {draft.searchKeywords.map((row, index) => (
                      <div key={row.id} className="flex flex-col gap-y-1">
                        <div className="flex items-start gap-x-2">
                          <Input
                            aria-label={`Ключевое слово ${index + 1}`}
                            value={row.value}
                            disabled={updateProduct.isPending}
                            onChange={(event) => {
                              const value = event.target.value

                              setDraft((current) => ({
                                ...current,
                                searchKeywords: current.searchKeywords.map(
                                  (item) =>
                                    item.id === row.id
                                      ? { ...item, value }
                                      : item,
                                ),
                              }))
                              setKeywordErrors((current) => {
                                const { [row.id]: _removed, ...rest } = current

                                return rest
                              })
                            }}
                            placeholder="Слово или фраза"
                            aria-invalid={Boolean(keywordErrors[row.id])}
                            aria-describedby={
                              keywordErrors[row.id]
                                ? `${row.id}-error`
                                : undefined
                            }
                          />
                          <IconButton
                            type="button"
                            size="small"
                            variant="transparent"
                            disabled={updateProduct.isPending}
                            aria-label={`Удалить ключевое слово ${index + 1}`}
                            onClick={() => {
                              setDraft((current) => ({
                                ...current,
                                searchKeywords: current.searchKeywords.filter(
                                  (item) => item.id !== row.id,
                                ),
                              }))
                              setKeywordErrors((current) => {
                                const { [row.id]: _removed, ...rest } = current

                                return rest
                              })
                            }}
                          >
                            <Trash />
                          </IconButton>
                        </div>
                        {keywordErrors[row.id] ? (
                          <Text
                            id={`${row.id}-error`}
                            role="alert"
                            size="xsmall"
                            className="text-ui-fg-error"
                          >
                            {keywordErrors[row.id]}
                          </Text>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">
                    Ключевые слова пока не добавлены.
                  </Text>
                )}
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={updateProduct.isPending}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      searchKeywords: [
                        ...current.searchKeywords,
                        createKeywordDraftRow(),
                      ],
                    }))
                  }
                >
                  <Plus />
                  Добавить ключевое слово
                </Button>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Покупатели не увидят эти значения на карточке товара.
                </Text>
              </div>

              <div className="flex flex-col gap-y-1">
                <Text size="small" weight="plus">
                  Документация
                </Text>
                {draft.documents.length ? (
                  <div className="flex flex-col gap-y-2">
                    {draft.documents.map((document, index) => (
                      <div
                        key={document.id || `${document.url}-${index}`}
                        className="flex items-center justify-between gap-x-2 rounded-md border border-ui-border-base px-3 py-2"
                      >
                        <Text size="small" weight="plus">
                          <a
                            href={document.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-ui-fg-interactive hover:underline"
                          >
                            {document.name}
                          </a>
                        </Text>
                        <IconButton
                          type="button"
                          size="small"
                          variant="transparent"
                          disabled={updateProduct.isPending}
                          aria-label={`Удалить документ ${document.name}`}
                          onClick={() => {
                            setDraft((current) => ({
                              ...current,
                              documents: current.documents.filter(
                                (item) => item.id !== document.id,
                              ),
                            }))
                            setDocumentsToDelete((current) =>
                              current.some((item) => item.id === document.id)
                                ? current
                                : [...current, document],
                            )
                          }}
                        >
                          <Trash />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">
                    Документы пока не загружены.
                  </Text>
                )}
                <input
                  ref={uploadInputRef}
                  type="file"
                  multiple
                  hidden
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? [])

                    event.target.value = ""
                    if (files.length) {
                      setUploadError(null)
                      uploadDocuments.mutate(files)
                    }
                  }}
                />
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  isLoading={uploadDocuments.isPending}
                  disabled={updateProduct.isPending}
                  onClick={() => uploadInputRef.current?.click()}
                >
                  <ArrowUpTray />
                  Загрузить документы
                </Button>
                {uploadDocuments.isPending ? (
                  <Text
                    size="small"
                    role="status"
                    className="text-ui-fg-subtle"
                  >
                    Документы загружаются…
                  </Text>
                ) : null}
                {uploadError ? (
                  <Text size="small" role="alert" className="text-ui-fg-error">
                    {uploadError}
                  </Text>
                ) : null}
              </div>

              {error ? (
                <div role="alert" className="rounded-md bg-ui-bg-error p-3">
                  <Text size="small" className="text-ui-fg-error">
                    {error}
                  </Text>
                </div>
              ) : null}
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <div className="flex items-center justify-end gap-x-2">
              <Button
                size="small"
                variant="secondary"
                disabled={updateProduct.isPending || uploadDocuments.isPending}
                onClick={() => handleOpenChange(false)}
              >
                Отмена
              </Button>
              <Button
                size="small"
                isLoading={updateProduct.isPending}
                disabled={uploadDocuments.isPending}
                onClick={handleSave}
              >
                Сохранить
              </Button>
            </div>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
  id: "auto-paint-store:product-content",
})

export default ProductContentWidget
