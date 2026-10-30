const run = jest.fn()

jest.mock("../../../../../workflows/change-customer-password", () => ({
  changeCustomerPasswordWorkflow: jest.fn(() => ({ run })),
}))

import middlewareConfig from "../../../../middlewares"
import { POST } from "../route"
import { ChangeAccountPasswordSchema } from "../validators"

function response() {
  const res: any = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
  }
  return res
}

beforeEach(() => {
  jest.clearAllMocks()
  run.mockResolvedValue({ result: { success: true } })
})

describe("POST /store/account/password", () => {
  it("is protected before body validation so an expired session never reaches the route", () => {
    const routes = (middlewareConfig as any).routes as any[]
    const registration = routes.find(
      (route) => route.matcher === "/store/account/password"
    )

    expect(registration.methods).toEqual(["POST"])
    expect(registration.middlewares).toHaveLength(2)
    expect(registration.middlewares[0].name).toContain("authenticate")
  })

  it("passes only the verified session identity and password fields to the workflow", async () => {
    const req = {
      scope: {},
      auth_context: {
        actor_id: "cus_session",
        auth_identity_id: "auth_session",
      },
      validatedBody: {
        current_password: "current-secret",
        new_password: "new-secret-value",
        email: "victim@example.test",
        customer_id: "cus_victim",
        auth_identity_id: "auth_victim",
      },
    } as any
    const res = response()

    await POST(req, res)

    expect(run).toHaveBeenCalledWith({
      input: {
        auth_identity_id: "auth_session",
        current_password: "current-secret",
        new_password: "new-secret-value",
      },
    })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ success: true })
  })

  it("rejects short passwords and every attempt to select another account in the body", () => {
    expect(() =>
      ChangeAccountPasswordSchema.parse({
        current_password: "current-secret",
        new_password: "short",
      })
    ).toThrow("Пароль должен содержать не менее 8 символов")

    for (const foreignField of ["email", "customer_id", "auth_identity_id"]) {
      expect(() =>
        ChangeAccountPasswordSchema.parse({
          current_password: "current-secret",
          new_password: "new-secret-value",
          [foreignField]: "foreign-account",
        })
      ).toThrow()
    }
  })
})
