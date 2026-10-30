import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import type { IRbacModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import jwt from "jsonwebtoken"

process.env.MEDUSA_FF_RBAC = "true"

const testEnv = {
  JWT_SECRET: process.env.JWT_SECRET ?? "test-jwt-secret",
  COOKIE_SECRET: process.env.COOKIE_SECRET ?? "test-cookie-secret",
  MEDUSA_FF_RBAC: "true",
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ api, getContainer }) => {
    async function tokenForPolicy(operation: "read" | "update") {
      const rbac = getContainer().resolve(Modules.RBAC) as IRbacModuleService
      const operations = operation === "update" ? ["read", "update"] : ["read"]
      const policies = (
        await Promise.all(
          operations.map((policyOperation) =>
            rbac.listRbacPolicies({
              resource: "order",
              operation: policyOperation,
            })
          )
        )
      ).flat()

      if (policies.length !== (operation === "update" ? 2 : 1)) {
        throw new Error(`Missing order:${operation} RBAC policy`)
      }

      const role = await rbac.createRbacRoles({
        name: `Catalog refund ${operation} ${Date.now()}`,
      })
      await rbac.createRbacRolePolicies(
        policies.map((policy) => ({
          role_id: role.id,
          policy_id: policy.id,
        }))
      )

      return jwt.sign(
        {
          actor_id: `user_catalog_refund_${operation}`,
          actor_type: "user",
          auth_identity_id: `auth_catalog_refund_${operation}`,
          app_metadata: {
            user_id: `user_catalog_refund_${operation}`,
            roles: [role.id],
          },
        },
        testEnv.JWT_SECRET
      )
    }

    describe("admin catalog refund RBAC", () => {
      it("rejects a refund retry for an order read-only role", async () => {
        const token = await tokenForPolicy("read")

        await expect(
          api.post(
            "/admin/orders/order_missing/catalog-refund",
            { request_id: "11111111-1111-4111-8111-111111111111" },
            { headers: { Authorization: `Bearer ${token}` } }
          )
        ).rejects.toMatchObject({ response: { status: 403 } })
      })

      it("allows an order editor through the policy gate", async () => {
        const token = await tokenForPolicy("update")

        await expect(
          api.post(
            "/admin/orders/order_missing/catalog-refund",
            { request_id: "22222222-2222-4222-8222-222222222222" },
            { headers: { Authorization: `Bearer ${token}` } }
          )
        ).rejects.toMatchObject({ response: { status: 404 } })
      })
    })
  },
})
