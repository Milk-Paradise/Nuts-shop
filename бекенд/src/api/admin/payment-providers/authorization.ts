import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { NextFunction } from "express"

const SUPER_ADMIN_ROLE_ID = "role_super_admin"

type FeatureFlagRouter = {
  isFeatureEnabled(flag: string): boolean
}

function roleIdsFromRequest(req: AuthenticatedMedusaRequest): string[] {
  const roles = req.auth_context?.app_metadata?.roles

  return Array.isArray(roles)
    ? roles.filter((role): role is string => typeof role === "string")
    : []
}

export async function requirePaymentProviderConfigReadPermission(
  req: AuthenticatedMedusaRequest,
  _res: MedusaResponse,
  next: NextFunction
) {
  try {
    const featureFlagRouter = req.scope.resolve(
      ContainerRegistrationKeys.FEATURE_FLAG_ROUTER
    ) as FeatureFlagRouter

    if (!featureFlagRouter.isFeatureEnabled("rbac")) {
      return next()
    }

    const roleIds = roleIdsFromRequest(req)

    if (!roleIds.includes(SUPER_ADMIN_ROLE_ID)) {
      throw new MedusaError(
        MedusaError.Types.FORBIDDEN,
        "You do not have permission to view payment provider configurations"
      )
    }

    return next()
  } catch (error) {
    return next(error)
  }
}
