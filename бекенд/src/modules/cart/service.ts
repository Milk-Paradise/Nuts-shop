import type {
  Context,
  DAL,
  ModuleJoinerConfig,
} from "@medusajs/framework/types"
import {
  InjectManager,
  MedusaContext,
  MedusaError,
} from "@medusajs/framework/utils"
import type { EntityManager } from "@medusajs/deps/mikro-orm/postgresql"
import { randomUUID } from "crypto"

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]*$/
const IMMUTABLE_COLUMNS = new Set(["id", "version", "created_at", "deleted_at"])

export type CartRecord = Record<string, unknown> & {
  id: string
  version: number
}

export type UpdateCartByVersionData = Record<string, unknown> & {
  id?: never
  version?: never
  created_at?: never
  deleted_at?: never
}

export class ConflictError extends MedusaError {
  readonly statusCode = 409

  constructor(readonly details: CartRecord) {
    super(
      MedusaError.Types.CONFLICT,
      `Cart ${details.id} was updated by another request`
    )
    this.name = "ConflictError"
  }
}

type InjectedDependencies = {
  baseRepository: DAL.RepositoryService
}

class CartService {
  protected readonly baseRepository_: DAL.RepositoryService

  constructor({ baseRepository }: InjectedDependencies) {
    this.baseRepository_ = baseRepository
  }

  __joinerConfig(): ModuleJoinerConfig {
    return {
      serviceName: "cartVersioning",
      primaryKeys: [],
      linkableKeys: {},
    }
  }

  // AIL-502 переименовал модель из "Cart" в "VersionedCart", чтобы она не
  // подменяла ORM-метаданные core-сущности Cart (баг currency_code). Побочный
  // эффект: совпадение имён было единственным путём, которым version и
  // guest_owner_hash подмешивались в query.graph("cart") и в
  // Modules.CART.retrieveCart() — после переименования оба эти пути видят
  // version как undefined на любой корзине. Чтение версии поэтому идёт тем
  // же способом, что и её запись в updateVersioned_ — прямым SQL по той же
  // физической таблице, в обход ORM-метаданных совсем.
  @InjectManager()
  async getVersion(
    id: string,
    @MedusaContext() sharedContext?: Context
  ): Promise<number | null> {
    const manager = (sharedContext!.transactionManager ??
      sharedContext!.manager) as EntityManager
    const rows = (await manager
      .getConnection()
      .execute('select "version" from "cart" where "id" = ? limit 1', [
        id,
      ])) as Array<{ version: number }>

    return rows[0]?.version ?? null
  }

  @InjectManager()
  async updateCartByVersion(
    id: string,
    expected_version: number,
    data: UpdateCartByVersionData,
    @MedusaContext() sharedContext?: Context
  ): Promise<{ cart: CartRecord; version: number }> {
    if (!id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "Cart id is required"
      )
    }

    if (!Number.isSafeInteger(expected_version) || expected_version < 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "Expected cart version must be a non-negative integer"
      )
    }

    // InjectManager guarantees a manager; prefer an existing workflow transaction.
    const manager = (sharedContext!.transactionManager ??
      sharedContext!.manager) as EntityManager

    // The version bump and its audit row must commit or roll back together.
    // Standalone calls get their own transaction; workflow calls join theirs.
    const run = (tx: EntityManager) => this.updateVersioned_(tx, id, expected_version, data)

    if (sharedContext!.transactionManager) {
      return run(manager)
    }

    return manager.transactional((tx: EntityManager) => run(tx))
  }

  private async updateVersioned_(
    manager: EntityManager,
    id: string,
    expected_version: number,
    data: UpdateCartByVersionData
  ): Promise<{ cart: CartRecord; version: number }> {
    const entries = Object.entries(data)
    const assignments = entries.map(([column]) => {
      if (!SQL_IDENTIFIER.test(column) || IMMUTABLE_COLUMNS.has(column)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_ARGUMENT,
          `Cart column ${column} cannot be updated`
        )
      }

      return `"${column}" = ?`
    })
    assignments.push('"version" = "version" + 1')

    const connection = manager.getConnection()
    const updated = (await connection.execute(
      `update "cart" set ${assignments.join(", ")} where "id" = ? and "version" = ? returning *`,
      [...entries.map(([, value]) => value), id, expected_version]
    )) as CartRecord[]

    if (updated[0]) {
      await connection.execute(
        `insert into "audit_log" ("id", "cart_id", "operation", "before_version", "after_version") values (?, ?, 'update', ?, ?)`,
        [randomUUID(), id, expected_version, updated[0].version]
      )
      return { cart: updated[0], version: updated[0].version }
    }

    const current = (await connection.execute(
      'select * from "cart" where "id" = ? limit 1',
      [id]
    )) as CartRecord[]

    if (!current[0]) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Cart ${id} was not found`
      )
    }

    throw new ConflictError(current[0])
  }
}

export default CartService
