FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS builder
ARG CATALOG_IMAGE_HOST=nutsstore.termitsdigital.ru
ENV NEXT_TELEMETRY_DISABLED=1 USE_MOCK=true CATALOG_IMAGE_HOST=$CATALOG_IMAGE_HOST
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY scripts/start-container.cjs ./start-container.cjs
EXPOSE 3000
CMD ["node", "start-container.cjs"]
