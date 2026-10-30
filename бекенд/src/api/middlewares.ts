import {
  authenticate,
  defineMiddlewares,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { PolicyOperation } from "@medusajs/framework/utils"

import { cartLockErrorHandler } from "./cart-lock-error-handler"
import { cartRateLimit } from "./cart-rate-limit"
import {
  cartIdFromBody,
  cartIdFromParams,
  rejectFrozenCart,
} from "./catalog/reject-frozen-cart"

import { RegisterEmailPasswordSchema } from "./auth/validators"
import { CmsTargetsValidateSchema } from "./cms/targets/validate/route"
import { CmsNotificationPreviewSchema } from "./cms/notification-preview/validators"
import {
  CheckCatalogPaymentStatusSchema,
  CheckoutCatalogOrderSchema,
  GetCategoryProductsSchema,
  GetCatalogSearchSchema,
  InitiateCatalogPaymentSchema,
  GetPickupPointsSchema,
  GetShippingOptionsSchema,
  GetShippingTariffsSchema,
  SelectCatalogShippingOptionSchema,
  SyncCatalogShippingAddressSchema,
  ValidateCatalogCartSchema,
} from "./catalog/validators"
import { AddWishlistItemSchema } from "./store/account/wishlist/validators"
import { ChangeAccountPasswordSchema } from "./store/account/password/validators"
import { UnsubscribeAbandonedCartSchema } from "./store/unsubscribe/abandoned-cart/validators"
import {
  validateProductSkuUniqueness,
  validateVariantBatchSkuUniqueness,
  validateVariantSkuUniqueness,
} from "./admin/products/sku-uniqueness"
import {
  SaveMoyskladConnectionSchema,
  SetMoyskladConnectionActivitySchema,
  GetMoyskladOrderSyncsSchema,
} from "./admin/moysklad/validators"
import {
  validateDocumentUploads,
  validateProductDocumentReferences,
} from "./admin/uploads/document-validation"
import {
  AdminSaveSiteLinkSchema,
  AdminSaveSiteTabSchema,
} from "./admin/site-content/validators"
import { requirePaymentProviderConfigReadPermission } from "./admin/payment-providers/authorization"
import {
  AdminSavePaymentProviderConfiguration,
  AdminUpdatePaymentProviderStatus,
} from "./admin/payment-providers/validators"
import {
  AdminConfigureNotificationChannelSchema,
  AdminSaveSellerEmailSchema,
  AdminSetSmsDailyLimitSchema,
  AdminSetNotificationChannelEnabledSchema,
} from "./admin/notification-channels/validators"
import {
  SaveCdekProviderConfigurationSchema,
  SaveOzonProviderConfigurationSchema,
  ListCdekTariffsSchema,
  SaveShippingStorePackageSchema,
  SetShippingProviderVisibilitySchema,
} from "./admin/shipping-providers/validators"
import { ResolveShippingReturnRequestSchema } from "./admin/shipping-return-requests/validators"
import { SaveStorePickupSettingsSchema } from "./admin/store-pickup/validators"
import { maskAdminNotificationResponse } from "./admin/notifications/mask-response"
import { GetNotificationsSchema } from "./admin/notification-journal/validators"
import { AdminCatalogRefundSchema } from "./admin/orders/catalog-refund/validators"
import { SmscCallbackSchema } from "./hooks/smsc/validators"
import {
  GetCatalogCartSchema,
  UpdateCatalogCartSchema,
} from "./store/catalog/cart/validators"

export default defineMiddlewares({
  errorHandler: cartLockErrorHandler(),
  routes: [
    {
      method: ["GET"],
      matcher: "/admin/notifications",
      middlewares: [maskAdminNotificationResponse],
    },
    {
      method: ["GET"],
      matcher: "/admin/notifications/:id",
      middlewares: [maskAdminNotificationResponse],
    },
    {
      method: ["POST"],
      matcher: "/hooks/smsc",
      middlewares: [validateAndTransformBody(SmscCallbackSchema)],
    },
    {
      method: ["POST"],
      matcher: "/cms/notification-preview",
      middlewares: [validateAndTransformBody(CmsNotificationPreviewSchema)],
    },
    {
      method: ["GET"],
      matcher: "/admin/notification-journal",
      middlewares: [validateAndTransformQuery(GetNotificationsSchema, {})],
    },
    {
      method: ["POST"],
      matcher: "/admin/notification-channels/sms/limit",
      middlewares: [validateAndTransformBody(AdminSetSmsDailyLimitSchema)],
    },
    {
      method: ["POST"],
      matcher: "/admin/notification-channels/seller",
      middlewares: [validateAndTransformBody(AdminSaveSellerEmailSchema)],
    },
    {
      method: ["POST"],
      matcher: "/admin/uploads",
      middlewares: [validateDocumentUploads],
    },
    {
      method: ["POST"],
      matcher: "/admin/orders/:id/catalog-refund",
      middlewares: [validateAndTransformBody(AdminCatalogRefundSchema)],
      policies: [
        {
          resource: "order",
          operation: PolicyOperation.update,
        },
      ],
    },
    {
      method: ["POST"],
      matcher: "/admin/orders/:id/store-pickup/complete",
      policies: [
        {
          resource: "order",
          operation: PolicyOperation.update,
        },
      ],
    },
    {
      method: ["POST"],
      matcher: "/admin/products",
      middlewares: [
        validateProductSkuUniqueness,
        validateProductDocumentReferences,
      ],
    },
    {
      method: ["POST"],
      matcher: "/admin/notification-channels/configure",
      middlewares: [
        validateAndTransformBody(AdminConfigureNotificationChannelSchema),
      ],
    },
    {
      method: ["POST"],
      matcher: "/admin/notification-channels/:channel/status",
      middlewares: [
        validateAndTransformBody(AdminSetNotificationChannelEnabledSchema),
      ],
    },
    {
      method: ["GET"],
      matcher: "/admin/payment-providers",
      middlewares: [requirePaymentProviderConfigReadPermission],
    },
    {
      method: ["POST"],
      matcher: "/admin/payment-providers/:provider_id",
      middlewares: [
        requirePaymentProviderConfigReadPermission,
        validateAndTransformBody(AdminSavePaymentProviderConfiguration),
      ],
    },
    {
      method: ["POST"],
      matcher: "/admin/payment-providers/:provider_id/status",
      middlewares: [
        requirePaymentProviderConfigReadPermission,
        validateAndTransformBody(AdminUpdatePaymentProviderStatus),
      ],
    },
    {
      method: ["POST"],
      matcher: "/admin/products/:id",
      middlewares: [
        validateProductSkuUniqueness,
        validateProductDocumentReferences,
      ],
    },
    {
      method: ["POST"],
      matcher: "/admin/products/:id/variants",
      middlewares: [validateVariantSkuUniqueness],
    },
    {
      method: ["POST"],
      matcher: "/admin/products/:id/variants/:variant_id",
      middlewares: [validateVariantSkuUniqueness],
    },
    {
      method: ["POST"],
      matcher: "/admin/products/:id/variants/batch",
      middlewares: [validateVariantBatchSkuUniqueness],
    },
    {
      method: ["POST"],
      matcher: "/admin/moysklad/config",
      middlewares: [validateAndTransformBody(SaveMoyskladConnectionSchema)],
    },
    {
      method: ["POST"],
      matcher: "/admin/moysklad/config/active",
      middlewares: [
        validateAndTransformBody(SetMoyskladConnectionActivitySchema),
      ],
    },
    {
      method: ["GET"],
      matcher: "/admin/moysklad/order-syncs",
      middlewares: [validateAndTransformQuery(GetMoyskladOrderSyncsSchema, {})],
    },
    {
      method: ["POST"],
      matcher: "/admin/site-content/tabs",
      middlewares: [validateAndTransformBody(AdminSaveSiteTabSchema)],
    },
    {
      method: ["POST"],
      matcher: "/admin/site-content/links",
      middlewares: [validateAndTransformBody(AdminSaveSiteLinkSchema)],
    },
    {
      method: ["POST"],
      matcher: "/admin/shipping-providers",
      middlewares: [validateAndTransformBody(SetShippingProviderVisibilitySchema)],
    },
    {
      method: ["POST"],
      matcher: "/admin/shipping-providers/cdek",
      middlewares: [validateAndTransformBody(SaveCdekProviderConfigurationSchema)],
    },
    {
      method: ["POST"],
      matcher: "/admin/shipping-providers/ozon",
      middlewares: [validateAndTransformBody(SaveOzonProviderConfigurationSchema)],
    },
    {
      method: ["POST"],
      matcher: "/admin/shipping-providers/cdek/tariffs",
      middlewares: [validateAndTransformBody(ListCdekTariffsSchema)],
    },
    {
      method: ["POST"],
      matcher: "/admin/shipping-providers/package",
      middlewares: [validateAndTransformBody(SaveShippingStorePackageSchema)],
    },
    {
      method: ["POST"],
      matcher: "/admin/shipping-return-requests/:id",
      middlewares: [validateAndTransformBody(ResolveShippingReturnRequestSchema)],
    },
    {
      method: ["POST"],
      matcher: "/admin/store-pickup",
      middlewares: [validateAndTransformBody(SaveStorePickupSettingsSchema)],
    },
    {
      method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
      matcher: "/store/carts*",
      middlewares: [cartRateLimit],
    },
    {
      method: ["GET"],
      matcher: "/store/catalog/search",
      middlewares: [validateAndTransformQuery(GetCatalogSearchSchema, {})],
    },
    {
      method: ["GET"],
      matcher: "/store/catalog/categories/:handle/products",
      middlewares: [validateAndTransformQuery(GetCategoryProductsSchema, {})],
    },
    {
      method: ["GET"],
      matcher: "/store/catalog/shipping/options",
      middlewares: [validateAndTransformQuery(GetShippingOptionsSchema, {})],
    },
    {
      method: ["GET"],
      matcher: "/store/catalog/shipping/tariffs",
      middlewares: [validateAndTransformQuery(GetShippingTariffsSchema, {})],
    },
    {
      method: ["GET"],
      matcher: "/store/catalog/shipping/points",
      middlewares: [validateAndTransformQuery(GetPickupPointsSchema, {})],
    },
    {
      method: ["POST"],
      matcher: "/store/catalog/shipping/address",
      middlewares: [validateAndTransformBody(SyncCatalogShippingAddressSchema)],
    },
    {
      method: ["POST"],
      matcher: "/store/catalog/shipping/select",
      middlewares: [validateAndTransformBody(SelectCatalogShippingOptionSchema)],
    },
    {
      method: ["POST"],
      matcher: "/store/catalog/cart/validate",
      middlewares: [validateAndTransformBody(ValidateCatalogCartSchema)],
    },
    {
      method: ["GET"],
      matcher: "/store/catalog/cart",
      middlewares: [validateAndTransformQuery(GetCatalogCartSchema, {})],
    },
    {
      method: ["PUT"],
      matcher: "/store/catalog/cart",
      middlewares: [validateAndTransformBody(UpdateCatalogCartSchema)],
    },
    {
      method: ["POST"],
      matcher: "/store/catalog/payment/initiate",
      middlewares: [
        authenticate("customer", ["session", "bearer"], {
          allowUnauthenticated: true,
        }),
        validateAndTransformBody(InitiateCatalogPaymentSchema),
      ],
    },
    {
      method: ["POST"],
      matcher: "/cms/targets/validate",
      middlewares: [validateAndTransformBody(CmsTargetsValidateSchema)],
    },
    {
      method: ["POST"],
      matcher: "/store/catalog/payment/status",
      middlewares: [
        validateAndTransformBody(CheckCatalogPaymentStatusSchema),
      ],
    },
    {
      method: ["POST"],
      matcher: "/store/catalog/checkout",
      middlewares: [
        authenticate("customer", ["session", "bearer"], {
          allowUnauthenticated: true,
        }),
        validateAndTransformBody(CheckoutCatalogOrderSchema),
      ],
    },
    {
      method: ["GET"],
      matcher: "/store/account/orders*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      method: ["POST"],
      matcher: "/store/account/orders/:id/cancel",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      method: ["POST"],
      matcher: "/store/account/orders/:id/return",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      method: ["POST"],
      matcher: "/store/account/password",
      middlewares: [
        authenticate("customer", ["session", "bearer"]),
        validateAndTransformBody(ChangeAccountPasswordSchema),
      ],
    },
    {
      method: ["GET", "POST", "DELETE"],
      matcher: "/store/account/telegram",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      method: ["POST"],
      matcher: "/store/carts/:id/merge-into-customer",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    // Пока идёт оплата, состав корзины уже передан платёжной системе и
    // остатки зарезервированы — менять его нельзя. Блокировка кнопок на
    // витрине это лишь показывает; отказ даёт сервер.
    {
      method: ["POST", "DELETE"],
      matcher: "/store/carts/:id/line-items*",
      middlewares: [rejectFrozenCart(cartIdFromParams)],
    },
    {
      method: ["POST"],
      matcher: "/store/carts/:id/promotions",
      middlewares: [rejectFrozenCart(cartIdFromParams)],
    },
    {
      method: ["POST"],
      matcher: "/store/catalog/checkout",
      middlewares: [rejectFrozenCart(cartIdFromBody)],
    },
    {
      method: ["POST"],
      matcher: "/store/unsubscribe/abandoned-cart",
      middlewares: [validateAndTransformBody(UnsubscribeAbandonedCartSchema)],
    },
    {
      method: ["GET", "DELETE"],
      matcher: "/store/account/wishlist*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      method: ["POST"],
      matcher: "/store/account/wishlist",
      middlewares: [
        authenticate("customer", ["session", "bearer"]),
        validateAndTransformBody(AddWishlistItemSchema),
      ],
    },
    {
      method: ["POST"],
      matcher: "/auth/customer/emailpass/register",
      middlewares: [validateAndTransformBody(RegisterEmailPasswordSchema)],
    },
  ],
})
