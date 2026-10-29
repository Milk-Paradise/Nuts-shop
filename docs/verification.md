# Verification evidence

2026-10-29, local Windows/Node.js 22.15.0.

- Production build: successful (Next.js 16.4.3, webpack); routes for home, catalog,
  product, checkout, favorites, compare, info, API order and 404.
- Strict TypeScript: checked with tsc.
- FSD script: downward imports/public APIs; no forbidden cross-slice dependencies.
- 23 unit/integration tests across 5 files: cart request isolation, variants/quantities, favorite isolation,
  lock while sending, order schema/stock/server price, HTML escape, catalog filters,
  circadian boundaries, POST configuration/origin/unknown variant/idempotency/timeout,
  persistent unresolved-attempt guard.
- Browser: home rendering, persisted cart, quantity 1→2 and total 69,990→139,980,
  checkout navigation, required-field errors with first-field focus, missing
  Telegram 503 retains form/cart, product memory selection recalculates price,
  favorite/compare actions, mobile layout at 390px.
- Independent review: two important findings (uncertain delivery guard lost on
  navigation; pending cart edits discarded). Both addressed with persistence,
  an explicit reconciliation UI, a store mutation lock and regression tests.

Real backend DTO and Telegram delivery cannot be verified until deployed catalog
access and bot/chat settings are supplied. All notification transport tests use
local mocked fetch and send no real messages. No online payments are implemented.

## Nuts Store / MacBook revision

- 25 tests pass, including Apple-only mock and live-response filtering.
- Store phone links and crossed-out prices removed; the existing email remains.
- Compact MacBook section replaces the prior editorial banner. Local WebM playback
  verified in browser: 640×330, 2.345s, readyState=4, pause and resume work.
- Mobile at 390px: section width 340px, height ~463px, no page horizontal overflow.
- Supplied Cloudinary source returns 401 (disabled cloud); prepared the stable
  scene from the reference's available preview, excluding the original page text.


## Footer and Telegram settings revision

- Scene moved into shared Footer; no duplicate home widget or same-layer imports.
- TypeScript and FSD checker pass in the current sandbox.
- Test startup blocked by native rolldown binding loading in this environment; no current test-pass claim.
- Telegram credentials saved only in ignored .env.local. Read-only getMe/getChat checks blocked by network EACCES; no messages were sent and no delivery confirmed.
- Photographs remain local assets; product data remains USE_MOCK=true.
