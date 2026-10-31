# Fit V2

Новая версия приложения для персональных тренеров. Проект переносит
пользовательские сценарии из legacy `trainer-app`, сохраняет общий типизированный
доменный data-контракт для Cloud.ru runtime и ограниченных legacy-путей и проверяет его обязательными тестами.

## Codex и единая айдентика команды

Запускайте Codex из этого репозитория или любой его вложенной папки. Корневой
`AGENTS.md` задаёт основные правила по новому документу владельца.
`docs/FIT_WORKFLOW.md` — карта существующих записей, не второй процесс и не DEVLOG;
текущая сводка — `docs/CURRENT_STATE.md`, решения области —
`docs/ACTIVE_CONTRACTS.md`. Для UI читать `docs/UI_TASK_PROMPT.md`,
`docs/UI_IDENTITY.md` и нужную часть `docs/UI_DESIGN_SYSTEM.md`.
Если чат открыт в зеркале проекта, сначала выбрать настоящий Git checkout.
История и корпоративная память не подменяют эти проектные инструкции.

Отдельно копировать дизайн-промпт в каждую задачу не нужно. Новый локальный
визуальный язык, палитра, набор компонентов или альтернативная навигация могут
появиться только после явного изменения общего дизайн-контракта в репозитории.

## Быстрый старт

```bash
npm ci
npm run dev
```

`npm run dev` использует Podman и безопасно готовит обе локальные базы: Supabase
и отдельный PostgreSQL 17 для Yandex API. Команда применяет только ещё не
применённые миграции, запускает Fastify API на `127.0.0.1:8080`, проверяет его
`/ready`, а затем запускает frontend. Облачные ресурсы команда не меняет.
Frontend во всех режимах использует только native API; Supabase запускается
общим local stack исключительно ради замороженной SQL-регрессии. Для ручного
входа задайте публичный `VITE_YANDEX_OAUTH_CLIENT_ID` локального OAuth-клиента.
Production размещён в Cloud.ru; Vercel остаётся только legacy redirect.
Актуальный контур описан в docs/YANDEX_CUTOVER_PLAYBOOK.md.

Если нужны только контейнеры и миграции без серверов разработки:

```bash
npm run local:prepare
```

После добавления миграции одна команда применяет обе цепочки и запускает
локальные SQL/RLS-проверки, проверку generated types и защиту истории:

```bash
npm run local:verify
```

В Pull Request те же критичные проверки запускаются автоматически на чистых
Supabase и PostgreSQL 17. Изменение уже существующей миграции или новая
миграция с разрушающей операцией остановят CI до merge.

Локальный PostgreSQL хранится в Podman volume
`fit-yandex-postgres-data`. Обычный запуск не пересоздаёт и не очищает его.
Полный сброс Supabase остаётся отдельной явной командой и никогда не выполняется
из `npm run dev`. При первом запуске команда также установит зафиксированные
зависимости `services/api`, если их ещё нет.

После `npm run db:reset` доступны локальные демонстрационные аккаунты:

- тренер: `trainer@fit.local` / `FitLocal123!`;
- клиент: `client@fit.local` / `FitLocal123!`.

Клиент связан с демо-профилем Анны Смирновой и может сам запросить или обновить
клиентскую версию AI-анализа. Эти учётные данные существуют только в локальной
seed-базе.

Для пересоздания и проверки локальной базы:

```bash
npm run db:reset
npm run db:test
```

Полная проверка приложения (применимость по изменениям —
`docs/ENGINEERING_RULES.md`; документация проверяется отдельно):

```bash
npm run check
```

## iOS build (Capacitor)

