import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import {
  CDEK_PROVIDER_KEY,
  OZON_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../index"
import ShippingProviderRegistryModuleService from "../service"
import setShippingProviderVisibilityWorkflow from "../../../workflows/set-shipping-provider-visibility"
import { setShippingProviderVisibilityStep } from "../../../workflows/steps/set-shipping-provider-visibility"
import { syncCdekPickupPoints } from "../../../workflows/sync-cdek-pickup-points"
import { syncOzonPickupPoints } from "../../../workflows/sync-ozon-pickup-points"

const cdekCityResolutionCacheInput = (key: Partial<{
  country_code: string
  city: string
  region: string
  postal_code: string
}> = {}) => ({
  country_code: "RU",
  city: "москва",
  region: "",
  postal_code: "",
  city_code: 44,
  candidate: {
    code: 44,
    city: "Москва",
    country_code: "RU",
    region: "Москва",
    region_code: 77,
  },
  fetched_at: new Date("2026-10-27T08:00:00.000Z"),
  expires_at: new Date("2026-11-26T08:00:00.000Z"),
  ...key,
})

const alwaysFailsStep = createStep("always-fails", async () => {
  throw new Error("boom")
})

// Test-only workflow: chains the real step under test with a step that
// always throws, so the workflow engine rolls back and invokes the real
// step's compensation function.
const setVisibilityThenFailWorkflow = createWorkflow(
  "set-shipping-provider-visibility-then-fail",
  function (input: { provider_key: string; is_visible: boolean }) {
    const record = setShippingProviderVisibilityStep(input)
    alwaysFailsStep()

    return new WorkflowResponse(record)
  }
)

moduleIntegrationTestRunner<ShippingProviderRegistryModuleService>({
  moduleName: SHIPPING_PROVIDER_REGISTRY_MODULE,
  resolve: "./src/modules/shipping-provider-registry",
  testSuite: ({ service, medusaApp }) => {
    describe("ShippingProviderRegistryModuleService", () => {
      it("keeps CDEK city resolutions with different cache keys independent", async () => {
        await service.createShippingCdekCityResolutionCaches([
          cdekCityResolutionCacheInput(),
          cdekCityResolutionCacheInput({ city: "тверь" }),
          cdekCityResolutionCacheInput({ region: "московская область" }),
          cdekCityResolutionCacheInput({ postal_code: "123456" }),
        ])

        const records = await service.listShippingCdekCityResolutionCaches()

        expect(records).toHaveLength(4)
      })

      it("keeps a postal-code-specific CDEK resolution separate from an unqualified one", async () => {
        await service.createShippingCdekCityResolutionCaches([
          cdekCityResolutionCacheInput({ city: "калуга" }),
          cdekCityResolutionCacheInput({ city: "калуга", postal_code: "248000" }),
        ])

        const records = await service.listShippingCdekCityResolutionCaches({ city: "калуга" })

        expect(records).toEqual(expect.arrayContaining([
          expect.objectContaining({ postal_code: "" }),
          expect.objectContaining({ postal_code: "248000" }),
        ]))
      })

      it("rejects a second active CDEK resolution for the same cache key", async () => {
        const input = cdekCityResolutionCacheInput({ city: "дубликат" })
        await service.createShippingCdekCityResolutionCaches(input)

        await expect(
          service.createShippingCdekCityResolutionCaches(input)
        ).rejects.toThrow()
      })

      it("has no visibility record for a provider that was never toggled", async () => {
        const records = await service.listShippingProviderVisibilities({
          provider_key: "untoggled-provider",
        })

        expect(records).toHaveLength(0)
      })

      it("creates a visibility record the first time a provider is toggled", async () => {
        const { result } = await setShippingProviderVisibilityWorkflow(
          medusaApp.sharedContainer
        ).run({
          input: { provider_key: "provider-a", is_visible: true },
        })

        expect(result.is_visible).toBe(true)

        const [record] = await service.listShippingProviderVisibilities({
          provider_key: "provider-a",
        })
        expect(record.is_visible).toBe(true)
      })

      it("flips the flag for an existing provider without creating a duplicate row", async () => {
        await setShippingProviderVisibilityWorkflow(medusaApp.sharedContainer).run({
          input: { provider_key: "cdek-direct", is_visible: true },
        })

        await setShippingProviderVisibilityWorkflow(medusaApp.sharedContainer).run({
          input: { provider_key: "cdek-direct", is_visible: false },
        })

        const records = await service.listShippingProviderVisibilities({
          provider_key: "cdek-direct",
        })
        expect(records).toHaveLength(1)
        expect(records[0].is_visible).toBe(false)
      })

      it("keeps multiple providers as independent records", async () => {
        await setShippingProviderVisibilityWorkflow(medusaApp.sharedContainer).run({
          input: { provider_key: "provider-a", is_visible: true },
        })
        await setShippingProviderVisibilityWorkflow(medusaApp.sharedContainer).run({
          input: { provider_key: "cdek-direct", is_visible: false },
        })

        const [providerA] = await service.listShippingProviderVisibilities({
          provider_key: "provider-a",
        })
        const [cdekDirect] = await service.listShippingProviderVisibilities({
          provider_key: "cdek-direct",
        })

        expect(providerA.is_visible).toBe(true)
        expect(cdekDirect.is_visible).toBe(false)
      })

      it("deletes the newly-created record on rollback", async () => {
        await setVisibilityThenFailWorkflow(medusaApp.sharedContainer).run({
          input: { provider_key: "rollback-new", is_visible: true },
          throwOnError: false,
        })

        const records = await service.listShippingProviderVisibilities({
          provider_key: "rollback-new",
        })
        expect(records).toHaveLength(0)
      })

      it("restores the previous flag on rollback for an existing record", async () => {
        await setShippingProviderVisibilityWorkflow(medusaApp.sharedContainer).run({
          input: { provider_key: "rollback-existing", is_visible: false },
        })

        await setVisibilityThenFailWorkflow(medusaApp.sharedContainer).run({
          input: { provider_key: "rollback-existing", is_visible: true },
          throwOnError: false,
        })

        const [record] = await service.listShippingProviderVisibilities({
          provider_key: "rollback-existing",
        })
        expect(record.is_visible).toBe(false)
      })

      it("persists pickup-point coordinates and filters the directory by city", async () => {
        await service.createShippingPickupPoints([
          {
            id: "cdek_msk1",
            provider_key: "cdek_cdek",
            external_id: "MSK1",
            name: "ПВЗ Москва",
            city: "Москва",
            city_code: 44,
            address: "ул. Тестовая, 1",
            lat: 55.751244,
            lng: 37.618423,
            schedule: "Пн-Вс 10-20",
            point_type: "PVZ",
          },
          {
            id: "cdek_tula1",
            provider_key: "cdek_cdek",
            external_id: "TULA1",
            name: "ПВЗ Тула",
            city: "Тула",
            address: "ул. Советская, 1",
          },
        ])

        const points = await service.listShippingPickupPoints({
          provider_key: "cdek_cdek",
          city: { $ilike: "Москва" },
        } as any)

        expect(points).toHaveLength(1)
        expect(points[0]).toMatchObject({
          external_id: "MSK1",
          lat: 55.751244,
          lng: 37.618423,
        })
      })

      it("repeats a full CDEK sync without duplicates and removes stale points", async () => {
        const previousKey = process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY
        process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "integration-test-key"
        try {
          await service.saveProviderConfig({
            providerKey: "cdek_cdek",
            credentials: { client_id: "id", client_secret: "secret" },
            configuration: { tariff_codes: [136] },
          })
          await service.createShippingProviderVisibilities({
            provider_key: "cdek_cdek",
            is_visible: true,
          })
          const first = {
            code: "SYNC1", name: "Первый", type: "PVZ", work_time: "10-20",
            location: { city: "Москва", city_code: 44, address: "Адрес 1", address_full: null, latitude: 55.7, longitude: 37.6 },
          }
          const second = {
            code: "SYNC2", name: "Второй", type: "PVZ", work_time: "10-20",
            location: { city: "Москва", city_code: 44, address: "Адрес 2", address_full: null, latitude: 55.8, longitude: 37.7 },
          }
          const carrier = { listPickupPoints: jest.fn()
            .mockResolvedValueOnce([first, second])
            .mockResolvedValueOnce([{ ...first, name: "Первый обновлён" }]) }
          const resolve = medusaApp.sharedContainer.resolve.bind(medusaApp.sharedContainer)
          const resolveSpy = jest.spyOn(medusaApp.sharedContainer, "resolve")
            .mockImplementation((key: string) => key === `fp_${CDEK_PROVIDER_KEY}`
              ? carrier
              : resolve(key))

          try {
            await syncCdekPickupPoints(medusaApp.sharedContainer)
            await syncCdekPickupPoints(medusaApp.sharedContainer)
          } finally {
            resolveSpy.mockRestore()
          }

          const active = await service.listShippingPickupPoints({ provider_key: "cdek_cdek" }, { take: 100 })
          expect(active).toHaveLength(1)
          expect(active[0]).toMatchObject({ external_id: "SYNC1", name: "Первый обновлён" })
        } finally {
          if (previousKey === undefined) delete process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY
          else process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = previousKey
        }
      })

      it("persists Ozon test pickup fixtures without calling an external order API", async () => {
        const previousKey = process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY
        process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "integration-test-key"
        try {
          await service.saveProviderConfig({
            providerKey: "ozon_ozon",
            credentials: { client_id: "test-client", client_secret: "test-secret" },
            configuration: { sender: { city: "Москва" } },
          })
          await service.createShippingProviderVisibilities({ provider_key: "ozon_ozon", is_visible: true })
          const carrier = {
            listPickupPoints: jest.fn().mockResolvedValue([{
              id: "ozon-test-1",
              name: "Тестовый Ozon ПВЗ",
              address: "Москва, Тестовая, 1",
              city: "Москва",
              latitude: 55.7,
              longitude: 37.6,
              working_hours: "09:00-21:00",
            }]),
          }
          const resolve = medusaApp.sharedContainer.resolve.bind(medusaApp.sharedContainer)
          const resolveSpy = jest.spyOn(medusaApp.sharedContainer, "resolve")
            .mockImplementation((key: string) => key === `fp_${OZON_PROVIDER_KEY}`
              ? carrier
              : resolve(key))
          try {
            await syncOzonPickupPoints(medusaApp.sharedContainer)
          } finally {
            resolveSpy.mockRestore()
          }
          const [point] = await service.listShippingPickupPoints({ provider_key: "ozon_ozon" }, { take: 100 })
          expect(point).toMatchObject({ external_id: "ozon-test-1", provider_key: "ozon_ozon" })
          expect(JSON.stringify(point)).not.toContain("test-secret")
        } finally {
          if (previousKey === undefined) delete process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY
          else process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = previousKey
        }
      })
    })
  },
})
