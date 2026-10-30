import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { PAYMENT_OPERATION_MODULE } from "../index"
import PaymentOperationModuleService from "../service"

const claimInput = {
  type: "payment" as const,
  provider_id: "pp_test_test",
  cart_id: "cart_test",
  amount: 1500,
  currency_code: "rub",
  idempotency_key: "payment:session_test",
  action: "status_check",
}

moduleIntegrationTestRunner<PaymentOperationModuleService>({
  moduleName: PAYMENT_OPERATION_MODULE,
  resolve: "./src/modules/payment-operation",
  testSuite: ({ service }) => {
    describe("PaymentOperationModuleService", () => {
      it("requires an owner and an original payment for derived operations", async () => {
        await expect(
          service.claimPaymentOperation({
            ...claimInput,
            cart_id: null,
          })
        ).rejects.toThrow("must belong to a cart or an order")

        await expect(
          service.claimPaymentOperation({
            ...claimInput,
            type: "refund",
          })
        ).rejects.toThrow("must reference its original payment")
      })

      it("returns one payment operation for concurrent claims with the same key", async () => {
        const input = {
          ...claimInput,
          order_id: "order_initiate",
          idempotency_key: "payment:initiate:order_initiate:yookassa",
          action: "initiate",
        }
        const [first, second] = await Promise.all([
          service.claimPaymentOperation(input),
          service.claimPaymentOperation(input),
        ])
        const operations = await service.listPaymentOperations({
          idempotency_key: input.idempotency_key,
        })

        expect(first.operation.id).toBe(second.operation.id)
        expect(operations).toHaveLength(1)
        expect(operations[0]).toMatchObject({
          type: "payment",
          order_id: "order_initiate",
          cart_id: "cart_test",
          provider_id: "pp_test_test",
          state: "processing",
        })
      })

      it("deduplicates a repeated confirmation without a second result", async () => {
        const claimed = await service.claimPaymentOperation(claimInput)
        await service.transitionPaymentOperation({
          operation_id: claimed.operation.id,
          to_state: "completed",
          source: "reconciliation",
          action: "status_check",
          result: "captured",
          external_event_key: "event:captured:1",
        })

        const duplicate = await service.transitionPaymentOperation({
          operation_id: claimed.operation.id,
          to_state: "completed",
          source: "reconciliation",
          action: "status_check",
          result: "captured",
          external_event_key: "event:captured:1",
        })
        const attempts = await service.listPaymentOperationAttempts({
          operation_id: claimed.operation.id,
        })

        expect(duplicate).toMatchObject({ applied: false, duplicate: true })
        expect(attempts).toHaveLength(2)
      })

      it("allows only one of parallel refund and cancellation claims", async () => {
        const paymentAction = {
          ...claimInput,
          cart_id: null,
          order_id: "order_parallel",
          original_payment_id: "pay_parallel",
          idempotency_key: "payment-action:pay_parallel",
        }
        const results = await Promise.allSettled([
          service.claimPaymentOperation({
            ...paymentAction,
            type: "refund",
            action: "refund",
          }),
          service.claimPaymentOperation({
            ...paymentAction,
            type: "cancellation",
            action: "cancel",
          }),
        ])
        const operations = await service.listPaymentOperations({
          original_payment_id: "pay_parallel",
        })

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
        expect(operations).toHaveLength(1)
      })

      it("rolls back the attempt when the state update fails", async () => {
        const claimed = await service.claimPaymentOperation({
          ...claimInput,
          idempotency_key: "payment:rollback",
        })
        const update = jest
          .spyOn(service as any, "updatePaymentOperations")
          .mockRejectedValueOnce(new Error("state update failed"))

        await expect(
          service.transitionPaymentOperation({
            operation_id: claimed.operation.id,
            to_state: "completed",
            source: "reconciliation",
            action: "status_check",
            result: "captured",
          })
        ).rejects.toThrow("state update failed")
        update.mockRestore()

        const operation = await service.retrievePaymentOperation(claimed.operation.id)
        const attempts = await service.listPaymentOperationAttempts({
          operation_id: claimed.operation.id,
        })
        expect(operation.state).toBe("processing")
        expect(attempts).toHaveLength(1)
      })

      it("rolls back order reflection together with its attempt", async () => {
        const claimed = await service.claimPaymentOperation({
          ...claimInput,
          idempotency_key: "payment:reflection-rollback",
        })
        await service.transitionPaymentOperation({
          operation_id: claimed.operation.id,
          to_state: "completed",
          source: "reconciliation",
          action: "status_check",
          result: "captured",
        })
        const update = jest
          .spyOn(service as any, "updatePaymentOperations")
          .mockRejectedValueOnce(new Error("reflection update failed"))

        await expect(
          service.markPaymentOperationResultReflected({
            operation_id: claimed.operation.id,
            order_id: "order_reflection",
          })
        ).rejects.toThrow("reflection update failed")
        update.mockRestore()

        const operation = await service.retrievePaymentOperation(claimed.operation.id)
        const attempts = await service.listPaymentOperationAttempts({
          operation_id: claimed.operation.id,
        })
        expect(operation.result_reflected_at).toBeNull()
        expect(attempts).toHaveLength(2)
      })
    })
  },
})
