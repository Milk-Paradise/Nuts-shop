# Ozon Delivery integration

This backend integrates Ozon Delivery directly as a Medusa fulfillment
provider. CDEK and the
store-owned pickup option remain independent providers.

## Official contract

The source of truth for the external contract is the official Ozon Delivery
API documentation:

- [Ozon Delivery API](https://docs.ozon.ru/api/ozon-delivery/)

The application uses direct client credentials (`client_id` and
`client_secret`). Credentials are encrypted by the shipping-provider registry
with `SECRET_ENCRYPTION_KEY` and are never returned by the
admin configuration response or written to pickup-point data.

## Base URL is always explicit

`OZON_API_BASE_URL` has no built-in default and must be set explicitly in
every environment; the backend throws on startup of the Ozon flow if it is
missing. Ozon does not provide a public sandbox for this API (Seller API
scope `Seller-api.ozon-logistics`), so local/CI/QA environments still need
either an Ozon-issued test contract or an owner-approved HTTP stub:

```dotenv
OZON_API_BASE_URL=http://127.0.0.1:<ozon-test-stub-port>
SECRET_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
```

Production uses the real Ozon host and real client credentials (owner
decision, AIL-546): `OZON_API_BASE_URL=https://api-seller.ozon.ru`. Known gap
at the time of this rollout: AIL-144 (order fulfillment status ignores Ozon
shipments) was not fixed before enabling the production host — Ozon orders
are created for real, but their status in the order may be wrong until
AIL-144 is resolved.

The client credentials are supplied through the authenticated admin
configuration flow or a test fixture. They must not be committed to `.env`
files, source code, test snapshots, logs, or API responses.

## Safe enablement sequence

1. Verify that `OZON_API_BASE_URL` for this environment points where you
   intend — the real Ozon host for production, an approved test contract or
   stub for local/CI/QA.
2. Configure the provider through the authenticated admin endpoint
   `POST /admin/shipping-providers/ozon`. The workflow first tests
   authorization, then stores encrypted credentials and enables visibility.
3. Set the sender city and postal code. Add package dimensions/weight when
   the test contract requires them.
4. Synchronize Ozon pickup points. The registry stores normalized point data
   only; credentials are not copied into it.
5. Verify the catalog shipping options endpoint and select a courier or pickup
   tariff in a test checkout.
6. Keep the provider disabled until the smoke checks pass. A checkout test
   must mock tariff/fulfillment calls or use the approved test stub and must
   never create a real external shipment.

## Runtime behavior and safety rules

- Ozon options are exposed only when the Ozon provider visibility is enabled.
- A selected Ozon tariff is stored as provider-neutral checkout state plus
  Ozon-specific `ozonData`; pickup point IDs are namespaced by `ozon_ozon`.
- Fulfillment creation uses an idempotency key derived from the order and
  selected shipping method. Repeating the operation must not create a second
  external shipment.
- A timeout or ambiguous external response is an error, not a successful
  fulfillment. Retry through the admin Ozon fulfillment retry endpoint after
  confirming the external state.
- External API errors are normalized before they reach the API response; do
  not include credentials or authorization headers in error messages.
- Ozon webhook requests require the configured signature and are idempotent by
  event ID. Unknown statuses are recorded/ignored rather than treated as
  delivered.

## Verification checklist

- Ozon checkout smoke passes without a real Ozon request.
- CDEK shipping lifecycle regression passes.
- Store pickup regression passes.
- Ozon registry fixture confirms encrypted credentials and secret-free point
  records.
- `npm run build` passes with no TypeScript/build errors.
