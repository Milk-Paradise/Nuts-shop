import { maskNotificationSecrets } from "../mask-notification-secrets"

describe("maskNotificationSecrets", () => {
  it.each([
    ["/reset-password?token=jwt.payload.signature&email=a%40mail.test", "/reset-password?token=•••&email=a%40mail.test"],
    ["https://shop.test/reset-password?email=a%40mail.test&token=a%2Bb#section", "https://shop.test/reset-password?email=a%40mail.test&token=•••#section"],
    ["https://shop.test/unsubscribe/abandoned-cart?customer_id=cus_1&token=signature", "https://shop.test/unsubscribe/abandoned-cart?customer_id=cus_1&token=•••"],
    ["https://t.me/catalog_bot?start=binding-secret", "https://t.me/catalog_bot?start=•••"],
    ["https://t.me/catalog_bot?x=1&start=binding-secret&token=secret", "https://t.me/catalog_bot?x=1&start=•••&token=•••"],
    ['<a href="https://shop.test/reset?email=a&amp;token=secret">Reset</a>', '<a href="https://shop.test/reset?email=a&amp;token=•••">Reset</a>'],
    ["(/reset?token=first&token=second)\n/reset?token=third", "(/reset?token=•••&token=•••)\n/reset?token=•••"],
  ])("masks only secret values in %s", (input, expected) => {
    expect(maskNotificationSecrets(input)).toBe(expected)
  })

  it.each([
    null,
    "",
    "Заказ №42 оплачен.\nhttps://shop.test/cart?cart_id=cart_1&start=1",
    "https://shop.test/path#section?token=ordinary-fragment",
    "https://shop.test/?access_token=other&token_hint=hint",
    "Текст token=ordinary start=ordinary",
  ])("preserves ordinary content: %s", (input) => {
    expect(maskNotificationSecrets(input)).toBe(input)
  })
})
