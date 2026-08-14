# Fit — текущее состояние проекта

> Rolling snapshot для продолжения между сессиями. Максимум 120 строк.
> После каждого подтверждённого merge заменяйте сведения ниже, не добавляйте
> хронологию: полная история уже хранится в Git и Tracker.

Обновлено: 2026-08-13
Проверенный `main`: `b5122e0` (`feat infra: prepare Yandex Cloud stage (#379)`)

## Активная работа

- Активная задача миграции: выполнить первый отдельно одобренный stage deploy
  по `docs/STAGE_DEPLOYMENT.md`, проверить private API, PostgreSQL и миграции.
- Следующий этап после успешного stage smoke: Yandex ID/profile vertical slice
  и серверная tenant-allowlist для пилота; invitations и membership mutations
  остаются после auth.

## Последняя проверенная продуктовая точка

- Тренер и подключённый клиент используют общую связку: клиент создаёт и
  сохраняет собственные тренировки, тренер видит их в истории и копирует в
  отправляемый план; назначенные планы и факт выполнения остаются видимы обеим
  сторонам в разрешённых маршрутах.
- В live-тренировке тренер и подключённый клиент одинаково могут добавлять и
  удалять подходы, добавлять и заменять упражнения, менять порядок блоков.
  Серверная проверка связи с карточкой клиента сохранена; внешние аккаунты не
  получают доступ. После правки завершённое упражнение снова сворачивается.
- Один активный live-workout на клиента защищён интерфейсом и БД.
- Если пользователь открывает план при уже идущей тренировке этого клиента,
  Fit не подменяет выбранный план: предлагает явно открыть незавершённую
  запись или остаться. После явного перехода «Назад» ведёт в её карточку.
- На карточке спортсмена верхняя safe-area не прокручивается под статус-бар,
  а цель не дублируется в обзорном блоке.
- Voice-first главная, SpeechKit и LLM-разбор работают через прежние prompt,
  matching, fallback и сохранение: в последних PR эти механики не менялись.
- Тёмная тема voice-first и AI-поверхностей использует семантические токены и
  сохраняет контраст на мобильном экране.
- После `#369` в `services/api` существует изолированный Fastify foundation с
  `/health` и Podman-совместимым OCI-образом. Frontend, Supabase и production
  environment не переключены; платные ресурсы Yandex Cloud не создавались.
- После `#370` stage-инфраструктура описана Terraform: private PostgreSQL,
  Serverless Container, VPC, Registry, Lockbox и resource-level IAM. `apply`
  не запускался, поэтому облачные ресурсы по-прежнему не создавались.
- После `#371` Managed PostgreSQL baseline разделяет migration owner и runtime
  user, а Fastify API умеет задавать внутренний UUID пользователя только на
  время транзакции. К маршрутам и frontend новый pool пока не подключён.
- После `#372` в отдельную PostgreSQL migration chain перенесены `profiles` и
  `trainers`, минимальные grants и RLS собственного профиля. Production всё ещё
  использует Supabase.
- После `#375` добавлены `clients`, `client_trainers`, foreign keys и read-only
  RLS для владельца, root trainer и подключённых тренеров. Fastify routes и
  production к новому контуру не подключены.
- После `#379` подготовлены remote state, private network access, TLS/readiness,
  временный private migration runner и stage runbook. `terraform apply` ещё не
  выполнялся; текущий Supabase production path не изменён.

## Последние проверки

- `#354` / `YAFIT-252`: `npm run check` — 369 тестов; WebKit 390 px для
  voice-first и AI-карточек. LLM/SpeechKit не менялись.
- `#355` / `YAFIT-268`: чистый локальный reset БД через Podman; `db:test` —
  44 файла, 406 SQL/RLS-проверок; целевые Chromium e2e клиента и WebKit iPhone
  390 px прошли; `npm run check` — 369 тестов, lint, typecheck, coverage, DB
  types, iOS permissions и production build.
- После merge `#355` production iOS bundle из `main` собран, синхронизирован,
  установлен и запущен на уже открытом iPhone 17 без нового окна Xcode.
- `#358` / `YAFIT-270`: `npm run check` — 369 тестов; WebKit mobile shell —
  15 passed на 390, 375 и 360 px; локальная iOS-сборка и установка в iPhone 17.
- `#359` / `YAFIT-272`: `npm run check` — 369 тестов; целевой WebKit iPhone
  390 px проверяет отмену recovery-диалога, явное открытие active workout и
  возврат назад. После merge локальный iOS bundle собран, установлен и запущен
  на уже открытом iPhone 17 без нового окна Xcode.
- `#369`: `npm run db:reset`; `npm run db:test` — 422 SQL/RLS-теста;
  `npm run check` — 372 frontend-теста, Fastify API test/build, lint,
  typecheck, DB types, iOS permissions и production build.
- `#370`: Terraform `fmt -check` и `validate` на provider `0.215.0`;
  `npm run check` — 372 frontend-теста, Fastify API test/build, lint,
  typecheck, DB types, iOS permissions и production build.
- `#371`: PostgreSQL integration test в одноразовом Podman-контейнере;
  Terraform `fmt -check` и `validate`; `npm run check` — 372 frontend-теста,
  5 API unit-тестов, lint, typecheck, DB types и production builds.
- `#372`: PostgreSQL 17 integration — actor context и cross-tenant profiles;
  локальный Supabase reset, 422 SQL/RLS-теста и `npm run check` прошли.
- `#375`: PostgreSQL 17 integration — 4 теста clients/memberships и FK;
  локальный Supabase reset, 422 SQL/RLS-теста и `npm run check` прошли. После
  flaky WebKit-навигации повторный E2E job полностью прошёл.
- `#379`: `npm run check` — 377 frontend- и 10 API-тестов; Terraform
  `fmt`/`validate`; Podman image smoke и PostgreSQL 17 migration E2E прошли.

## Отложенный backlog

- `YAFIT-245` (P0, устойчивость AI-разбора) **не начинать без отдельного
  разрешения пользователя и предварительного описания механики и рисков**.
- `YAFIT-234` (защита SpeechKit relay) отложен пользователем; текущий голосовой
  разбор не менять.
- `YAFIT-235` — принятое продуктовое решение сохранить Webvisor для
  исследовательских метрик, это не баг.
- Остальные открытые задачи аудита остаются в `YAFIT-25`: в том числе
  `YAFIT-242` (timezone), `YAFIT-250` (постраничная история), `YAFIT-253`
  (demo membership), `YAFIT-259` (conflicts/slow network), `YAFIT-260`
  (mobile a11y и schedule density). Не брать без нового приоритета.

## Постоянные ограничения

- LLM-разбор — основная функция продукта; UI-правки не меняют prompt,
  matching, fallback и сохранение без отдельного решения.
- UI перед сдачей проверяется в WebKit на ширине 390 px.
- После merge изменений приложения обновляется и заново запускается iOS bundle.
- Локальные Supabase-проверки работают через установленный Podman; Docker не
  требуется.
- Текущий backlog и статусы задач подтверждаются через YAFIT; этот файл служит
  индексом, а не заменой Tracker.
