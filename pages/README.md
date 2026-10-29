# FSD pages are not Next.js Pages Router

This intentionally route-free root directory prevents Next.js from treating
`src/pages` (the FSD composition layer) as Pages Router routes. All real routing
uses root `app` thin reexports into `src/app` with App Router (Next requires the
framework app/pages directories at the same level). Do not add Pages Router
entrypoints here. No business logic belongs in the root routing bridges.
