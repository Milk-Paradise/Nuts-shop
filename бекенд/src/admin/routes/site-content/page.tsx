import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  Drawer,
  FocusModal,
  Heading,
  IconButton,
  Input,
  Label,
  Text,
  toast,
} from "@medusajs/ui"
import { PencilSquare, Plus, SquareTwoStack, Trash } from "@medusajs/icons"

import { sdk } from "../../lib/sdk"
import { RichTextField } from "./rich-text-field"

type SiteTab = {
  key: string
  content: string
}

type SiteLink = {
  id: string
  kind: "social" | "reviews"
  label: string | null
  url: string
  rank: number
}

type SiteContentResponse = {
  tabs: SiteTab[]
  links: SiteLink[]
}

const TAB_LABELS: Record<string, string> = {
  catalog: "Каталог",
  brands: "Бренды",
  contacts: "Контакты",
  about: "О нас",
  paint_selection: "Подбор краски",
  delivery: "Условия доставки",
}

const SITE_CONTENT_QUERY_KEY = ["site-content-admin"]

function useSiteContent() {
  return useQuery({
    queryKey: SITE_CONTENT_QUERY_KEY,
    queryFn: () => sdk.client.fetch<SiteContentResponse>("/admin/site-content"),
  })
}

function TabEditDrawer({
  tab,
  open,
  onOpenChange,
}: {
  tab: SiteTab
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [content, setContent] = useState(tab.content)
  const queryClient = useQueryClient()

  const saveTab = useMutation({
    mutationFn: () =>
      sdk.client.fetch("/admin/site-content/tabs", {
        method: "POST",
        body: { key: tab.key, content },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SITE_CONTENT_QUERY_KEY })
      toast.success("Вкладка сохранена")
      onOpenChange(false)
    },
    onError: (error: Error) => {
      toast.error(error.message || "Не удалось сохранить вкладку")
    },
  })

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) setContent(tab.content)
        onOpenChange(next)
      }}
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{TAB_LABELS[tab.key] ?? tab.key}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex-1 overflow-auto">
          <RichTextField value={content} onChange={setContent} />
        </Drawer.Body>
        <Drawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <Drawer.Close asChild>
              <Button size="small" variant="secondary" disabled={saveTab.isPending}>
                Отмена
              </Button>
            </Drawer.Close>
            <Button
              size="small"
              onClick={() => saveTab.mutate()}
              isLoading={saveTab.isPending}
            >
              Сохранить
            </Button>
          </div>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

function TabsSection({ tabs }: { tabs: SiteTab[] }) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const editingTab = tabs.find((tab) => tab.key === editingKey) ?? null

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Вкладки главной страницы</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Текст показывается покупателю в соответствующей вкладке на главной
          странице. Незаполненная вкладка показывает плейсхолдер.
        </Text>
      </div>
      <div className="flex flex-col">
        {tabs.map((tab) => (
          <div
            key={tab.key}
            className="flex items-center justify-between px-6 py-4"
          >
            <div className="min-w-0">
              <Text size="small" weight="plus">
                {TAB_LABELS[tab.key] ?? tab.key}
              </Text>
              <Text size="small" className="truncate text-ui-fg-subtle">
                {tab.content ? "Заполнено" : "Не заполнено"}
              </Text>
            </div>
            <Button
              size="small"
              variant="secondary"
              onClick={() => setEditingKey(tab.key)}
            >
              <PencilSquare />
              Редактировать
            </Button>
          </div>
        ))}
      </div>

      {editingTab && (
        <TabEditDrawer
          tab={editingTab}
          open={!!editingTab}
          onOpenChange={(open) => {
            if (!open) setEditingKey(null)
          }}
        />
      )}
    </Container>
  )
}

type LinkFormState = {
  label: string
  url: string
}