Веб-приложение оборачивается в нативный iOS-шелл через [Capacitor](https://capacitorjs.com) — без форка кода, тот же React-код работает внутри WKWebView. Нативный проект лежит в `ios/` (закоммичен, кроме build output/Pods — см. `ios/.gitignore`). Используется SPM-интеграция Capacitor (без CocoaPods/Podfile).

1. Установите Xcode.
2. `npm install`
3. Передайте публичные Yandex ID/API settings и включите app-session, main routing,
   native registration и Yandex-only auth. `ios:env:check` проверяет HTTPS API origin,
   OAuth client ID и точное `true` всех четырёх switches. Supabase env для release
   не требуется; серверные credentials во frontend не передаются.
4. `npm run ios:open` — сначала проверит наличие HTTPS release-конфигурации,
   затем соберёт release-parity bundle, засинкает его в `ios/` и откроет
   Xcode-проект. Без обязательных переменных команда завершится до сборки,
   чтобы в Xcode не попал пустой экран. Запуск на симулятор/устройство — оттуда.
5. После любых изменений в `src/` перезапустите `npm run ios:sync` (или `ios:open`) — Xcode не пересобирает веб-бандл сам.

Для локальной проверки интерфейса используйте native API/PostgreSQL из
`npm run dev`. Browser fixtures создают отдельную native БД на каждый сценарий
и synthetic app-session; GoTrue, PostgREST и Supabase SDK для них не нужны.
Перед `npx playwright test` установите зависимости API и выполните
`npm --prefix services/api run build`; PostgreSQL 17 должен быть запущен через
Podman. По умолчанию fixtures используют только `127.0.0.1:55432/postgres`.

Светлая тема используется по умолчанию во всех сборках. Для временного отката
на тёмную соберите приложение с `VITE_APP_THEME=dark`.

Вход через Google не показывается в веб- и iOS-интерфейсе. Существующие Google-аккаунты и серверный OAuth-провайдер не удалены. Вход во всех frontend-сборках выполняется через Yandex ID. Локального email/password режима больше нет.

## Обязательные документы

- [docs/PRODUCT_WIKI.md](./docs/PRODUCT_WIKI.md) — актуальная продуктовая wiki с описанием реализованного функционала.
- [AGENTS.md](./AGENTS.md) — правила для людей и ИИ-агентов.
- [docs/FIT_WORKFLOW.md](./docs/FIT_WORKFLOW.md) — карта контекста и записей для пунктов 1 и 6 основного документа, без второго процесса.
- [docs/CURRENT_STATE.md](./docs/CURRENT_STATE.md) — короткая поддерживаемая исполнителем точка продолжения между сессиями.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — границы слоёв и работа с БД.
- [FEATURE_PARITY.md](./FEATURE_PARITY.md) — контракт переноса V1.
- [Аудит Cloud.ru и возврат в Yandex Cloud](docs/design/CLOUD_RETURN_AUDIT_20261016.md) — проверенная карта, ограничения и очередь исправлений.
- [docs/YANDEX_CUTOVER_PLAYBOOK.md](./docs/YANDEX_CUTOVER_PLAYBOOK.md) — временный контракт Cloud.ru production, Yandex ID и сохранённого legacy-контура.
- [docs/UI_IDENTITY.md](./docs/UI_IDENTITY.md) — действующий визуальный контракт, общие продуктовые инварианты и доступность.
- [docs/design/FIT_LIME_DESIGN_CODE.md](./docs/design/FIT_LIME_DESIGN_CODE.md) — утверждённый Lime-дизайн-код: существующие компоненты, SVG-параметры и согласованные адаптации.
- [docs/UI_TASK_PROMPT.md](./docs/UI_TASK_PROMPT.md) — обязательный дизайн-контракт и готовый промпт для любых изменений интерфейса.
- [docs/UI_DESIGN_SYSTEM.md](./docs/UI_DESIGN_SYSTEM.md) — карта текущей реализации, используемая для безопасной миграции без изменения продукта.
- [docs/design/CLIENT_LIME_SVG_ADOPTION_20261018.md](./docs/design/CLIENT_LIME_SVG_ADOPTION_20261018.md) — план подготовки документации и согласованных клиентских доработок; запланированное отделено от реализованного.
- [docs/archive/monochrome/README.md](./docs/archive/monochrome/README.md) — исторические Monochrome-спецификации и планы; не обязательный стиль новых Lime-экранов.
- [docs/AI_AGENT_ONBOARDING.md](./docs/AI_AGENT_ONBOARDING.md) — выдача доступа к GitHub и полная локальная настройка ИИ-агента.
- [OPERATIONS.md](./OPERATIONS.md) — secrets, Google OAuth, автодеплой БД и release gates.

Текущий foundation переносит базовые CRUD и основной trainer flow. Полный статус переноса и ещё не закрытые UX-сценарии перечислены в `FEATURE_PARITY.md`; до их закрытия V1 не архивируется.
