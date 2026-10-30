import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import jwt from "jsonwebtoken"

// Mirrors what a real login issues (see generate-jwt-token.js): app_metadata
// must carry the user's rbac_roles when RBAC is enabled. Some integration suites
// intentionally run without RBAC, so only create the module link when available.
export async function createAdminToken(
  container: MedusaContainer,
  email: string,
  jwtSecret: string
): Promise<string> {
  const userModule = container.resolve(Modules.USER)
  const authModule = container.resolve(Modules.AUTH)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const rbacModule = container.resolve(Modules.RBAC, {
    allowUnregistered: true,
  })

  const user = await userModule.createUsers({ email })
  const authIdentity = await authModule.createAuthIdentities({
    provider_identities: [{ provider: "emailpass", entity_id: email }],
    app_metadata: { user_id: user.id },
  })

  if (rbacModule) {
    await link.create({
      [Modules.USER]: { user_id: user.id },
      [Modules.RBAC]: { rbac_role_id: "role_super_admin" },
    })
  }

  return jwt.sign(
    {
      actor_id: user.id,
      actor_type: "user",
      auth_identity_id: authIdentity.id,
      app_metadata: { user_id: user.id, roles: ["role_super_admin"] },
    },
    jwtSecret
  )
}
