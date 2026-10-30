import {
  decryptNotificationCredentials,
  encryptNotificationCredentials,
} from "../credentials"

describe("notification channel credentials", () => {
  const previousKey = process.env.SECRET_ENCRYPTION_KEY

  beforeAll(() => {
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64")
  })

  afterAll(() => {
    if (previousKey === undefined) delete process.env.SECRET_ENCRYPTION_KEY
    else process.env.SECRET_ENCRYPTION_KEY = previousKey
  })

  it("stores and reads credentials through the shared secret crypto", () => {
    const credentials = { token: "secret-token", sender: "shop" }
    const encrypted = encryptNotificationCredentials(credentials)

    expect(encrypted).toMatch(/^v2:/)
    expect(encrypted).not.toContain("secret-token")
    expect(decryptNotificationCredentials(encrypted)).toEqual(credentials)
  })
})
