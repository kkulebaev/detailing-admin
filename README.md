# detailing-admin

## Что это

Админка детейлинг-мастерской «Dazzle Detailing», рассчитанная в первую очередь на телефон.

Главный сценарий — форма записи клиента: одна отправка формы → одна строка в Google Sheets (лист `Запись 2026`). Для новых записей Sheets остаётся источником истины. Параллельно запись best-effort дублируется в Postgres, и вокруг этой базы построена остальная админка:

| Раздел | Кто видит | Что умеет |
|--------|-----------|-----------|
| Запись клиента (`/`) | admin | Форма записи: подстановка клиента и его машин по телефону, услуги из прайса с расчётом суммы по классу кузова, несколько мастеров, уведомление мастеру в Telegram |
| Записи (`/bookings`) | admin, employee | Список с фильтрами и поиском, редактирование, удаление, статус готовности, экспорт в CSV. Сотрудник не видит суммы |
| Клиенты (`/clients`) | admin | Справочник клиентов и их машин, карточка с историей визитов, экспорт в CSV |
| Прайс-лист (`/pricelist`) | admin | Разделы и услуги, цены по четырём классам кузова |
| Мастера (`/masters`) | admin | Список, порядок, Telegram ID, признаки «может быть ответственным» и «получает зарплату» |
| Зарплаты (`/salaries`) | admin | Почасовые ставки, отработанные часы, премии и вычеты |
| Аналитика (`/analytics`) | admin | Выручка, динамика, удержание клиентов, топ клиентов |
| Мои часы (`/employee`) | employee | Свои часы, ставка, премии и вычеты, итог за месяц. Добавление и правка своих часов за последние 7 дней. Аккаунт привязывает к мастеру администратор в разделе «Мастера» |

Вход по логину и паролю, роли `admin` и `employee`. Регистрации нет — аккаунты заводятся через CLI.

> Правки, удаление и смена статуса записи в приложении меняют только Postgres — в Sheets они не попадают. Это известное расхождение до переезда записей из Sheets в базу.

---

## Стек

| Слой | Технология |
|------|-----------|
| Frontend | Vue 3, Vite, Pinia, vue-router, shadcn-vue, Tailwind CSS v4, vee-validate |
| API-клиент | orval — генерируется из OpenAPI-документа бэкенда |
| Backend | Hono + `@hono/zod-openapi`, `@hono/node-server`, Node 24 |
| Validation | Zod — общие схемы в `packages/shared` |
| Записи | Google Sheets API v4 (service account) — источник истины |
| База | Postgres + Drizzle ORM (`drizzle-orm`, `postgres`, `drizzle-kit`) |
| Авторизация | JWT (HS256) в httpOnly-cookie, пароли на scrypt |
| Уведомления | Telegram Bot API |
| Deploy | Railway (`detailing-api`, `detailing-web`, Postgres) |

---

## Структура

```
detailing-admin/
├── apps/
│   ├── api/                   # Hono backend
│   │   ├── src/
│   │   │   ├── routes/        # auth, bookings, clients, pricelist, masters, salaries, analytics, healthz
│   │   │   ├── db/            # Drizzle-схема и запросы
│   │   │   └── auth/          # JWT, cookie, middleware, пароли
│   │   ├── drizzle/           # SQL-миграции (drizzle-kit generate)
│   │   ├── scripts/           # сиды, бэкфиллы, user:create, gen:openapi, db:sync-prod
│   │   ├── AUTH.md            # runbook по авторизации
│   │   ├── Dockerfile
│   │   ├── railway.json
│   │   └── .env.example
│   └── web/                   # Vue 3 + Vite frontend
│       ├── src/
│       │   ├── components/    # страницы и диалоги; ui/ — shadcn-vue
│       │   ├── pages/         # логин, профиль, главная сотрудника
│       │   └── lib/generated/ # orval-клиент (не править руками)
│       ├── openapi.json       # OpenAPI-документ API, из него генерируется клиент
│       ├── Dockerfile
│       ├── railway.json
│       └── .env.example
├── packages/
│   └── shared/                # Zod-схемы, enums, хелперы (телефон, даты, CSV, строка Sheets)
├── docker-compose.yml         # локальный Postgres
├── lefthook.yml               # pre-commit: lint + typecheck + test
├── TODO.md                    # бэклог фич
└── pnpm-workspace.yaml
```

---

## Локальный запуск

**Требования:** Node 24+, pnpm 11+, Docker.

