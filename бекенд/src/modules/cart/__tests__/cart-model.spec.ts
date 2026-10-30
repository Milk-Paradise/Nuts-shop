import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

import { Migration20261006000000AddVersionAuditLog } from "../migrations/Migration20261006000000AddVersionAuditLog"

const testEnv = {
  NODE_ENV: "test",
  JWT_SECRET: "test-jwt-secret",
  COOKIE_SECRET: "test-cookie-secret",
  STORE_CORS: "http://localhost:8000",
  ADMIN_CORS: "http://localhost:7001",
  AUTH_CORS: "http://localhost:7001,http://localhost:8000",
}

function migrationQueries(direction: "up" | "down") {
  const migration = new Migration20261006000000AddVersionAuditLog(
    undefined as never,
    undefined as never
  )

  migration[direction]()

  return migration.getQueries().map(String)
}

async function insertCart(dbConnection: { raw: (query: string, bindings?: unknown[]) => Promise<unknown> }, id: string) {
  await dbConnection.raw(
    `insert into "cart" ("id", "currency_code") values (?, ?)`,
    [id, "rub"]
  )
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ dbConnection }) => {
    let existingCartId: string

    beforeAll(async () => {
      const discovered = await dbConnection.raw(
        `select to_regclass('public.audit_log') as "table"`
      )
      expect(discovered.rows[0].table).toBe("audit_log")

      for (const query of migrationQueries("down")) {
        await dbConnection.raw(query)
      }

      existingCartId = "cart_legacy_1"
      await insertCart(dbConnection, existingCartId)

      for (const query of migrationQueries("up")) {
        await dbConnection.raw(query)
      }
    })

    it("backfills existing carts and defaults new carts to version zero", async () => {
      const existingResult = await dbConnection.raw(
        `select "version", "guest_owner_hash" from "cart" where "id" = ?`,
        [existingCartId]
      )
      const createdId = "cart_test_created"
      await insertCart(dbConnection, createdId)
      const createdResult = await dbConnection.raw(
        `select "version", "guest_owner_hash" from "cart" where "id" = ?`,
        [createdId]
      )

      expect(existingResult.rows[0]).toEqual({
        version: 0,
        guest_owner_hash: null,
      })
      expect(createdResult.rows[0]).toEqual({
        version: 0,
        guest_owner_hash: null,
      })
    })

    it("enforces unique guest ownership while allowing null owners", async () => {
      const firstId = "cart_test_first"
      const secondId = "cart_test_second"
      await insertCart(dbConnection, firstId)
      await insertCart(dbConnection, secondId)

      await dbConnection.raw(
        `update "cart" set "guest_owner_hash" = ? where "id" = ?`,
        ["a".repeat(64), firstId]
      )

      await expect(
        dbConnection.raw(
          `update "cart" set "guest_owner_hash" = ? where "id" = ?`,
          ["a".repeat(64), secondId]
        )
      ).rejects.toThrow()

      const cleared = await dbConnection.raw(
        `update "cart" set "guest_owner_hash" = null where "id" in (?, ?)`,
        [firstId, secondId]
      )
      expect(cleared.rowCount).toBe(2)
    })

    it("creates the customer index and an empty audit table with a cart FK", async () => {
      const cartId = "cart_test_audit"
      await insertCart(dbConnection, cartId)

      const indexResult = await dbConnection.raw(
        `select "indexdef" from "pg_indexes" where "tablename" = 'cart' and "indexname" = 'IDX_cart_customer_id'`
      )
      const customerIndexes = indexResult.rows
      expect(customerIndexes).toHaveLength(1)
      expect(customerIndexes[0].indexdef).not.toContain("UNIQUE")

      const emptyAuditLog = await dbConnection.raw(
        `select "id" from "audit_log"`
      )
      expect(emptyAuditLog.rows).toEqual([])

      await dbConnection.raw(
        `insert into "audit_log" ("id", "cart_id", "operation", "before_version", "after_version") values (?, ?, ?, ?, ?)`,
        ["audit_1", cartId, "update", 0, 1]
      )

      await expect(
        dbConnection.raw(
          `insert into "audit_log" ("id", "cart_id", "operation", "before_version", "after_version") values (?, ?, ?, ?, ?)`,
          ["audit_invalid", cartId, "invalid", 0, 1]
        )
      ).rejects.toThrow()

      await expect(
        dbConnection.raw(
          `insert into "audit_log" ("id", "cart_id", "operation", "before_version", "after_version") values (?, ?, ?, ?, ?)`,
          ["audit_orphan", "cart_missing", "expire", 0, 1]
        )
      ).rejects.toThrow()
    })
  },
})
