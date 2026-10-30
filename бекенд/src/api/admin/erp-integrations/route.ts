import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  ERP_INTEGRATION_REGISTRY_MODULE,
  type ErpIntegrationRegistryModuleService,
} from "../../../modules/erp-integration-registry"

type ErpIntegrationResponse = {
  active_integration_key: string | null
  integrations: Array<{
    integration_key: string
    display_name: string
    is_active: boolean
  }>
}

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse<ErpIntegrationResponse>
) {
  const service = req.scope.resolve<ErpIntegrationRegistryModuleService>(
    ERP_INTEGRATION_REGISTRY_MODULE
  )
  const [activeIntegration, integrations] = await Promise.all([
    service.getActiveIntegration(),
    service.listRegisteredIntegrations(),
  ])

  return res.json({
    active_integration_key: activeIntegration?.integration_key ?? null,
    integrations: integrations.map((integration) => ({
      integration_key: integration.integration_key,
      display_name: integration.display_name,
      is_active: integration.is_active,
    })),
  })
}
