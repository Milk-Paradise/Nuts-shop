import { model } from "@medusajs/framework/utils"

const CmsSnapshot = model.define("cms_snapshot", {
  id: model.id().primaryKey(),
  key: model.text(),
  revision: model.text(),
  payload: model.json(),
  content_updated_at: model.dateTime(),
}).indexes([{ on: ["key"], unique: true }])

export default CmsSnapshot
