import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { MoyskladClient } from "../../modules/moysklad-integration/client"
import type { MoyskladCredentials } from "../../modules/moysklad-integration/credentials"
import { MOYSKLAD_INTEGRATION_MODULE } from "../../modules/moysklad-integration"
import { ERP_INTEGRATION_REGISTRY_MODULE } from "../../modules/erp-integration-registry"

export type ConfigureMoyskladConnectionInput = {
  credentials: MoyskladCredentials
}

type MoyskladConnectionService = {
  saveConnectionConfig(input: {
    credentials: MoyskladCredentials
    isActive: boolean
  }): Promise<unknown>
  setConnectionActive(isActive: boolean): Promise<unknown>
}

type ErpIntegrationRegistryService = {
  registerIntegration(input: {
    integrationKey: string
    displayName: string
  }): Promise<unknown>
  setActiveIntegration(input: {
    integrationKey: string | null
  }): Promise<unknown>
}

export async function syncMoyskladRegistry(
  container: Pick<MedusaContainer, "resolve">,
  isActive: boolean
) {
  const registry = container.resolve<ErpIntegrationRegistryService>(
    ERP_INTEGRATION_REGISTRY_MODULE
  )
  await registry.registerIntegration({
    integrationKey: "moysklad",
    displayName: "МойСклад",
  })
  return registry.setActiveIntegration({
    integrationKey: isActive ? "moysklad" : null,
  })
}

export type MoyskladConnectionTester = Pick<
  MoyskladClient,
  "testCredentials"
>

export async function configureMoyskladConnection(
  container: Pick<MedusaContainer, "resolve">,
  input: ConfigureMoyskladConnectionInput,
  client: MoyskladConnectionTester = new MoyskladClient()
) {
  await client.testCredentials(input.credentials)

  const service = container.resolve<MoyskladConnectionService>(
    MOYSKLAD_INTEGRATION_MODULE
  )

  const config = await service.saveConnectionConfig({
    credentials: input.credentials,
    isActive: true,
  })

  await syncMoyskladRegistry(container, true)
  return config
}

export const configureMoyskladConnectionStep = createStep(
  "configure-moysklad-connection",
  async (input: ConfigureMoyskladConnectionInput, { container }) => {
    const config = await configureMoyskladConnection(container, input)

    return new StepResponse(config)
  }
)

export type SetMoyskladConnectionActivityInput = {
  isActive: boolean
}

export const setMoyskladConnectionActivityStep = createStep(
  "set-moysklad-connection-activity",
  async (input: SetMoyskladConnectionActivityInput, { container }) => {
    const service = container.resolve<MoyskladConnectionService>(
      MOYSKLAD_INTEGRATION_MODULE
    )
    const config = await service.setConnectionActive(input.isActive)

    await syncMoyskladRegistry(container, input.isActive)
    return new StepResponse(config)
  }
)
