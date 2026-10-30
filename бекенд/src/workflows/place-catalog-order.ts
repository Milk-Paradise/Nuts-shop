import {
  acquireLockStep,
  addShippingMethodToCartWorkflow,
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  refreshPaymentCollectionForCartWorkflow,
  releaseLockStep,
  transferCartCustomerWorkflow,
  updateCartWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

import type { CheckoutCatalogOrderBody } from "../api/catalog/validators";
import {
  claimCatalogOrderFixationStep,
  completeCatalogOrderFixationStep,
  prepareCatalogOrderFixationStep,
} from "./steps/catalog-order-fixation";
import {
  checkCatalogCheckoutShippingProviderVisibilityStep,
  prepareCatalogCheckoutCartUpdateStep,
  prepareCatalogCheckoutShippingOptionsStep,
  retrieveCatalogCartPaymentCollectionStep,
  resolveCatalogPaymentCollectionIdStep,
  validateCatalogCheckoutCartStep,
} from "./steps/catalog-checkout";

const SYSTEM_PAYMENT_PROVIDER_ID = "pp_system_default";

export type PlaceCatalogOrderWorkflowOutput = {
  order_id: string;
};

export type PlaceCatalogOrderWorkflowInput = CheckoutCatalogOrderBody & {
  customer_id?: string | null;
};

const placeNewCatalogOrderWorkflow = createWorkflow(
  "place-new-catalog-order",
  function (input: PlaceCatalogOrderWorkflowInput) {
    const cartValidation = validateCatalogCheckoutCartStep({
      cart_id: input.cart_id,
    });
    const shippingProviderVisibilityCheck =
      checkCatalogCheckoutShippingProviderVisibilityStep({
        cart_id: input.cart_id,
      });
    const validatedInput = transform(
      { input, cartValidation, shippingProviderVisibilityCheck },
      ({ input }) => input,
    );
    const claimedFixation = claimCatalogOrderFixationStep(input);
    const transferredCustomerCart = when(
      "catalog-checkout-transfer-customer",
      { validatedInput },
      ({ validatedInput }) => !!validatedInput.customer_id,
    ).then(() => {
      const transferInput = transform(
        { validatedInput },
        ({ validatedInput }) => ({
          id: validatedInput.cart_id,
          customer_id: validatedInput.customer_id as string,
        }),
      );

      return transferCartCustomerWorkflow.runAsStep({
        input: transferInput,
      });
    });
    const checkoutInputAfterCustomerTransfer = transform(
      { validatedInput, transferredCustomerCart },
      ({ validatedInput }) => validatedInput,
    );
    const cartUpdateInput = prepareCatalogCheckoutCartUpdateStep(
      checkoutInputAfterCustomerTransfer,
    );

    const cartUpdated = updateCartWorkflow.runAsStep({
      input: cartUpdateInput,
    });

    const shippingPreparationInput = transform(
      { input, cartUpdated },
      ({ input }) => ({
        cart_id: input.cart_id,
      }),
    );
    const shippingOptions = prepareCatalogCheckoutShippingOptionsStep(
      shippingPreparationInput,
    );

    const shippingMethodsAdded = when(
      "catalog-checkout-add-shipping-methods",
      { shippingOptions },
      ({ shippingOptions }) => shippingOptions.options.length > 0,
    ).then(() => {
      const addShippingMethodInput = transform(
        { input, shippingOptions },
        ({ input, shippingOptions }) => ({
          cart_id: input.cart_id,
          options: shippingOptions.options,
        }),
      );

      return addShippingMethodToCartWorkflow.runAsStep({
        input: addShippingMethodInput,
      });
    });

    const paymentCollectionLookupInput = transform(
      { input, shippingMethodsAdded },
      ({ input }) => ({
        cart_id: input.cart_id,
      }),
    );
    const existingPaymentCollection = retrieveCatalogCartPaymentCollectionStep(
      paymentCollectionLookupInput,
    );

    const createdPaymentCollection = when(
      "catalog-checkout-create-payment-collection",
      { existingPaymentCollection },
      ({ existingPaymentCollection }) => existingPaymentCollection.id === null,
    ).then(() => {
      const paymentCollectionInput = transform({ input }, ({ input }) => ({
        cart_id: input.cart_id,
      }));

      return createPaymentCollectionForCartWorkflow.runAsStep({
        input: paymentCollectionInput,
      });
    });

    const paymentCollectionId = resolveCatalogPaymentCollectionIdStep({
      existing_payment_collection: existingPaymentCollection,
      created_payment_collection: createdPaymentCollection,
    });

    const refreshedPaymentCollection =
      refreshPaymentCollectionForCartWorkflow.runAsStep({
        input: transform({ input, paymentCollectionId }, ({ input }) => ({
          cart_id: input.cart_id,
        })),
      });

    const paymentSession = createPaymentSessionsWorkflow.runAsStep({
      input: transform(
        { paymentCollectionId, refreshedPaymentCollection },
        ({ paymentCollectionId }) => ({
          payment_collection_id: paymentCollectionId,
          provider_id: SYSTEM_PAYMENT_PROVIDER_ID,
          data: {},
        }),
      ),
    });

    const completedCart = completeCartWorkflow.runAsStep({
      input: transform({ input, paymentSession }, ({ input }) => ({
        id: input.cart_id,
      })),
    });

    const linkedOrder = completeCatalogOrderFixationStep(
      transform(
        { claimedFixation, completedCart },
        ({ claimedFixation, completedCart }) => ({
          fixation_id: claimedFixation.fixation_id,
          order_id: completedCart.id,
        }),
      ),
    );

    return new WorkflowResponse(
      transform({ linkedOrder }, ({ linkedOrder }) => ({
        order_id: linkedOrder.order_id,
      })),
    );
  },
);

export const placeCatalogOrderWorkflow = createWorkflow(
  "place-catalog-order",
  function (input: PlaceCatalogOrderWorkflowInput) {
    acquireLockStep({ key: input.cart_id, timeout: 30, ttl: 120 });
    const fixation = prepareCatalogOrderFixationStep(input);
    const existingOrder = when(
      "catalog-checkout-order-already-fixed",
      { fixation },
      ({ fixation }) => !!fixation.order_id,
    ).then(() =>
      transform({ fixation }, ({ fixation }) => ({
        order_id: fixation.order_id as string,
      })),
    );
    const newOrder = when(
      "catalog-checkout-order-needs-fixation",
      { fixation },
      ({ fixation }) => !fixation.order_id,
    ).then(() => placeNewCatalogOrderWorkflow.runAsStep({ input }));

    const output = transform(
      { existingOrder, newOrder },
      ({ existingOrder, newOrder }) => ({
        order_id: (existingOrder?.order_id ?? newOrder?.order_id) as string,
      }),
    );

    releaseLockStep({ key: input.cart_id });

    return new WorkflowResponse(output);
  },
);
