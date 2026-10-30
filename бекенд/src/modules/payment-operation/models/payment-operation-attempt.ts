import { model } from "@medusajs/framework/utils"

import PaymentOperation from "./payment-operation"

const PaymentOperationAttempt = model
  .define("payment_operation_attempt", {
    id: model.id().primaryKey(),
    operation: model.belongsTo(() => PaymentOperation, {
      mappedBy: "attempts",
    }),
    number: model.number(),
    action: model.text(),
    result: model.text(),
    error_category: model.text().nullable(),
    error_reason: model.text().nullable(),
    external_event_key: model.text().nullable(),
  })
  .indexes([
    {
      name: "IDX_payment_operation_attempt_number_unique",
      on: ["operation_id", "number"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_payment_operation_attempt_event_unique",
      on: ["external_event_key"],
      unique: true,
      where: "deleted_at IS NULL AND external_event_key IS NOT NULL",
    },
  ])

export default PaymentOperationAttempt
