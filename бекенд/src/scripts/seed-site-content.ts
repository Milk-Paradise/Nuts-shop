import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { SITE_CONTENT_MODULE } from "../modules/site-content/module-key"
import type { SiteTabKey } from "../modules/site-content/models/site-tab"
import type SiteContentModuleService from "../modules/site-content/service"
import saveSiteLinkWorkflow from "../workflows/save-site-link"
import upsertSiteTabWorkflow from "../workflows/upsert-site-tab"

type DemoTab = {
  key: SiteTabKey
  content: string
}

type DemoSocialLink = {
  kind: "social"
  label: string
  url: string
}

type ExistingTab = {
  key: string
  content: string | null
}

type ExistingSocialLink = {
  id: string
  kind: string
  label: string | null
  url: string
}

export const DEMO_SITE_TABS: readonly DemoTab[] = [
  {
    key: "contacts",
    content: [
      "<p><strong>Демонстрационные данные — не используйте их для реальной связи.</strong></p>",
      "<p><strong>Телефон:</strong> +1 (202) 555-0147 (номер из диапазона для примеров)</p>",
      '<p><strong>Электронная почта:</strong> <a href="mailto:hello@shop.example">hello@shop.example</a></p>',
      "<p><strong>Адрес:</strong> г. Москва, ул. Тестовая, д. 12, павильон «Демо» (вымышленный адрес)</p>",
      "<p><strong>Режим работы:</strong> пн–пт 09:00–19:00, сб 10:00–17:00, вс — выходной.</p>",
      "<p>Перед визитом дождитесь подтверждения менеджера: часть товаров хранится на отдельном складе.</p>",
    ].join(""),
  },
  {
    key: "delivery",
    content: [
      "<p><strong>Демонстрационные условия доставки и оплаты.</strong> Финальные тарифы владелец магазина укажет перед запуском.</p>",
      "<p><strong>Курьерская доставка</strong></p>",
      "<ul><li>По Москве — от 490 ₽, обычно 1–2 рабочих дня после подтверждения заказа.</li><li>По Московской области — стоимость рассчитывается менеджером по адресу.</li><li>В другие регионы — транспортной компанией по согласованному тарифу.</li></ul>",
      "<p><strong>Самовывоз</strong></p>",
      "<p>Бесплатно из демонстрационного пункта на ул. Тестовой после сообщения о готовности заказа.</p>",
      "<p><strong>Оплата</strong></p>",
      "<ul><li>Банковской картой после подтверждения состава заказа.</li><li>Безналичным переводом по счёту для юридических лиц.</li></ul>",
      "<p>Для лакокрасочных материалов могут действовать ограничения перевозчика. Доступный способ получения подтверждается до оплаты.</p>",
    ].join(""),
  },
  {
    key: "about",
    content: [
      "<p><strong>Демонстрационный текст о магазине.</strong></p>",
      "<p>ColorFull — учебный магазин материалов для кузовного ремонта и окраски автомобилей. В демо-каталоге собраны краски, грунты, лаки и расходные материалы.</p>",
      "<p>В реальном магазине команда поможет подобрать совместимые материалы и подготовить заказ к самовывозу или отправке.</p>",
    ].join(""),
  },
]

export const DEMO_SOCIAL_LINKS: readonly DemoSocialLink[] = [
  {
    kind: "social",
    label: "ВКонтакте (демо)",
    url: "https://social.example/vk/colorfull-demo",
  },
  {
    kind: "social",
    label: "Telegram (демо)",
    url: "https://social.example/telegram/colorfull-demo",
  },
]

type PlannedTab = DemoTab & {
  action: "create" | "update" | "skip"
}

type PlannedSocialLink = DemoSocialLink & {
  action: "create" | "update" | "skip"
  existingId?: string
}

export type SiteContentSeedPlan = {
  tabs: PlannedTab[]
  socialLinks: PlannedSocialLink[]
}

function normalizeLabel(value: string | null): string {
  return value?.trim().toLocaleLowerCase("ru-RU") ?? ""
}

function normalizeUrl(value: string): string {
  return value.trim()
}

export function buildSiteContentSeedPlan(
  existingTabs: readonly ExistingTab[],
  existingSocialLinks: readonly ExistingSocialLink[],
  force: boolean
): SiteContentSeedPlan {
  const tabs = DEMO_SITE_TABS.map((definition): PlannedTab => {
    const existing = existingTabs.find((tab) => tab.key === definition.key)
    const isEmpty = !existing?.content?.trim()

    if (!existing) return { ...definition, action: "create" }
    if (isEmpty || force) return { ...definition, action: "update" }

    return { ...definition, action: "skip" }
  })

  const matchedLinkIds = new Set<string>()
  const socialLinks = DEMO_SOCIAL_LINKS.map(
    (definition): PlannedSocialLink => {
      const existing = existingSocialLinks.find(
        (link) =>
          !matchedLinkIds.has(link.id) &&
          link.kind === "social" &&
          (normalizeLabel(link.label) === normalizeLabel(definition.label) ||
            normalizeUrl(link.url) === normalizeUrl(definition.url))
      )

      if (!existing) return { ...definition, action: "create" }

      matchedLinkIds.add(existing.id)

      const isUnchanged =
        existing.label === definition.label && existing.url === definition.url

      if (force && !isUnchanged) {
        return {
          ...definition,
          action: "update",
          existingId: existing.id,
        }
      }

      return {
        ...definition,
        action: "skip",
        existingId: existing.id,
      }
    }
  )

  return { tabs, socialLinks }
}

export default async function seedSiteContent({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const siteContentService = container.resolve(
    SITE_CONTENT_MODULE
  ) as SiteContentModuleService
  const force = args.includes("force")

  logger.info(
    `Seeding demo site content${force ? " with explicit overwrite enabled" : ""}...`
  )

  const [existingTabs, existingSocialLinks] = await Promise.all([
    siteContentService.listSiteTabs({
      key: DEMO_SITE_TABS.map((tab) => tab.key),
    }),
    siteContentService.listSiteLinks({ kind: "social" }),
  ])
  const plan = buildSiteContentSeedPlan(
    existingTabs,
    existingSocialLinks,
    force
  )

  for (const tab of plan.tabs) {
    if (tab.action === "skip") {
      logger.info(
        `Skipping site-content tab '${tab.key}': it already contains content (pass the 'force' argument to overwrite).`
      )
      continue
    }

    await upsertSiteTabWorkflow(container).run({
      input: { key: tab.key, content: tab.content },
    })
    logger.info(
      `${tab.action === "create" ? "Created" : "Updated"} demo site-content tab '${tab.key}'.`
    )
  }

  for (const link of plan.socialLinks) {
    if (link.action === "skip") {
      logger.info(
        `Skipping social link '${link.label}': a matching link already exists.`
      )
      continue
    }

    await saveSiteLinkWorkflow(container).run({
      input: {
        id: link.existingId,
        kind: link.kind,
        label: link.label,
        url: link.url,
      },
    })
    logger.info(
      `${link.action === "create" ? "Created" : "Updated"} demo social link '${link.label}'.`
    )
  }

  const actions = [...plan.tabs, ...plan.socialLinks]
  const written = actions.filter((item) => item.action !== "skip").length
  const skipped = actions.length - written

  logger.info(
    `Finished demo site-content seed: ${written} written, ${skipped} skipped.`
  )
}
