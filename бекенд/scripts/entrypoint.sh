#!/bin/sh
# Самонастройка бэкенда при старте контейнера.
#
# Раньше это были два одноразовых сервиса docker-compose (`migrate` и
# `backend-init`), а порядок обеспечивал `depends_on`. В раскладке, где каждый
# сервис — отдельное приложение Dokploy, одноразовых сервисов и порядка между
# ними нет, поэтому шаги переехали сюда. Оба обязаны переживать повторный
# запуск: контейнер пересоздаётся на каждой выкатке.
#
# Схему бэкенд не мигрирует сам (`npm run start` идёт без auto-migrate), поэтому
# без этого шага на свежей базе каждый module loader падает на
# «relation ... does not exist».
set -eu

log() {
  printf '[entrypoint] %s\n' "$*"
}

fail() {
  printf '[entrypoint] ERROR: %s\n' "$*" >&2
  exit 1
}

# База может быть ещё не готова: приложения окружения поднимаются без гарантии
# порядка. Ждём не «доступности порта», а успешной миграции — это та же
# проверка, что и польза от неё.
INIT_MAX_ATTEMPTS="${INIT_MAX_ATTEMPTS:-30}"
INIT_RETRY_SECONDS="${INIT_RETRY_SECONDS:-5}"

case "$INIT_MAX_ATTEMPTS" in ''|*[!0-9]*) fail "INIT_MAX_ATTEMPTS must be a number" ;; esac
case "$INIT_RETRY_SECONDS" in ''|*[!0-9]*) fail "INIT_RETRY_SECONDS must be a number" ;; esac

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set"

migrate() {
  attempt=1
  while [ "$attempt" -le "$INIT_MAX_ATTEMPTS" ]; do
    log "migrations: attempt ${attempt}/${INIT_MAX_ATTEMPTS}"
    if npx medusa db:migrate; then
      log "migrations applied"
      return 0
    fi
    if [ "$attempt" -lt "$INIT_MAX_ATTEMPTS" ]; then
      sleep "$INIT_RETRY_SECONDS"
    fi
    attempt=$((attempt + 1))
  done
  fail "migrations did not succeed after ${INIT_MAX_ATTEMPTS} attempts"
}

# `medusa user` на существующем администраторе завершается ошибкой с «already
# exists». Это штатный повторный запуск, а не сбой; любая другая ошибка сбоем
# остаётся.
ensure_admin() {
  if [ -z "${ADMIN_EMAIL:-}" ] || [ -z "${ADMIN_PASSWORD:-}" ]; then
    log "admin credentials are not set; skipping administrator creation"
    return 0
  fi
  log "administrator: ${ADMIN_EMAIL}"
  admin_log="$(mktemp)"
  if npx medusa user -e "$ADMIN_EMAIL" -p "$ADMIN_PASSWORD" > "$admin_log" 2>&1; then
    cat "$admin_log"
    rm -f "$admin_log"
    log "administrator ready"
    return 0
  fi
  cat "$admin_log"
  if grep -q "already exists" "$admin_log"; then
    rm -f "$admin_log"
    log "administrator already initialized"
    return 0
  fi
  rm -f "$admin_log"
  fail "administrator creation failed"
}

migrate
ensure_admin

if [ "${NUTS_BOOTSTRAP:-false}" = "true" ]; then
  log "initializing Nuts Store storefront settings"
  npx medusa exec ./src/scripts/local-bootstrap.js
fi

log "starting the application"
exec "$@"
