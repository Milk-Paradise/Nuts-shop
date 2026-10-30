import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  retrieveStorePickupSettings,
  STORE_PICKUP_SETTING_ID,
  type StorePickupSettings,
} from "../../../modules/store-pickup/utils"
import { saveStorePickupSettingsWorkflow } from "../../../workflows/save-store-pickup-settings"
import type { SaveStorePickupSettingsBody } from "./validators"

const EMPTY_SETTINGS: StorePickupSettings = {
  id: STORE_PICKUP_SETTING_ID,
  address: "",
  hours: "",
  is_enabled: false,
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const settings = await retrieveStorePickupSettings(req.scope)
  res.status(200).json({ store_pickup: settings ?? EMPTY_SETTINGS })
}

export async function POST(
  req: MedusaRequest<SaveStorePickupSettingsBody>,
  res: MedusaResponse
) {
  const { result } = await saveStorePickupSettingsWorkflow(req.scope).run({
    input: req.validatedBody,
  })

  res.status(200).json({ store_pickup: result.settings })
}

