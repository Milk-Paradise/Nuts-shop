import {
  mergeProductContentMetadata,
  readProductContentMetadata,
} from "../product-content-metadata"

describe("product content metadata", () => {
  it("reads valid product content and ignores malformed entries", () => {
    expect(
      readProductContentMetadata({
        video_urls: [" https://example.com/video ", null, ""],
        documents: [
          {
            id: " document-key ",
            name: " Safety sheet ",
            url: " https://example.com/safety.pdf ",
          },
          { name: "Missing URL" },
        ],
        search_keywords: [" грунт ", 123, ""],
      }),
    ).toEqual({
      videoUrls: ["https://example.com/video"],
      documents: [
        {
          id: "document-key",
          name: "Safety sheet",
          url: "https://example.com/safety.pdf",
        },
      ],
      searchKeywords: ["грунт"],
    })
  })

  it("returns empty lists for absent content fields", () => {
    expect(readProductContentMetadata({ brand: "Novol" })).toEqual({
      videoUrls: [],
      documents: [],
      searchKeywords: [],
    })
  })

  it("merges content without losing unrelated product metadata", () => {
    expect(
      mergeProductContentMetadata(
        { brand: "Novol", custom_field: { enabled: true } },
        {
          videoUrls: ["https://example.com/video"],
          documents: [
            {
              id: "document-key",
              name: "Safety sheet",
              url: "https://example.com/safety.pdf",
            },
          ],
          searchKeywords: ["грунт"],
        },
      ),
    ).toEqual({
      brand: "Novol",
      custom_field: { enabled: true },
      video_urls: ["https://example.com/video"],
      documents: [
        {
          id: "document-key",
          name: "Safety sheet",
          url: "https://example.com/safety.pdf",
        },
      ],
      search_keywords: ["грунт"],
    })
  })
})