```bash
# 1. Установить зависимости
pnpm install

# 2. Поднять локальный Postgres (порт 5432, БД detailing, пользователь detailing/detailing)
docker compose up -d postgres

# 3. Создать .env для API
cp apps/api/.env.example apps/api/.env
# Заполнить обязательные переменные (см. таблицу ниже).
# DATABASE_URL уже указывает на локальный compose-инстанс.

# 4. Запустить оба сервиса параллельно
pnpm dev
# web → http://localhost:5173
# api → http://localhost:3000
# Миграции применяются на старте API автоматически (см. apps/api/src/boot.ts).

# 5. Создать первого пользователя (пароль вводится интерактивно)
pnpm --filter @detailing-admin/api user:create --login admin --role admin
```

Обязательные переменные `apps/api/.env` — без них API не стартует:

| Переменная | Откуда взять |
|-----------|--------------|
| `GOOGLE_SERVICE_ACCOUNT_JSON_B64` | см. «Setup GCP Service Account» ниже |
| `TELEGRAM_BOT_TOKEN` | токен бота от @BotFather |
| `JWT_SECRET` | не короче 32 символов: `openssl rand -base64 48` |

`.env.local` для web не нужен: dev-сервер Vite проксирует `/api` на `localhost:3000`. Чтобы направить локальный фронт на удалённый API, задайте `VITE_API_PROXY_TARGET` в `apps/web/.env.local`.

Открыть `http://localhost:5173` в браузере. Для мобильного вьюпорта: DevTools → Toggle device toolbar (Ctrl+Shift+M / Cmd+Shift+M).

### DB-команды

```bash
# Сгенерировать новую миграцию после правок apps/api/src/db/schema.ts
pnpm --filter @detailing-admin/api db:generate

# Применить миграции к БД из DATABASE_URL (вне runtime-инициализации)
pnpm --filter @detailing-admin/api db:migrate

# Drizzle Studio — браузерный просмотр содержимого
pnpm --filter @detailing-admin/api db:studio

# Скопировать прод-базу в локальную (локальная БД будет стёрта).
# Нужен PROD_DATABASE_URL в apps/api/.env.prod — шаблон в .env.prod.example
pnpm --filter @detailing-admin/api db:sync-prod

# Тестовые записи для локальной разработки
pnpm --filter @detailing-admin/api seed:bookings-dev
```

### Изменение API

После правки роута или схемы запроса/ответа нужно перегенерировать OpenAPI-документ и клиент:

```bash
pnpm --filter @detailing-admin/api gen:openapi
pnpm --filter @detailing-admin/web gen:client
```

Устаревший `apps/web/openapi.json` ловит тест `openapi-drift.test.ts`.

---

## Setup GCP Service Account

Выполнить один раз перед первым запуском или деплоем.

