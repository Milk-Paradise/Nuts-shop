import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  STORE_PICKUP_MODULE,
} from "../../modules/store-pickup"
import type StorePickupModuleService from "../../modules/store-pickup/service"
import {
  STORE_PICKUP_SETTING_ID,
  type StorePickupSettings,
} from "../../modules/store-pickup/utils"

export type SaveStorePickupSettingsInput = {
  address: string
  hours: string
  is_enabled: boolean
}

type PreviousSettings = {
  existed: boolean
  value: StorePickupSettings | null
}

export const saveStorePickupSettingsStep = createStep(
  "save-store-pickup-settings",
  async (input: SaveStorePickupSettingsInput, { container }) => {
    const service = container.resolve<StorePickupModuleService>(STORE_PICKUP_MODULE)
    const [current] = await service.listStorePickupSettings({
      id: STORE_PICKUP_SETTING_ID,
    })
    const normalized = {
      address: input.address.trim(),
      hours: input.hours.trim(),
      is_enabled: input.is_enabled,
    }
    const saved = current
      ? await service.updateStorePickupSettings({ id: current.id, ...normalized })
      : await service.createStorePickupSettings({
          id: STORE_PICKUP_SETTING_ID,
          ...normalized,
        })

    return new StepResponse(saved, {
      existed: !!current,
      value: (current as StorePickupSettings | undefined) ?? null,
    } satisfies PreviousSettings)
  },
  async (previous: PreviousSettings | undefined, { container }) => {
    if (!previous) return

    const service = container.resolve<StorePickupModuleService>(STORE_PICKUP_MODULE)
    if (!previous.existed || !previous.value) {
      await service.deleteStorePickupSettings(STORE_PICKUP_SETTING_ID)
      return
    }

    await service.updateStorePickupSettings({
      id: previous.value.id,
      address: previous.value.address,
      hours: previous.value.hours,
      is_enabled: previous.value.is_enabled,
    })
  }
)

