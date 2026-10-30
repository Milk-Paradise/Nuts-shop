import type { Context } from "@medusajs/framework/types"
import {
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils"

import ErpIntegration from "./models/erp-integration"

type TransactionManager = {
  getConnection(): {
    execute(query: string, parameters?: unknown[]): Promise<unknown>
  }
}

export type RegisterErpIntegrationInput = {
  integrationKey: string
  displayName: string
}

export type SetActiveErpIntegrationInput = {
  integrationKey: string | null
}

export class ErpIntegrationRegistryService extends MedusaService({ ErpIntegration }) {
  async registerIntegration(input: RegisterErpIntegrationInput) {
    const [existing] = await this.listErpIntegrations({
      integration_key: input.integrationKey,
    })

    if (existing) {
      return this.updateErpIntegrations({
        id: existing.id,
        display_name: input.displayName,
      })
    }

    return this.createErpIntegrations({
      id: `erp_${input.integrationKey}`,
      integration_key: input.integrationKey,
      display_name: input.displayName,
      is_active: false,
    })
  }

  async getActiveIntegration() {
    const [integration] = await this.listErpIntegrations({ is_active: true })
    return integration ?? null
  }

  async listRegisteredIntegrations() {
    return this.listErpIntegrations({}, { order: { integration_key: "ASC" } })
  }

  @InjectTransactionManager()
  // The registry switch must execute inside the caller's transaction.
  // eslint-disable-next-line @medusajs/use-inject-manager-on-public-methods
  async setActiveIntegration(
    input: SetActiveErpIntegrationInput,
    @MedusaContext() context: Context = {}
  ) {
    const manager = context.transactionManager as TransactionManager
    await manager.getConnection().execute(
      'select "id" from "erp_integration" where "deleted_at" is null for update'
    )

    if (input.integrationKey) {
      const [target] = await this.listErpIntegrations(
        { integration_key: input.integrationKey },
        {},
        context
      )

      if (!target) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `ERP integration ${input.integrationKey} is not registered`
        )
      }
    }

    await this.updateErpIntegrations(
      { selector: { is_active: true }, data: { is_active: false } },
      context
    )

    if (!input.integrationKey) {
      return null
    }

    const updated = await this.updateErpIntegrations(
      {
        selector: { integration_key: input.integrationKey },
        data: { is_active: true },
      },
      context
    )

    return (Array.isArray(updated) ? updated[0] : updated) ?? null
  }
}

export default ErpIntegrationRegistryService
