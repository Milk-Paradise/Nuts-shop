# Nuts Store

Основной Git: https://github.com/Milk-Paradise/Nuts-shop

- `фронтенд/` — Next.js, исходник Milk-Paradise/Nuts-shop.
- `бекенд/` — Medusa, исходник https://gitlab.termitsdigital.ru/termits/catalog-backend.
- `compose.yaml` — PostgreSQL, Redis, Meilisearch, Medusa, Next.js и nginx.

Публичный сайт: https://nutsstore.termitsdigital.ru
Админка: https://nutsstore.termitsdigital.ru/app

В Dokploy создаётся отдельный Compose-проект из ветки `main`, файл `compose.yaml`.
Домен направляется на сервис `proxy`, порт 80, HTTPS Let's Encrypt.
Пароли задаются через Environment Dokploy; в Git их нет.

Обязательные переменные: POSTGRES_PASSWORD, MEILI_MASTER_KEY, JWT_SECRET,
COOKIE_SECRET, SECRET_ENCRYPTION_KEY (32 случайных байта в base64),
AUTH_MFA_ENCRYPTION_KEY, ADMIN_EMAIL, ADMIN_PASSWORD.

Бэкенд при старте применяет миграции, создаёт администратора и настройки
витрины. Настройки каталога передаются фронтенду через отдельный volume.
Товары, остатки и цены хранятся в PostgreSQL, картинки — в volume uploads.
При обновлении нельзя удалять volumes: это удалит данные магазина.

Оформление заявки в текущем фронтенде использует Telegram. Для его включения
нужно отдельно задать TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID у frontend.
