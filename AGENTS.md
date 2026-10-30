# Nuts Store project

The authoritative repository for both applications is:
https://github.com/Milk-Paradise/Nuts-shop.git (branch `main`).

- Frontend: `фронтенд/`, Next.js. Follow its nested AGENTS.md.
- Backend: `бекенд/`, Medusa. Imported from termits/catalog-backend.
- Production: https://nutsstore.termitsdigital.ru
- Admin: https://nutsstore.termitsdigital.ru/app
- Hosting: https://docker.termitsdigital.ru, project Nuts Store, production,
  Compose application `nutsstore-cqsjzl`.
- Deployment configuration: `compose.yaml`, `deploy/`, `DEPLOYMENT.md`.
- Local startup from this directory: `npm run dev`.

`.local/` contains local databases, original repository metadata backups,
deployment session data and credentials. It is excluded from Git; never add
its contents or environment secrets to commits. Production settings and
secrets are managed in Dokploy Environment. Preserve production volumes.
