import { model } from "@medusajs/framework/utils"

const SmsDailyCounter = model
  .define("notification_sms_daily_counter", {
    id: model.id().primaryKey(),
    calendar_date: model.text(),
    timezone: model.text(),
    count: model.number().default(0),
  })
  .indexes([
    {
      name: "IDX_notification_sms_daily_counter_bucket_unique",
      on: ["calendar_date", "timezone"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default SmsDailyCounter
