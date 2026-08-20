# Fit — текущее состояние проекта

> Rolling snapshot для продолжения между сессиями. Максимум 120 строк.
> После каждого подтверждённого merge заменяйте сведения ниже, не добавляйте
> хронологию: полная история уже хранится в Git и Tracker.

Обновлено: 2026-08-20
Проверенный базовый `main`: `53ebc32` (`fix(yandex): publish stage deployment status (#492)`)

## Активная работа

- Yandex ID/profile, tenant-allowlist и автоматическая stage delivery находятся
  в `main`: GitHub OIDC без JSON-ключа, immutable image, forward-only миграции,
  private migration runner, smoke и rollback. После явной роли
  `functions.editor` автоматический run `32376225799` полностью прошёл:
  миграций не ожидалось, обе revisions и Terraform state согласованы,
  health/readiness, точный CORS и новый GitHub deployment status зелёные. Новая,
  cost-sensitive, destructive или identity-инфраструктура
  по-прежнему блокируется policy до отдельного reviewed apply.
- Тестовый Yandex ID зарегистрирован как `trainer`; обычный PKCE-вход на Vercel
  Preview подтверждает read-only профиль. OAuth Client secret перевыпущен и не
  используется: текущий PKCE-контракт требует только публичный Client ID.
  Production frontend и Supabase не переключались.
- Read-only clients slice находится в `main`: migration `000005` хранит только
  SHA-256 короткоживущей opaque-сессии Fit, а защищённый `GET /v1/clients`
  читает только активных клиентов actor tenant. Callback-пилот показывает
  список/empty/error/retry без ссылок и mutations.
- Существующий pilot Preview синхронизирован со свежим `main`; Yandex ID и
  выдача Fit-сессии проходят. Live-проверка выявила точный transport-конфликт:
  Serverless Containers перехватывает `Authorization` как Yandex IAM token и
  возвращает `403` до Fastify. Активная ветка
  `codex/yandex-pilot-session-header` переносит только browser pilot session в
  отдельный `X-Fit-Pilot-Session`; Supabase и production не меняются.
- `YAFIT-327` завершает цельную композицию Trainer Progress без дублирующего
  обзора и глобальных раскрытий: текущая неделя и ИИ видны сразу, бег и замеры
  открываются отдельными компактными маршрутами. Контракт LLM, клиентский
  Progress и главные страницы ролей не изменены.
- `YAFIT-328` полирует Client Home без изменения LLM/SpeechKit: голос и текст
  остаются первыми, подсказка голоса появляется после запуска записи, ближайшее
  назначение получает честный временной статус и читаемый состав, неделя и
  личный рекорд становятся компактнее, а недоступный на вебе Apple Health не
  создаёт вложенную карточку.
- Тёмная палитра и поиск клиентов остаются индивидуальными default-off
  пилотами через allowlist; переменные и ограничения описаны в `OPERATIONS.md`.

## Последняя проверенная продуктовая точка

- Участникам allowlist поиск клиентов показывается от шести записей: Fit-поле
  полной ширины, подписанный сброс, корректные focus/contrast/empty states.
  Порог считается по полному списку, поэтому поле не исчезает при фильтрации.
  Вне пилота экран и visual baselines прежние; реализация изолирована в
  `ClientsListPage.tsx`.
- Серия Progress `#474`…`#485` считает горизонты и регулярность по реальной
  истории, формирует измеримые серверные факты, использует русские предметные
  формулировки и единую визуальную иерархию для ролей. Замеры собраны в один
  компактный блок, состояния и размеры 390/430/1440 px приняты; `#483/#485`
  восстановили обновление и генерацию ИИ-анализа. План — в
  `docs/design/PROGRESS_SCREEN_PLAN_2026-08-20.md`.
- После `#461` сохранённый план показывает компактный список упражнений и
  раскрываемые подходы: одна числовая сводка, `/` для разных повторений, `—`
  для пропуска, история отдельной кнопкой 44 px. Копирование и удаление собраны
  в подписанное overflow-меню; права не расширены.
- Экран планирования держит контекст клиента в шапке; дата и начало компактны,
  окончание и заметка раскрываются, ввод сворачивается после упражнения, бег с
  RPE не сжимается в одну строку. Форма копии использует те же раскрываемые
  строки и не перекрывает ввод при открытой iOS-клавиатуре.
- Изолированный Yandex Cloud stage содержит приватные Managed PostgreSQL 17 и
  Serverless Containers без прогретых экземпляров. Миграции `000001`–`000005`
  применены автоматически; runtime получает отдельные owner/API пароли из
  Connection Manager. API transport публичен только для точного пилотного CORS,
  migration runner остаётся private. Production остаётся на Supabase; tenant
  cutover не включён.

## Последние проверки

- Поиск клиентов: `npm run check` зелёный; Playwright проверил 390/430/1440 px,
  светлую и пилотную тёмную тему, ввод, фильтрацию, empty, focus и reset без
  переполнения и ошибок консоли.
- Автоматический run `32372968388`: migration `000005`, обе revisions,
  Terraform policy/state refresh и API health/readiness зелёные; rollback не
  потребовался. Следующий run `32376225799` также зелёный и опубликовал
  успешный deployment `6003600605`, заменив устаревшую красную карточку.
- Read-only clients: полный `npm run check` (592 frontend tests, API, infra
  policy и production build) зелёный. Playwright проверил success на
  390/430/1440 px и mobile empty/error/retry без overflow. Локальный
  `npm run local:verify` без скачивания образов применил только migration
  `000005`; 517 Supabase pgTAP и 7 PostgreSQL actor/RLS/session тестов прошли.
- Live pilot Preview обновлён до `main`: OAuth callback/profile success зелёные,
  а прямой запрос воспроизвёл `403` gateway для application Bearer token.
  Исправление custom-header проходит локальную проверку в активной ветке.

## Ближайший roadmap

1. Влить custom session header, дождаться автоматического stage deploy,
   обновить существующий pilot Preview и подтвердить Yandex ID + ожидаемый
   empty clients state до миграции tenant-данных.
2. Портировать memberships/invitations, затем exercises/workouts и остальные
   вертикали из `docs/design/yandex-cloud-migration.md`.
3. После полного tenant-контракта провести две миграционные репетиции; только
   затем обсуждать первый sticky tenant cutover. Production пока на Supabase.

Ручной беговой MVP `YAFIT-300/301/307/302/303` завершён. UX/UI-план и отложенные
фичи — в `docs/design/PRODUCT_USABILITY_AUDIT_2026-08-18.md` и `BACKLOG-OVERVIEW.md`.

## Отложенный backlog

- `YAFIT-245` (P0, устойчивость AI-разбора) **не начинать без отдельного
  разрешения пользователя и предварительного описания механики и рисков**.
- `YAFIT-234` (защита SpeechKit relay) отложен; голосовой путь не менять.
- `YAFIT-235` — Webvisor сознательно сохранён для исследовательских метрик.
- Новые аналитические блоки и декоративную визуализацию не брать до завершения
  P0/P1 продуктовой полировки.

## Постоянные ограничения
- LLM-разбор и SpeechKit не менять без отдельного продуктового решения.
- UI проверяется на Client 390/430 px и Trainer 1440 px; для mobile — WebKit.
- После merge приложения обновляется и заново запускается iOS bundle.
- Локальные контейнеры и Supabase — только Podman; при его недоступности
  migration/pgTAP-проверки выполняются в CI.
- Production-секреты не читаются и не выводятся; статусы подтверждаются через YAFIT.
