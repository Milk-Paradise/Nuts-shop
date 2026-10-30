import { validateVideoUrl } from "../product-content-validation"

describe("validateVideoUrl", () => {
  it.each([
    "https://www.youtube.com/watch?v=example",
    "http://videos.example.test/demo",
    " https://vimeo.com/12345 ",
  ])("accepts an HTTP(S) URL: %s", (value) => {
    expect(validateVideoUrl(value)).toBeNull()
  })

  it("rejects an empty row", () => {
    expect(validateVideoUrl("  ")).toBe("Укажите ссылку")
  })

  it.each(["ftp://example.test/video", "javascript:alert(1)"])(
    "rejects a non-HTTP(S) URL: %s",
    (value) => {
      expect(validateVideoUrl(value)).toBe(
        "Ссылка должна начинаться с http:// или https://",
      )
    },
  )

  it("rejects malformed input", () => {
    expect(validateVideoUrl("not a url")).toBe("Укажите корректную ссылку")
  })
})
