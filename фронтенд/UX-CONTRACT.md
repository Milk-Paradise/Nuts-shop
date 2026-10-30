# Interaction contract

Visual contract: DESIGN.md. Language ru-RU, currency RUB, local browser time for theme.

| Capability | Canonical owner                        | Behavior                                                                |
| ---------- | -------------------------------------- | ----------------------------------------------------------------------- |
| Forms      | shared/ui Input; entities/order schema | noValidate, inline field errors, focus first error                      |
| Select     | native select                          | OS popup for price sorting                                              |
| Overlay    | shared/ui Modal                        | native dialog, modal focus, Escape, restore opener                      |
| Scrollbars | app/styles/globals.css                 | visible, token-based, stable layout                                     |
| Feedback   | shared/ui Notice + local live region   | inline status persists, no browser alerts                               |
| Cart       | entities/cart                          | variant-specific keys; quantities 1–99, removal reversible by re-adding |
| Catalog    | pages/catalog                          | GET URL filters preserve search/category/sort; explicit pagination      |
| Order      | features/submit-order + app/api/order  | validate both sides, server reprices, success only after Telegram ok    |

Cart and favorite/comparison state hydrate from localStorage after mount, with
empty identical server/client initial snapshots. Storage failures do not break UI.
No automatic retry of sendMessage, no automatic retry after ambiguous delivery.
Persist unresolved attempt key/status across checkout navigation and reload without
customer details. Reopening checkout blocks resubmission until the customer has
confirmed with the manager that no order arrived. Lock cart mutations while sending.
No online payment. No claim of order durability until Telegram accepts it.
Missing bot config returns 503; order and form stay intact. Real catalog fetch
failure uses error boundary; USE_MOCK explicitly chooses demo data.
