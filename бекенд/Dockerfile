FROM node:22-alpine AS deps
WORKDIR /app

ARG TARGETARCH
ARG NPM_CACHE_LOCK_HASH

COPY package.json package-lock.json .npmrc ./
COPY patches ./patches
RUN --mount=type=cache,id=npm-node22-${TARGETARCH}-${NPM_CACHE_LOCK_HASH},target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund

FROM deps AS builder
ENV NODE_OPTIONS=--max-old-space-size=1536

COPY . .
RUN npm run build && node scripts/build-runtime-scripts.cjs

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

ARG TARGETARCH
ARG NPM_CACHE_LOCK_HASH

COPY --from=builder /app/.medusa/server/package*.json ./
COPY --from=builder /app/.npmrc ./
COPY patches ./patches
RUN --mount=type=cache,id=npm-node22-${TARGETARCH}-${NPM_CACHE_LOCK_HASH},target=/root/.npm \
    npm install --omit=dev --ignore-scripts --prefer-offline --audit=false --fund=false --loglevel=warn && \
    npm install --prefix /opt/patch-package --no-save --no-package-lock --ignore-scripts patch-package@8.0.1 && \
    /opt/patch-package/node_modules/.bin/patch-package

COPY --from=builder /app/.medusa/server ./
COPY scripts/schema-guard.js ./schema-guard.js
COPY scripts/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 9000
# Точка входа сама применяет миграции и создаёт администратора: в раскладке
# «один сервис — одно приложение Dokploy» одноразовых сервисов и порядка между
# ними нет, а на свежей базе без миграций backend не поднимается вовсе.
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["sh", "-c", "node ./schema-guard.js && npm run start"]
