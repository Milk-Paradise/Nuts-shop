import type { Context } from "@medusajs/framework/types"
import {
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils"

import {
  canTransitionPaymentOperation,
  FINAL_PAYMENT_OPERATION_STATES,
  type PaymentOperationState,
  type PaymentOperationTransitionSource,
  type PaymentOperationType,
} from "./constants"
import PaymentOperationAttempt from "./models/payment-operation-attempt"
import PaymentOperation from "./models/payment-operation"

type TransactionManager = {
  getConnection(): {
    execute(query: string, parameters?: unknown[]): Promise<unknown>
  }
}

export type ClaimPaymentOperationInput = {
  type: PaymentOperationType
  original_payment_id?: string | null
  provider_id: string
  cart_id?: string | null
  order_id?: string | null
  return_request_id?: string | null
  amount: number | string
  currency_code: string
  provider_operation_id?: string | null
  idempotency_key: string
  action: string
}

export type TransitionPaymentOperationInput = {
  operation_id: string
  to_state: PaymentOperationState
  source: PaymentOperationTransitionSource
  action: string
  result: string
  provider_operation_id?: string | null
  external_event_key?: string | null
  error_category?: string | null
  error_reason?: string | null
}

class PaymentOperationModuleService extends MedusaService({
  PaymentOperation,
  PaymentOperationAttempt,
}) {
  private assertClaimInput(input: ClaimPaymentOperationInput) {
    if (!input.cart_id && !input.order_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Payment operation must belong to a cart or an order"
      )
    }

    if (input.type !== "payment" && !input.original_payment_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `${input.type} operation must reference its original payment`
      )
    }
  }

  private assertClaimMatches(
    operation: {
      id: string
      type: unknown
      original_payment_id: string | null
      provider_id: string
      cart_id: string | null
      order_id: string | null
      return_request_id: string | null
      amount: number
      currency_code: string
    },
    input: ClaimPaymentOperationInput
  ) {
    const matches =
      operation.type === input.type &&
      operation.original_payment_id === (input.original_payment_id ?? null) &&
      operation.provider_id === input.provider_id &&
      operation.cart_id === (input.cart_id ?? null) &&
      operation.order_id === (input.order_id ?? null) &&
      operation.return_request_id === (input.return_request_id ?? null) &&
      Number(operation.amount) === Number(input.amount) &&
      operation.currency_code === input.currency_code.toLowerCase()

    if (!matches) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Idempotency key belongs to another payment operation: ${operation.id}`
      )
    }
  }

  @InjectTransactionManager()
  private async createClaimedOperation(
    input: ClaimPaymentOperationInput,
    @MedusaContext() context: Context = {}
  ) {
    const operation = await this.createPaymentOperations(
      {
        type: input.type,
        original_payment_id: input.original_payment_id ?? null,
        provider_id: input.provider_id,
        cart_id: input.cart_id ?? null,
        order_id: input.order_id ?? null,
        return_request_id: input.return_request_id ?? null,
        amount: Number(input.amount),
        currency_code: input.currency_code.toLowerCase(),
        state: "processing",
        provider_operation_id: input.provider_operation_id ?? null,
        idempotency_key: input.idempotency_key,
      },
      context
    )

    await this.createPaymentOperationAttempts(
      {
        operation_id: operation.id,
        number: 1,
        action: input.action,
        result: "started",
      },
      context
    )

    return operation
  }

  async claimPaymentOperation(input: ClaimPaymentOperationInput) {
    this.assertClaimInput(input)

    const [existing] = await this.listPaymentOperations({
      idempotency_key: input.idempotency_key,
    })

    if (existing) {
      this.assertClaimMatches(existing, input)
      return { operation: existing, created: false as const }
    }

    try {
      const operation = await this.createClaimedOperation(input)
      return { operation, created: true as const }
    } catch (error) {
      const [concurrent] = await this.listPaymentOperations({
        idempotency_key: input.idempotency_key,
      })

      if (concurrent) {
        this.assertClaimMatches(concurrent, input)
        return { operation: concurrent, created: false as const }
      }

      throw error
    }
  }

  @InjectTransactionManager()
  // Transaction injection is stricter than the lint rule's requested manager injection.
  // eslint-disable-next-line @medusajs/use-inject-manager-on-public-methods
  async transitionPaymentOperation(
    input: TransitionPaymentOperationInput,
    @MedusaContext() context: Context = {}
  ) {
    const manager = context.transactionManager as TransactionManager
    await manager.getConnection().execute(
      'select "id" from "payment_operation" where "id" = ? and "deleted_at" is null for update',
      [input.operation_id]
    )

    const operation = await this.retrievePaymentOperation(
      input.operation_id,
      {},
      context
    )

    if (input.external_event_key) {
      const [duplicate] = await this.listPaymentOperationAttempts(
        { external_event_key: input.external_event_key },
        {},
        context
      )

      if (duplicate) {
        return { operation, applied: false as const, duplicate: true as const }
      }
    }

    const currentState = operation.state as PaymentOperationState
    if (FINAL_PAYMENT_OPERATION_STATES.has(currentState)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Payment operation ${operation.id} already has final state ${currentState}`
      )
    }

    if (
      !canTransitionPaymentOperation({
        from: currentState,
        to: input.to_state,
        source: input.source,
      })
    ) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Payment operation transition ${currentState} -> ${input.to_state} is not allowed`
      )
    }

    const attempts = await this.listPaymentOperationAttempts(
      { operation_id: operation.id },
      { order: { number: "DESC" }, take: 1 },
      context
    )
    const number = (attempts[0]?.number ?? 0) + 1

    await this.createPaymentOperationAttempts(
      {
        operation_id: operation.id,
        number,
        action: input.action,
        result: input.result,
        error_category: input.error_category ?? null,
        error_reason: input.error_reason ?? null,
        external_event_key: input.external_event_key ?? null,
      },
      context
    )
    const updated = await this.updatePaymentOperations(
      {
        id: operation.id,
        state: input.to_state,
        provider_operation_id:
          input.provider_operation_id ?? operation.provider_operation_id,
      },
      context
    )

    return { operation: updated, applied: true as const, duplicate: false as const }
  }

  @InjectTransactionManager()
  // Transaction injection is stricter than the lint rule's requested manager injection.
  // eslint-disable-next-line @medusajs/use-inject-manager-on-public-methods
  async markPaymentOperationResultReflected(
    input: { operation_id: string; order_id: string },
    @MedusaContext() context: Context = {}
  ) {
    const manager = context.transactionManager as TransactionManager
    await manager.getConnection().execute(
      'select "id" from "payment_operation" where "id" = ? and "deleted_at" is null for update',
      [input.operation_id]
    )
    const operation = await this.retrievePaymentOperation(
      input.operation_id,
      {},
      context
    )

    if (operation.state !== "completed") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Only a completed payment operation can be reflected in an order"
      )
    }

    if (operation.result_reflected_at) {
      if (operation.order_id !== input.order_id) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "Payment operation result was already reflected in another order"
        )
      }
      return { operation, applied: false as const }
    }

    const attempts = await this.listPaymentOperationAttempts(
      { operation_id: operation.id },
      { order: { number: "DESC" }, take: 1 },
      context
    )
    await this.createPaymentOperationAttempts(
      {
        operation_id: operation.id,
        number: (attempts[0]?.number ?? 0) + 1,
        action: "reflect_order",
        result: "reflected",
      },
      context
    )

    const updated = await this.updatePaymentOperations(
      {
        id: operation.id,
        order_id: input.order_id,
        result_reflected_at: new Date(),
      },
      context
    )
    return { operation: updated, applied: true as const }
  }
}

export default PaymentOperationModuleService
