export function validateVideoUrl(value: string) {
  const normalized = value.trim()

  if (!normalized) {
    return "Укажите ссылку"
  }

  try {
    const url = new URL(normalized)

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Ссылка должна начинаться с http:// или https://"
    }

    return null
  } catch {
    return "Укажите корректную ссылку"
  }
}
