import {
  buildPublishedContentUrls, createEmptyCmsHomepage, fetchAllSeoEntries,
  fetchConsistentPublishedHomepage, normalizeCmsHomepage, normalizeNotificationTemplates,
  resolveStrapiPreviewToken,
} from "../cms-content"

const homepage = {
  data: {
    documentId: "home", updatedAt: "2026-08-17T00:00:00.000Z",
    sections: [{ __component: "sections.product-carousel", enabled: true, kind: "new_arrivals", heading: "Новинки" }],
  },
}
const settings = {
  data: {
    documentId: "settings", updatedAt: "2026-08-17T00:00:00.000Z",
    companyName: "Автоэмали", contacts: [], reviewsUrl: "https://example.com/reviews", socialLinks: [],
  },
}

const template = (body: string, overrides: Record<string, unknown> = {}) => ({
  documentId: "template-1", updatedAt: "2026-08-17T00:00:00.000Z",
  event: "order-confirmation", channel: "sms", recipient: "customer",
  subject: null, body, language: "ru", enabled: true, mandatory: false,
  ...overrides,
})

describe("CMS content normalization", () => {
  describe("CMS preview token", () => {
    it("uses the configured token for draft reads", () => {
      expect(resolveStrapiPreviewToken({ STRAPI_READ_TOKEN: " preview-token\n" })).toBe("preview-token")
    })

    it.each([undefined, "", " \n\t "])(
      "says what is missing instead of failing obscurely",
      (token) => {
        expect(() => resolveStrapiPreviewToken(token === undefined ? {} : { STRAPI_READ_TOKEN: token }))
          .toThrow(/STRAPI_READ_TOKEN is required to read CMS drafts/)
      },
    )

    it("does not mention a token file: published reads need no token at all", () => {
      expect(() => resolveStrapiPreviewToken({})).not.toThrow(/token file/)
    })
  })

  it("provides a safe cold-start shell without managed sections", () => {
    expect(createEmptyCmsHomepage("Автокраски")).toMatchObject({
      fallback: true,
      revision: "cold-start",
      sections: [],
      settings: { companyName: "Автокраски", socialLinks: [] },
    })
  })
  it("returns only enabled supported sections", () => {
    expect(normalizeCmsHomepage(homepage, settings).sections).toHaveLength(1)
  })

  it("rejects unknown sections and unsafe links", () => {
    expect(() => normalizeCmsHomepage({ data: { ...homepage.data, sections: [{ __component: "custom.code", enabled: true }] } }, settings)).toThrow()
    expect(() => normalizeCmsHomepage(homepage, { data: { ...settings.data, reviewsUrl: "javascript:alert(1)" } })).toThrow()
  })

  it("rejects unknown rich-text properties instead of forwarding them", () => {
    expect(() => normalizeCmsHomepage(homepage, {
      data: {
        ...settings.data,
        contacts: [{ type: "paragraph", html: "<script />", children: [{ type: "text", text: "ok" }] }],
      },
    })).toThrow()
  })

  it("requests only published content and explicitly deep-populates every section", () => {
    const { homepageUrl, settingsUrl, seoUrl } = buildPublishedContentUrls("http://cms:1337")
    expect(homepageUrl.searchParams.get("status")).toBe("published")
    expect(settingsUrl.searchParams.get("status")).toBe("published")
    expect(homepageUrl.searchParams.get(
      "populate[sections][on][sections.promo-banners][populate][banners][populate]"
    )).toBe("*")
    expect(homepageUrl.searchParams.get(
      "populate[sections][on][sections.info-tabs][populate]"
    )).toBe("*")
    expect(seoUrl.searchParams.get("populate[seo][populate]")).toBe("openGraphImage")
  })

  it("accepts only two consecutive reads of the same publication revision", async () => {
    const a = normalizeCmsHomepage(homepage, settings)
    const b = { ...a, revision: "new", sourceUpdatedAt: "2026-08-18T00:00:00.000Z" }
    const fetcher = jest.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b).mockResolvedValueOnce(b)
    await expect(fetchConsistentPublishedHomepage(fetcher)).resolves.toEqual(b)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it("fetches every SEO page before building the atomic payload", async () => {
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ documentId: "one" }], meta: { pagination: { page: 1, pageCount: 3 } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ documentId: "two" }], meta: { pagination: { page: 2, pageCount: 3 } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ documentId: "three" }], meta: { pagination: { page: 3, pageCount: 3 } } }), { status: 200 }))

    await expect(fetchAllSeoEntries(new URL("http://cms/api/seo-entries?pagination[pageSize]=100"), "token"))
      .resolves.toEqual({ data: [{ documentId: "one" }, { documentId: "two" }, { documentId: "three" }] })
    expect(fetchMock.mock.calls.map(([url]) => (url as URL).searchParams.get("pagination[page]"))).toEqual(["1", "2", "3"])
    fetchMock.mockRestore()
  })

  it("rejects unknown and missing required notification variables", () => {
    expect(() => normalizeNotificationTemplates({ data: [template("Заказ {{order_number}}: {{surprise}}")] }))
      .toThrow(/unknown variable.*surprise/)
    expect(() => normalizeNotificationTemplates({ data: [template("Заказ принят")] }))
      .toThrow(/misses required variable.*order_number/)
    expect(() => normalizeNotificationTemplates({ data: [template("Заказ {{order.email}}") ] }))
      .toThrow(/unknown variable.*order\.email/)
  })

  it("accepts a 134-character rendered SMS and rejects 135 characters", () => {
    expect(normalizeNotificationTemplates({
      data: [template(`${"x".repeat(129)}{{order_number}}`)],
    }).templates[0].body).toHaveLength(145)
    expect(() => normalizeNotificationTemplates({
      data: [template(`${"x".repeat(130)}{{order_number}}`)],
    })).toThrow(/two-part SMS limit of 134/)
  })

  it("forces mandatory email and Telegram templates on regardless of CMS flags", () => {
    const snapshot = normalizeNotificationTemplates({ data: [
      template("Заказ {{order_number}}", { channel: "email", subject: "Заказ {{order_number}}", enabled: false }),
      template("Заказ {{order_number}}", { documentId: "template-2", channel: "telegram", enabled: false }),
    ] })
    expect(snapshot.templates.map(({ mandatory, enabled }) => ({ mandatory, enabled })))
      .toEqual([{ mandatory: true, enabled: true }, { mandatory: true, enabled: true }])
  })
})
