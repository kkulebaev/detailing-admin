# detailing-admin

## Что это

Мобильная форма записи клиентов для детейлинг-мастерской.  
MVP: Vue 3-фронтенд + Hono-бэкенд; одна запись формы → одна строка в Google Sheets.  
Без авторизации, без базы данных — только форма и таблица.

---

## Стек

| Слой | Технология |
|------|-----------|
| Frontend | Vue 3, Vite 6, shadcn-vue, Tailwind CSS v4 |
| Backend | Hono, `@hono/node-server`, Node 22 |
| Validation | Zod (shared schema), vee-validate, `@hono/zod-validator` |
| Storage | Google Sheets API v4 (service account) |
| Shared types | `packages/shared` — pnpm workspace, без отдельного build-шага |
| Deploy | Railway (два сервиса: `detailing-api` и `detailing-web`) |

---

## Структура

```
detailing-admin/
├── apps/
│   ├── api/                   # Hono backend — POST /api/bookings, GET /healthz
│   │   ├── src/
│   │   ├── Dockerfile
│   │   ├── railway.json
│   │   └── .env.example
│   └── web/                   # Vue 3 + Vite frontend
│       ├── src/
│       ├── railway.json
│       └── .env.example
├── packages/
│   └── shared/                # Zod schema, enums, sheet-row helpers
├── .omc/plans/
│   └── mvp-booking-form.md    # Авторитетный архитектурный план
├── package.json               # pnpm workspace root
└── pnpm-workspace.yaml
```

---

## Локальный запуск

**Требования:** Node 22, pnpm 9.

```bash
# 1. Установить зависимости
pnpm install

# 2. Создать .env для API (заполнить GOOGLE_SERVICE_ACCOUNT_JSON_B64 и др.)
cp apps/api/.env.example apps/api/.env

# 3. Создать .env для web
cp apps/web/.env.example apps/web/.env.local
# По умолчанию VITE_API_BASE_URL=http://localhost:3000 — менять не нужно

# 4. Запустить оба сервиса параллельно
pnpm dev
# web → http://localhost:5173
# api → http://localhost:3000
```

Открыть `http://localhost:5173` в браузере. Для мобильного вьюпорта: DevTools → Toggle device toolbar (Ctrl+Shift+M / Cmd+Shift+M).

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
- Создать один **проект** и внутри него два **сервиса**: `detailing-api` и `detailing-web`.

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
   | `WEB_ORIGIN` | `https://<detailing-web>.up.railway.app` |
   | `LOG_LEVEL` | `info` |

   > **КРИТИЧНО:** paste `GOOGLE_SERVICE_ACCOUNT_JSON_B64` with **NO surrounding quotes**.  
   > Railway's env UI does not strip them — a leading `"` will cause a `JSON.parse` error at boot with a misleading error message. Значение должно начинаться прямо с `eyJ…` (начало base64-encoded JSON).

3. Выдать публичный домен: **Settings → Networking → Generate Domain**.

---

### detailing-web

1. **Source:** корень репозитория.  
   **Root Directory** = `apps/web`.  
   Railway подхватит `apps/web/railway.json`.

2. **Переменные окружения** (Settings → Variables):

   | Переменная | Значение |
   |-----------|---------|
   | `VITE_API_BASE_URL` | `https://<detailing-api>.up.railway.app` |

3. Выдать публичный домен аналогично.

4. После деплоя обоих сервисов — обновить `WEB_ORIGIN` в `detailing-api` на реальный URL `detailing-web` и передеплоить API.

---

### Проверка деплоя

```bash
# API healthcheck
curl https://<detailing-api>.up.railway.app/healthz
# Ожидаемый ответ: {"ok":true,"time":"..."}

# Web
# Открыть https://<detailing-web>.up.railway.app — должна загрузиться форма
```

---

## Тесты

```bash
pnpm test        # vitest — packages/shared + apps/api (unit-тесты с моками Sheets)
pnpm typecheck   # tsc --noEmit для всех пакетов
pnpm build       # tsup (api) + vue-tsc + vite build (web)
```

---

## Архитектура

Детальное описание принятых решений, data-контракт (columns A–K), Sheets-интеграцию, идемпотентность, header-верификацию и полный список рисков см. в [`.omc/plans/mvp-booking-form.md`](.omc/plans/mvp-booking-form.md).

---

## Известные follow-up'ы

- Обновить vitest до >=4.1.0 (dev-only CVE).

---

## Что вне MVP

- Чтение и редактирование записей (list/edit view)
- Аутентификация и авторизация
- Кросс-инстанс дедупликация (Redis-backed idempotency)
- PWA-манифест, офлайн-режим, service worker
- Мультилетняя поддержка (сейчас только `Запись 2026`)
- E2E-тесты (Playwright/Cypress)
- Аналитика и отчёты
- Загрузка фотографий (до/после)
- Международные номера телефонов (только `+7` в MVP)
- Управление правами (нет понятия «кто именно редактировал»)
