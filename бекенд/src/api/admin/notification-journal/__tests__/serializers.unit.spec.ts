import { maskNotificationRecipient, orderIdFromNotification } from "../serializers"

describe("notification journal serializers", () => {
  it.each([
    ["irina@example.ru", "i•••@example.ru"],
    ["+79991234567", "+7 999 •••-45-67"],
    ["@irina_shop", "@irina_shop"],
  ])("masks %s", (recipient, expected) => {
    expect(maskNotificationRecipient(recipient)).toBe(expected)
  })

  it("extracts the order relation from the stable event key", () => {
    expect(
      orderIdFromNotification({
        event_key: "shipping-return-status:order_42:approved:request",
        content: {},
      } as never)
    ).toBe("order_42")
  })
})