1. Перейти в [Google Cloud Console](https://console.cloud.google.com) → создать проект (или выбрать существующий).

2. **APIs & Services → Library** → найти **Google Sheets API** → **Enable**.

3. **IAM & Admin → Service Accounts → Create Service Account**.  
   Имя: `detailing-admin`. Роли на уровне проекта не нужны — нажать «Done».

4. Открыть созданный аккаунт → вкладка **Keys → Add Key → Create new key → JSON** → скачать файл (`service-account.json`).

5. Открыть таблицу [`1VmOCwNpADAHmRBC28Z_DtjWF50zlMVvQ4o5Lz6To8Lw`](https://docs.google.com/spreadsheets/d/1VmOCwNpADAHmRBC28Z_DtjWF50zlMVvQ4o5Lz6To8Lw) → **Share** → добавить email сервисного аккаунта (`…@….gserviceaccount.com`) с правами **Editor**.

6. **Проверить локаль листа.**  
   В Google Sheets: **Файл → Настройки → Региональные настройки → Россия**.  
   Без русской локали строки вида `04.06.2026` не будут распознаны как даты в режиме `USER_ENTERED`, и колонка A будет хранить текст вместо date-ячейки.

7. Закодировать ключ в base64 (одна строка, без переносов):
   ```bash
   base64 -w0 service-account.json > sa.b64
   cat sa.b64
   ```

8. Вставить в `apps/api/.env`:
   ```
   GOOGLE_SERVICE_ACCOUNT_JSON_B64=<содержимое sa.b64>
   ```
   > Значение вставляется **без внешних кавычек** — Railway (и стандартный `.env`) не стрипают их автоматически.

---

## Deploy на Railway

### Подготовка

- Создать аккаунт на [railway.app](https://railway.app), подключить репозиторий.
- Создать один **проект** и внутри него три ресурса: сервисы `detailing-api`, `detailing-web` и **Postgres** (New → Database → PostgreSQL).
- В сервисе `detailing-api` в **Settings → Variables** связать переменную `DATABASE_URL` с Postgres через **+ New Variable Reference → Postgres.DATABASE_URL**. Это даст приватный URL внутри проекта и переживёт перезапуск БД.

Браузер ходит только в `detailing-web`: web-контейнер (`vite preview`) сам проксирует `/api` в `detailing-api` по внутренней сети Railway. Так auth-cookie остаётся first-party (`SameSite=Lax`).

---

### detailing-api

1. **Source:** корень репозитория.  
   В настройках сервиса: **Root Directory** = `/`, **Watch Paths** = `apps/api/**,packages/shared/**`.  
   Railway подхватит `apps/api/railway.json` автоматически.

2. **Переменные окружения** (Settings → Variables):

   | Переменная | Значение |
   |-----------|---------|
   | `SPREADSHEET_ID` | `1VmOCwNpADAHmRBC28Z_DtjWF50zlMVvQ4o5Lz6To8Lw` |
   | `SHEET_NAME` | `Запись 2026` |
   | `GOOGLE_SERVICE_ACCOUNT_JSON_B64` | base64-строка из шага 7 выше |
   | `DATABASE_URL` | reference на Postgres (см. «Подготовка» выше) |
   | `TELEGRAM_BOT_TOKEN` | токен бота от @BotFather |
   | `JWT_SECRET` | не короче 32 символов: `openssl rand -base64 48` |
   | `AUTH_COOKIE_SECURE` | `true` |
   | `WEB_ORIGIN` | `https://<detailing-web>.up.railway.app` |
   | `LOG_LEVEL` | `info` |

   Остальные `AUTH_*` (время жизни сессии, SameSite) описаны в `apps/api/AUTH.md`.

   > **КРИТИЧНО:** `GOOGLE_SERVICE_ACCOUNT_JSON_B64` вставляется **без внешних кавычек**.  
   > Railway их не срезает — ведущая `"` приведёт к ошибке `JSON.parse` на старте с невнятным сообщением. Значение должно начинаться прямо с `eyJ…` (начало base64-encoded JSON).

3. Создать первого администратора — на свежей базе пользователей нет, войти будет невозможно:
   ```bash
   railway run pnpm --filter @detailing-admin/api user:create --login <admin> --role admin
   ```

---

### detailing-web

1. **Source:** корень репозитория.  
   Railway подхватит `apps/web/railway.json` (сборка через `apps/web/Dockerfile`).

2. **Переменные окружения** (Settings → Variables):

   | Переменная | Значение |
   |-----------|---------|
   | `VITE_API_PROXY_TARGET` | внутренний URL API, например `http://detailing-admin-api.railway.internal:<PORT>` |

   > Без `VITE_API_PROXY_TARGET` контейнер намеренно падает на старте — иначе каждый запрос к `/api` отдавал бы 502.  
   > `VITE_API_BASE_URL` в проде **не задавать**: запросы на чужой origin делают cookie third-party, и браузеры её отбрасывают.

3. Выдать публичный домен: **Settings → Networking → Generate Domain**.

4. Обновить `WEB_ORIGIN` в `detailing-api` на реальный URL `detailing-web` и передеплоить API.

---

### Проверка деплоя

```bash
# API healthcheck (по внутреннему или публичному адресу API)
curl https://<detailing-api>/healthz
# Ожидаемый ответ: {"ok":true,"time":"..."}
# 503 значит, что API жив, но не прошёл проверку на старте
# (заголовки листа или доступ к Sheets) — причина в логе boot.*

# Web
# Открыть https://<detailing-web>.up.railway.app — должна открыться страница входа
```

---

## Тесты

```bash
pnpm test        # vitest во всех пакетах (Sheets и Telegram замоканы)
pnpm typecheck   # tsc / vue-tsc -b --noEmit во всех пакетах
pnpm lint        # eslint
pnpm build       # tsup (api) + vue-tsc + vite build (web)
```

Те же `lint`, `typecheck` и `test` запускаются lefthook'ом перед каждым коммитом, в котором есть `.ts`/`.vue`. CI в репозитории нет.

---

## Что пока не сделано

- Переезд записей из Sheets в Postgres (сейчас источник истины — Sheets, а правки из приложения в Sheets не попадают)
- Напоминание клиенту о визите — см. `TODO.md`
- Кросс-инстанс дедупликация (Redis-backed idempotency) — пока API работает в одном экземпляре
- PWA-манифест, офлайн-режим, service worker
- Мультилетняя поддержка (сейчас только `Запись 2026`)
- E2E-тесты (Playwright/Cypress)
- Загрузка фотографий (до/после)
- Международные номера телефонов (только `+7`)
- Журнал изменений («кто именно редактировал»)
