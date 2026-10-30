import {
  buildSiteContentSeedPlan,
  DEMO_SITE_TABS,
  DEMO_SOCIAL_LINKS,
} from "../seed-site-content"

describe("buildSiteContentSeedPlan", () => {
  it("creates missing demo data, skips it on repeat, and only overwrites with force", () => {
    const initial = buildSiteContentSeedPlan([], [], false)
    expect(initial.tabs.map((item) => item.action)).toEqual([
      "create",
      "create",
      "create",
    ])
    expect(initial.socialLinks.map((item) => item.action)).toEqual([
      "create",
      "create",
    ])
    expect(
      buildSiteContentSeedPlan(
        [{ key: "contacts", content: " \n " }],
        [],
        false
      ).tabs[0].action
    ).toBe("update")

    const existingTabs = DEMO_SITE_TABS.map((tab) => ({
      key: tab.key,
      content: tab.content,
    }))
    const existingLinks = DEMO_SOCIAL_LINKS.map((link, index) => ({
      id: `link_${index}`,
      ...link,
    }))
    const repeat = buildSiteContentSeedPlan(
      existingTabs,
      existingLinks,
      false
    )
    expect(repeat.tabs.every((item) => item.action === "skip")).toBe(true)
    expect(repeat.socialLinks.every((item) => item.action === "skip")).toBe(
      true
    )

    const forced = buildSiteContentSeedPlan(
      existingTabs.map((tab) => ({ ...tab, content: "<p>Ручной текст</p>" })),
      existingLinks.map((link) => ({ ...link, url: `${link.url}/old` })),
      true
    )
    expect(forced.tabs.every((item) => item.action === "update")).toBe(true)
    expect(forced.socialLinks.every((item) => item.action === "update")).toBe(
      true
    )

    const collidingLink = {
      id: "link_mixed",
      kind: "social",
      label: DEMO_SOCIAL_LINKS[0].label,
      url: DEMO_SOCIAL_LINKS[1].url,
    }
    expect(
      buildSiteContentSeedPlan([], [collidingLink], false).socialLinks.map(
        (item) => item.action
      )
    ).toEqual(["skip", "create"])
    expect(
      buildSiteContentSeedPlan(
        [],
        [
          collidingLink,
          {
            id: "link_unrelated",
            kind: "social",
            label: "Другая сеть",
            url: "https://social.example/unrelated",
          },
        ],
        true
      ).socialLinks.map((item) => item.action)
    ).toEqual(["update", "create"])
  })
})