function LinkFormModal({
  title,
  kind,
  link,
  open,
  onOpenChange,
}: {
  title: string
  kind: "social" | "reviews"
  link: SiteLink | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [form, setForm] = useState<LinkFormState>({
    label: link?.label ?? "",
    url: link?.url ?? "",
  })
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const saveLink = useMutation({
    mutationFn: () =>
      sdk.client.fetch("/admin/site-content/links", {
        method: "POST",
        body: {
          id: link?.id,
          kind,
          label: kind === "social" ? form.label || null : null,
          url: form.url,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SITE_CONTENT_QUERY_KEY })
      toast.success("Ссылка сохранена")
      onOpenChange(false)
    },
    onError: (mutationError: Error) => {
      setError(mutationError.message || "Не удалось сохранить ссылку")
    },
  })

  return (
    <FocusModal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setForm({ label: link?.label ?? "", url: link?.url ?? "" })
          setError(null)
        }
        onOpenChange(next)
      }}
    >
      <FocusModal.Content>
        <div className="flex h-full flex-col overflow-hidden">
          <FocusModal.Header>
            <div className="flex items-center justify-end gap-x-2">
              <FocusModal.Close asChild>
                <Button size="small" variant="secondary" disabled={saveLink.isPending}>
                  Отмена
                </Button>
              </FocusModal.Close>
              <Button
                size="small"
                onClick={() => saveLink.mutate()}
                isLoading={saveLink.isPending}
              >
                Сохранить
              </Button>
            </div>
          </FocusModal.Header>
          <FocusModal.Body className="flex-1 overflow-auto">
            <div className="mx-auto flex max-w-lg flex-col gap-y-4 px-6 py-8">
              <Heading level="h2">{title}</Heading>

              {kind === "social" && (
                <div className="flex flex-col gap-y-2">
                  <Label>Название соцсети</Label>
                  <Input
                    value={form.label}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, label: event.target.value }))
                      setError(null)
                    }}
                    placeholder="Например, VK"
                  />
                </div>
              )}

              <div className="flex flex-col gap-y-2">
                <Label>Ссылка</Label>
                <Input
                  value={form.url}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, url: event.target.value }))
                    setError(null)
                  }}
                  placeholder="https://..."
                />
                {error && (
                  <Text size="small" className="text-ui-fg-error">
                    {error}
                  </Text>
                )}
              </div>
            </div>
          </FocusModal.Body>
        </div>
      </FocusModal.Content>
    </FocusModal>
  )
}

function SocialLinksSection({ links }: { links: SiteLink[] }) {
  const [creating, setCreating] = useState(false)
  const [editingLink, setEditingLink] = useState<SiteLink | null>(null)
  const queryClient = useQueryClient()

  const deleteLink = useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch(`/admin/site-content/links/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SITE_CONTENT_QUERY_KEY })
      toast.success("Ссылка удалена")
    },
    onError: (error: Error) => {
      toast.error(error.message || "Не удалось удалить ссылку")
    },
  })

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Соцсети</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Произвольный список ссылок на соцсети магазина.
          </Text>
        </div>
        <Button size="small" variant="secondary" onClick={() => setCreating(true)}>
          <Plus />
          Добавить
        </Button>
      </div>

      {links.length === 0 && (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Ссылок пока нет.
          </Text>
        </div>
      )}

      {links.map((link) => (
        <div key={link.id} className="flex items-center justify-between px-6 py-4">
          <div className="min-w-0">
            <Text size="small" weight="plus">
              {link.label || "Без названия"}
            </Text>
            <Text size="small" className="truncate text-ui-fg-subtle">
              {link.url}
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <IconButton
              size="small"
              variant="transparent"
              aria-label="Редактировать"
              onClick={() => setEditingLink(link)}
            >
              <PencilSquare />
            </IconButton>
            <IconButton
              size="small"
              variant="transparent"
              aria-label="Удалить"
              disabled={deleteLink.isPending}
              onClick={() => deleteLink.mutate(link.id)}
            >
              <Trash />
            </IconButton>
          </div>
        </div>
      ))}

      {creating && (
        <LinkFormModal
          title="Новая ссылка на соцсеть"
          kind="social"
          link={null}
          open={creating}
          onOpenChange={setCreating}
        />
      )}

      {editingLink && (
        <LinkFormModal
          title="Редактировать ссылку"
          kind="social"
          link={editingLink}
          open={!!editingLink}
          onOpenChange={(open) => {
            if (!open) setEditingLink(null)
          }}
        />
      )}
    </Container>
  )
}

function ReviewsLinkSection({ link }: { link: SiteLink | null }) {
  const [editing, setEditing] = useState(false)

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="min-w-0">
          <Heading level="h2">Ссылка на отзывы</Heading>
          <Text size="small" className="truncate text-ui-fg-subtle">
            {link?.url || "Не заполнено"}
          </Text>
        </div>
        <Button size="small" variant="secondary" onClick={() => setEditing(true)}>
          <SquareTwoStack />
          Редактировать
        </Button>
      </div>

      {editing && (
        <LinkFormModal
          title="Ссылка на отзывы (Яндекс.Карты)"
          kind="reviews"
          link={link}
          open={editing}
          onOpenChange={setEditing}
        />
      )}
    </Container>
  )
}

const SiteContentPage = () => {
  const { data, isLoading, isError } = useSiteContent()

  if (isLoading) {
    return (
      <Container>
        <Text size="small" className="text-ui-fg-subtle">
          Загрузка…
        </Text>
      </Container>
    )
  }

  if (isError || !data) {
    return (
      <Container>
        <Text size="small" className="text-ui-fg-error">
          Не удалось загрузить содержимое главной страницы.
        </Text>
      </Container>
    )
  }

  const socialLinks = data.links.filter((link) => link.kind === "social")
  const reviewsLink = data.links.find((link) => link.kind === "reviews") ?? null

  return (
    <div className="flex flex-col gap-y-4">
      <TabsSection tabs={data.tabs} />
      <SocialLinksSection links={socialLinks} />
      <ReviewsLinkSection link={reviewsLink} />
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Главная страница",
})

export default SiteContentPage
