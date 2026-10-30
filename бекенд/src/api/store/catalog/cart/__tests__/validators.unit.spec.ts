import { validateAndTransformBody } from "@medusajs/framework/http"
import { UpdateCatalogCartSchema } from "../validators"

// AIL-536: validateAndTransformBody вызывает zodSchema.strict() внутри,
// если метод strict есть у схемы — а он есть у любого ZodObject, включая
// настроенный через .passthrough(). Раньше schema.passthrough() этим
// .strict() стирался, и metadata (единственное реальное поле PUT-запроса)
// отклонялось как unrecognized_keys на каждое изменение корзины.
describe("UpdateCatalogCartSchema", () => {
  it("passes metadata through the real validateAndTransformBody middleware", async () => {
    const body = {
      cart_id: "cart_01",
      version: 3,
      metadata: { catalog_selected_line_ids: ["item_1", "item_2"] },
    }
    const req = { body } as any
    const next = jest.fn()

    await validateAndTransformBody(UpdateCatalogCartSchema)(req, {} as any, next)

    expect(next).toHaveBeenCalledWith()
    expect(req.validatedBody).toEqual(body)
  })
})
