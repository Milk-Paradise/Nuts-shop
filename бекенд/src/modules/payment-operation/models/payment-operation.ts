import { model } from "@medusajs/framework/utils"

import {
  PAYMENT_OPERATION_STATES,
  PAYMENT_OPERATION_TYPES,
} from "../constants"
import PaymentOperationAttempt from "./payment-operation-attempt"

const PaymentOperation = model
  .define("payment_operation", {
    id: model.id().primaryKey(),
    type: model.enum([...PAYMENT_OPERATION_TYPES]),
    original_payment_id: model.text().nullable(),
    provider_id: model.text(),
    cart_id: model.text().nullable(),
    order_id: model.text().nullable(),
    return_request_id: model.text().nullable(),
    amount: model.bigNumber(),
    currency_code: model.text(),
    state: model.enum([...PAYMENT_OPERATION_STATES]).default("processing"),
    provider_operation_id: model.text().nullable(),
    idempotency_key: model.text().unique(),
    result_reflected_at: model.dateTime().nullable(),
    attempts: model.hasMany(() => PaymentOperationAttempt, {
      mappedBy: "operation",
    }),
  })
  .indexes([
    {
      name: "IDX_payment_operation_cart",
      on: ["cart_id"],
      where: "deleted_at IS NULL AND cart_id IS NOT NULL",
    },
    {
      name: "IDX_payment_operation_order",
      on: ["order_id"],
      where: "deleted_at IS NULL AND order_id IS NOT NULL",
    },
    {
      name: "IDX_payment_operation_original_payment",
      on: ["original_payment_id"],
      where: "deleted_at IS NULL AND original_payment_id IS NOT NULL",
    },
  ])

export default PaymentOperation
