import { useRef } from "react"
import { IconButton, Textarea } from "@medusajs/ui"
import { Link as LinkIcon, ListBullet } from "@medusajs/icons"

type RichTextFieldProps = {
  value: string
  onChange: (value: string) => void
}

/**
 * Minimal HTML source editor with a toolbar for the limited formatting set
 * (bold, italic, list, link) required by Ф4. No rich-text-editor dependency:
 * buttons just wrap/insert around the current textarea selection; the saved
 * HTML is sanitized server-side regardless (see upsert-site-tab step).
 */
export function RichTextField({ value, onChange }: RichTextFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function wrapSelection(before: string, after: string) {
    const el = textareaRef.current
    if (!el) return

    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end)
    const next = value.slice(0, start) + before + selected + after + value.slice(end)

    onChange(next)

    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  function insertList() {
    const el = textareaRef.current
    if (!el) return

    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end) || "Пункт списка"
    const items = selected
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `  <li>${line}</li>`)
      .join("\n")
    const block = `<ul>\n${items}\n</ul>`

    onChange(value.slice(0, start) + block + value.slice(end))
  }

  function insertLink() {
    const url = window.prompt("Ссылка (https://...)")
    if (!url) return

    wrapSelection(
      `<a href="${url}" target="_blank" rel="noopener noreferrer">`,
      "</a>"
    )
  }

  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex items-center gap-x-1">
        <IconButton
          type="button"
          size="small"
          variant="transparent"
          aria-label="Жирный"
          onClick={() => wrapSelection("<b>", "</b>")}
        >
          <span className="font-bold">B</span>
        </IconButton>
        <IconButton
          type="button"
          size="small"
          variant="transparent"
          aria-label="Курсив"
          onClick={() => wrapSelection("<i>", "</i>")}
        >
          <span className="italic">I</span>
        </IconButton>
        <IconButton
          type="button"
          size="small"
          variant="transparent"
          aria-label="Список"
          onClick={insertList}
        >
          <ListBullet />
        </IconButton>
        <IconButton
          type="button"
          size="small"
          variant="transparent"
          aria-label="Ссылка"
          onClick={insertLink}
        >
          <LinkIcon />
        </IconButton>
      </div>
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={8}
        placeholder="Текст вкладки (поддерживается ограниченная разметка: жирный, курсив, списки, ссылки)"
      />
    </div>
  )
}
