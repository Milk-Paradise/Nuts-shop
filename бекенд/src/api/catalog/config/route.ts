import { MedusaError } from "@medusajs/framework/utils"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

type CatalogConfigResponseBody = {
  publishable_api_key: string
}

// Этот маршрут намеренно остаётся вне /store: витрина получает здесь ключ,
// который обязателен для входа в любое /store/* пространство.
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse<CatalogConfigResponseBody>
) {
  const query = req.scope.resolve("query")

  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id"],
  })
  const defaultSalesChannelId = stores[0]?.default_sales_channel_id

  if (!defaultSalesChannelId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Store has no default sales channel configured"
    )
  }

  // api_key and sales_channel are different modules, so query.graph() can't
  // filter api_key by a linked sales_channel id — fetch publishable keys and
  // match the default channel client-side (dataset is always tiny).
  const { data: apiKeys } = await query.graph({
    entity: "api_key",
    fields: ["id", "token", "revoked_at", "sales_channels.id"],
    filters: { type: "publishable" },
  })

  const activeKey = apiKeys.find(
    (key) =>
      !key.revoked_at &&
      key.sales_channels?.some((channel) => channel?.id === defaultSalesChannelId)
  )

  if (!activeKey) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No active publishable API key linked to the default sales channel"
    )
  }

  return res.status(200).json({ publishable_api_key: activeKey.token })
}
