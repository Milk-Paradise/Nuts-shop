import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { NOTIFICATION_DOMAIN_MODULE, getNotificationDeliveryAdapter } from "../index"
import { DELIVERY_WINDOW_MS } from "../delivery-policy"
import NotificationDomainProviderService from "../provider"
import NotificationDomainModuleService from "../service"
import E2ENotificationService from "../../notification-e2e/service"
import { sweepNotificationDeliveries } from "../../../jobs/notification-delivery-sweep"

jest.setTimeout(30_000)

const previousKey = process.env.SECRET_ENCRYPTION_KEY

const notificationInput = {
  event_key: "order-confirmation:order_1",
  type: "order-confirmation",
  recipient: "customer@example.test",
  channel: "email" as const,
  text_origin: "fallback" as const,
  content: { subject: "Order", body: "Created" },
}

moduleIntegrationTestRunner<NotificationDomainModuleService>({
  moduleName: NOTIFICATION_DOMAIN_MODULE,
  resolve: "./src/modules/notification-domain",
  testSuite: ({ service, MikroOrmWrapper }) => {
    describe("NotificationDomainModuleService", () => {
      beforeAll(() => {
        process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString("base64")
      })

      afterAll(() => {
        if (previousKey === undefined) delete process.env.SECRET_ENCRYPTION_KEY
        else process.env.SECRET_ENCRYPTION_KEY = previousKey
      })

      it("loads the module and registers the Telegram and SMS delivery adapters", async () => {
        expect(service).toBeDefined()
        expect(getNotificationDeliveryAdapter("telegram")?.channel).toBe("telegram")
        expect(getNotificationDeliveryAdapter("sms")?.channel).toBe("sms")
      })

      it("creates only one row for concurrent inserts with the same identity", async () => {
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            service.createNotificationOnce(notificationInput)
          )
        )

        expect(results.filter((result) => result.created)).toHaveLength(1)
        expect(new Set(results.map((result) => result.notification.id))).toHaveProperty(
          "size",
          1
        )
        await expect(
          service.listNotificationMessages({
            event_key: notificationInput.event_key,
            type: notificationInput.type,
            recipient: notificationInput.recipient,
            channel: notificationInput.channel,
          })
        ).resolves.toHaveLength(1)
      })

      it("atomically grants exactly one SMS unit when one remains", async () => {
        const bucket = `concurrent-${Date.now()}`
        await expect(service.reserveSmsDailyLimit(bucket, "Europe/Minsk", 1)).resolves.toBe(true)

        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            service.reserveSmsDailyLimit(bucket, "Europe/Minsk", 2)
          )
        )

        expect(results.filter(Boolean)).toHaveLength(1)
      })

      it("allows exactly one concurrent database lease claim for one notification", async () => {
        const { notification } = await service.createNotificationOnce({
          ...notificationInput,
          event_key: `lease-claim-${Date.now()}`,
        })
        const firstManager = MikroOrmWrapper.forkManager()
        const secondManager = MikroOrmWrapper.forkManager()

        const claims = await Promise.all([
          service.claimNotificationDeliveryLease(
            notification.id,
            new Date(),
            { transactionManager: firstManager } as never
          ),
          service.claimNotificationDeliveryLease(
            notification.id,
            new Date(),
            { transactionManager: secondManager } as never
          ),
        ])

        const [winner] = claims.filter((claim): claim is string => claim !== null)
        expect(claims.filter((claim) => claim !== null)).toHaveLength(1)
        expect(winner).toBeTruthy()

        await expect(
          service.retrieveNotificationMessage(notification.id)
        ).resolves.toMatchObject({
          lease_token: winner,
        })
      })

      it("keeps a renewed lease out of the sweep, unlike an expired lease", async () => {
        const manager = MikroOrmWrapper.getManager()
        const createProcessingNotification = async (suffix: string) => {
          const { notification } = await service.createNotificationOnce({
            ...notificationInput,
            event_key: `lease-heartbeat-${suffix}-${Date.now()}`,
          })
          await manager.execute(
            `update "notification_message"
             set "created_at" = now() - (? * interval '1 millisecond')
             where "id" = ?`,
            [DELIVERY_WINDOW_MS + 1, notification.id]
          )
          return notification
        }
        const renewed = await createProcessingNotification("renewed")
        const renewedToken = await service.claimNotificationDeliveryLease(
          renewed.id,
          new Date()
        )
        expect(renewedToken).toBeTruthy()

        // Put the lease close to expiry, then let the heartbeat renewal extend it.
        await manager.execute(
          `update "notification_message"
           set "lease_expires_at" = now() + interval '100 milliseconds'
           where "id" = ?`,
          [renewed.id]
        )
        const [beforeRenewal] = (await manager.execute(
          `select "lease_expires_at" from "notification_message" where "id" = ?`,
          [renewed.id]
        )) as { lease_expires_at: Date }[]
        await expect(
          service.renewNotificationDeliveryLease(renewed.id, renewedToken!)
        ).resolves.toBe(true)
        const [afterRenewal] = (await manager.execute(
          `select "lease_expires_at" from "notification_message" where "id" = ?`,
          [renewed.id]
        )) as { lease_expires_at: Date }[]
        expect(new Date(afterRenewal.lease_expires_at).getTime()).toBeGreaterThan(
          new Date(beforeRenewal.lease_expires_at).getTime()
        )

        const expired = await createProcessingNotification("expired")
        expect(
          await service.claimNotificationDeliveryLease(expired.id, new Date())
        ).toBeTruthy()
        await manager.execute(
          `update "notification_message"
           set "lease_expires_at" = now() - interval '1 millisecond'
           where "id" = ?`,
          [expired.id]
        )

        const container = {
          resolve: (key: string) =>
            key === NOTIFICATION_DOMAIN_MODULE ? service : { error: jest.fn() },
        }
        await expect(sweepNotificationDeliveries(container as never)).resolves.toEqual({
          exhausted: 1,
          executed: 0,
        })
        await expect(
          service.retrieveNotificationMessage(renewed.id)
        ).resolves.toMatchObject({ state: "processing", lease_token: renewedToken })
        await expect(
          service.retrieveNotificationMessage(expired.id)
        ).resolves.toMatchObject({ state: "retries_exhausted" })
      })

      it("keeps spent SMS units when the limit is lowered", async () => {
        const bucket = `lowered-${Date.now()}`
        await expect(service.reserveSmsDailyLimit(bucket, "Europe/Minsk", 3)).resolves.toBe(true)
        await expect(service.reserveSmsDailyLimit(bucket, "Europe/Minsk", 3)).resolves.toBe(true)

        await expect(service.reserveSmsDailyLimit(bucket, "Europe/Minsk", 1)).resolves.toBe(false)
      })

      it("uses independent SMS buckets after the store calendar date changes", async () => {
        const timezone = "Europe/Minsk"
        const firstDate = `day-one-${Date.now()}`
        const secondDate = `day-two-${Date.now()}`
        await expect(service.reserveSmsDailyLimit(firstDate, timezone, 1)).resolves.toBe(true)
        await expect(service.reserveSmsDailyLimit(firstDate, timezone, 1)).resolves.toBe(false)

        await expect(service.reserveSmsDailyLimit(secondDate, timezone, 1)).resolves.toBe(true)
      })

      it("deduplicates repeated provider calls and delivers email once", async () => {
        const send = jest
          .spyOn(E2ENotificationService.prototype, "send")
          .mockResolvedValue({ id: "mail_1" })
        const provider = new NotificationDomainProviderService(
          {
            logger: { error: jest.fn() } as never,
            query: {
              graph: jest.fn(async ({ entity }: { entity: string }) => ({
                data:
                  entity === "order"
                    ? [
                        {
                          id: "order_provider_1",
                          display_id: 101,
                          email: "provider@example.test",
                          items: [],
                          shipping_methods: [],
                          fulfillments: [],
                          payment_collections: [],
                        },
                      ]
                    : [],
              })),
            },
            notificationDomain: service,
            cmsSnapshot: {
              listCmsSnapshots: jest.fn().mockResolvedValue([]),
            } as never,
          },
          {
            email: {
              provider: "e2e",
              options: { base_url: "http://notification-stub.test" },
            },
          }
        )
        const input = {
          to: "provider@example.test",
          channel: "email",
          template: "order-confirmation",
          data: { order_id: "order_provider_1", display_id: 101 },
          content: {
            subject: "Заказ №101 принят",
            text: "Заказ №101 принят.",
          },
        }

        try {
          await provider.send(input)
          await provider.send(input)

          await expect(
            service.listNotificationMessages({
              event_key: "order-confirmation:order_provider_1",
              type: "order-confirmation",
              recipient: "provider@example.test",
              channel: "email",
            })
          ).resolves.toMatchObject([{ state: "completed" }])
          expect(send).toHaveBeenCalledTimes(1)
        } finally {
          send.mockRestore()
        }
      })

      it("rejects a conditional transition from an unexpected state", async () => {
        const { notification } = await service.createNotificationOnce({
          ...notificationInput,
          event_key: "transition-mismatch",
        })
        await service.transitionNotification(
          notification.id,
          "processing",
          "completed"
        )

        await expect(
          service.transitionNotification(
            notification.id,
            "processing",
            "retry_pending"
          )
        ).rejects.toThrow("is not in expected state processing")
      })

      it("persists every terminal and waiting state from processing", async () => {
        const targetStates = [
          "completed",
          "retry_pending",
          "retries_exhausted",
          "permanently_rejected",
          "outcome_unknown",
        ] as const

        const reached = new Set(["processing"])
        for (const targetState of targetStates) {
          const { notification } = await service.createNotificationOnce({
            ...notificationInput,
            event_key: `reach-${targetState}`,
          })
          const updated = await service.transitionNotification(
            notification.id,
            "processing",
            targetState
          )
          reached.add(updated.state)
        }

        expect(reached).toHaveProperty("size", 6)
      })

      it("keeps pinned credentials readable when a replacement is saved", async () => {
        const first = await service.replaceChannelCredentials({
          channel: "telegram",
          credentials: { bot_token: "first-token" },
        })
        const second = await service.replaceChannelCredentials({
          channel: "telegram",
          credentials: { bot_token: "second-token" },
        })

        await expect(
          service.retrieveRuntimeChannelCredentials(first.id)
        ).resolves.toEqual({ bot_token: "first-token" })
        await expect(
          service.retrieveRuntimeChannelCredentials(second.id)
        ).resolves.toEqual({ bot_token: "second-token" })
      })

      it("rejects waiting messages on revoke but leaves an in-flight attempt alone", async () => {
        const setting = await service.replaceChannelCredentials({
          channel: "sms",
          credentials: { login: "shop", password: "secret" },
        })
        const waiting = await service.createNotificationOnce({
          ...notificationInput,
          event_key: "sms-waiting",
          recipient: "+79990000001",
          channel: "sms",
        })
        await service.transitionNotification(
          waiting.notification.id,
          "processing",
          "retry_pending"
        )
        const inFlight = await service.createNotificationOnce({
          ...notificationInput,
          event_key: "sms-in-flight",
          recipient: "+79990000002",
          channel: "sms",
        })

        await service.revokeChannel("sms")

        await expect(
          service.retrieveNotificationMessage(waiting.notification.id)
        ).resolves.toMatchObject({
          state: "permanently_rejected",
          reason: "канал отключён",
        })
        await expect(
          service.retrieveNotificationMessage(inFlight.notification.id)
        ).resolves.toMatchObject({ state: "processing" })
        await expect(
          service.retrieveRuntimeChannelCredentials(setting.id)
        ).resolves.toEqual({ login: "shop", password: "secret" })
      })

      it("rejects waiting messages when the channel is disabled", async () => {
        await service.replaceChannelCredentials({
          channel: "telegram",
          credentials: { bot_token: "verified-token" },
        })
        await service.setChannelEnabled("telegram", true)
        const waiting = await service.createNotificationOnce({
          ...notificationInput,
          event_key: "telegram-waiting",
          recipient: "chat_1",
          channel: "telegram",
        })
        await service.transitionNotification(
          waiting.notification.id,
          "processing",
          "retry_pending"
        )

        await service.setChannelEnabled("telegram", false)

        await expect(
          service.retrieveNotificationMessage(waiting.notification.id)
        ).resolves.toMatchObject({
          state: "permanently_rejected",
          reason: "канал отключён",
        })
      })

      it("stores a seller Telegram recipient after consuming a one-time token", async () => {
        await service.replaceChannelCredentials({
          channel: "telegram",
          credentials: { bot_token: "seller-bot-token" },
        })
        await service.setChannelEnabled("telegram", true)
        await service.issueTelegramBindingToken(
          "seller-notification-recipient",
          "seller-token-hash",
          new Date("2026-10-08T12:15:00Z")
        )

        await expect(
          service.consumeTelegramBindingToken(
            "seller-token-hash",
            "424242",
            new Date("2026-10-08T12:00:00Z")
          )
        ).resolves.toEqual({
          status: "linked",
          account_id: "seller-notification-recipient",
        })
        await expect(service.getSellerChannelSettings()).resolves.toMatchObject({
          telegram: "424242",
          telegram_available: true,
        })
      })

      it("stores Telegram identity, exposes it in status, and clears it on disconnect", async () => {
        const accountId = `customer-identity-${Date.now()}`
        await service.issueTelegramBindingToken(
          accountId,
          `identity-token-${Date.now()}`,
          new Date("2026-10-08T12:15:00Z")
        )

        const [binding] = await service.listTelegramBindings({ account_id: accountId })
        await service.consumeTelegramBindingToken(
          binding.token_hash!,
          "424243",
          new Date("2026-10-08T12:00:00Z"),
          "catalog_customer",
          "Иван Петров"
        )

        await expect(service.getTelegramBindingStatus(accountId)).resolves.toMatchObject({
          connected: true,
          state: "active",
          username: "catalog_customer",
          display_name: "Иван Петров",
        })

        await service.disableTelegramBinding(accountId)

        await expect(service.getTelegramBindingStatus(accountId)).resolves.toMatchObject({
          connected: false,
          state: "disabled",
          username: null,
          display_name: null,
        })

        await service.issueTelegramBindingToken(
          accountId,
          `identity-token-without-username-${Date.now()}`,
          new Date("2026-10-08T12:15:00Z")
        )
        const [reissuedBinding] = await service.listTelegramBindings({
          account_id: accountId,
        })
        await service.consumeTelegramBindingToken(
          reissuedBinding.token_hash!,
          "424244",
          new Date("2026-10-08T12:01:00Z"),
          null,
          "Иван"
        )

        await expect(service.getTelegramBindingStatus(accountId)).resolves.toMatchObject({
          connected: true,
          state: "active",
          username: null,
          display_name: "Иван",
        })
      })

      it("changes the SMS daily limit without replacing credentials", async () => {
        const setting = await service.replaceChannelCredentials({
          channel: "sms",
          credentials: { login: "limit-shop", password: "limit-secret" },
        })

        await expect(service.setSmsDailyLimit(125)).resolves.toMatchObject({
          id: setting.id,
          daily_limit: 125,
        })
        await expect(
          service.retrieveRuntimeChannelCredentials(setting.id)
        ).resolves.toEqual({ login: "limit-shop", password: "limit-secret" })
      })

      it("disables a blocked Telegram binding and rejects its waiting messages", async () => {
        await service.createTelegramBindings({
          account_id: "customer_telegram_blocked",
          chat_id: "987654",
          state: "active",
          token_hash: null,
          token_expires_at: null,
          token_used_at: null,
        })
        const waiting = await service.createNotificationOnce({
          ...notificationInput,
          event_key: "telegram-blocked-waiting",
          recipient: "987654",
          channel: "telegram",
        })
        await service.transitionNotification(
          waiting.notification.id,
          "processing",
          "retry_pending"
        )

        await service.disableTelegramBindingByChatId("987654")

        await expect(
          service.retrieveNotificationMessage(waiting.notification.id)
        ).resolves.toMatchObject({
          state: "permanently_rejected",
          reason: "покупатель отключил канал",
        })
        await expect(
          service.listTelegramBindings({
            account_id: "customer_telegram_blocked",
          })
        ).resolves.toEqual([
          expect.objectContaining({ state: "disabled", chat_id: null }),
        ])
      })
    })
  },
})
