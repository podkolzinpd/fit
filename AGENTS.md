# Fit V2 — обязательные правила разработки

Этот файл автоматически является входным контрактом для Codex и обязателен для
людей и ИИ-агентов. В начале **каждой** новой сессии, до плана и изменений,
полностью прочитайте:

1. `docs/FIT_WORKFLOW.md`;
2. `docs/CURRENT_STATE.md`;
3. `docs/UI_TASK_PROMPT.md`.

`docs/UI_TASK_PROMPT.md` — обязательный базовый контекст каждого запуска, даже
если задача изначально кажется backend- или data-only: системные состояния,
ошибки, loading, пользовательский текст и новые действия часто затрагивают UI.
Его не нужно вручную прикладывать к каждой постановке. Остальные документы
открывайте только по правилам ниже и по таблице workflow — не загружайте всю
документацию без необходимости.

Production frontend работает на `https://fit-training.ru` через Yandex API
Gateway/Object Storage, а production auth/API/БД — в Yandex Cloud. Vercel
сохранён только для редиректа со старого адреса; новые Vercel deployments,
включая PR Preview, выключены, GitHub repository отключён от Vercel-проекта.
Supabase остаётся временной legacy-зависимостью для
recovery, неперенесённых media, локальных тестов и rollback; это не второй
production backend для новых функций. **Новые миграции в Supabase не создавайте.**

До завершения вывода Supabase из эксплуатации для задач, затрагивающих auth, БД,
repositories/queries, media, Assistant, SpeechKit, push, backend routing или
переносимые продуктовые данные, также полностью прочитайте
`docs/YANDEX_CUTOVER_PLAYBOOK.md`. Текущие фаза и блокеры остаются в
`docs/CURRENT_STATE.md`, а не дублируются в этом файле.

## Обязательный дизайн-контекст

Если задача добавляет или меняет пользовательский экран, действие, состояние,
форму, карточку, навигацию, график, иконку, текст или визуальное поведение:

1. До предложения решения полностью прочитайте `docs/UI_IDENTITY.md`.
2. Прочитайте релевантные разделы `docs/UI_DESIGN_SYSTEM.md` и проверьте
   актуальную реализацию в коде.
3. Откройте реальный маршрут и ближайший утверждённый экран-референс.
4. В плане явно назовите переиспользуемые Fit-компоненты и токены, единственное
   primary-действие, проверяемые состояния и границы scope.

Это обязательный preflight, а не рекомендация. Нельзя начинать UI-код или
генерировать макет до его выполнения. Нельзя создавать локальную айдентику,
палитру, типографическую шкалу, набор радиусов, библиотеку компонентов или
вариант навигации, параллельные Foundation UI Identity v1. Если существующая
система не покрывает реальную продуктовую потребность, сначала зафиксируйте
конкретный gap и вынесите расширение общего контракта на отдельное решение.

## Порядок работы

1. Сформулируйте пользовательский результат и acceptance cases.
2. Найдите существующий публичный контракт feature. Для parity-задачи сравните его с точным V1 baseline из `FEATURE_PARITY.md`: данные, состояния, действия и mobile visual. Не создавайте параллельный путь к тем же данным.
3. Если меняется БД: numbered Yandex PostgreSQL migration в
   `services/api/db/migrations` → локальная clean-chain/RLS проверка →
   API/domain types → query/repository → UI. Не добавляйте парную Supabase migration.
4. Добавьте happy path, validation, loading, empty, error и retry states.
5. Если изменилось пользовательское поведение, роли, доступы, навигация или известные ограничения, обновите `docs/PRODUCT_WIKI.md`. Описывайте только уже реализованный функционал; планы и идеи оставляйте в `docs/design` и `FEATURE_PARITY.md`.
6. Запустите `npm run check`; для DB-изменений также `npm run local:verify` и
   целевые Yandex API/actor-RLS тесты. `db:reset`/`db:test` проверяют только
   замороженную локальную Supabase-цепочку и не доказывают новую Yandex-схему.
7. Обновите `docs/CURRENT_STATE.md` в той же ветке, когда фактура уже известна;
   после merge только сверьте snapshot с новым `main`. Отдельный docs-only PR
   нужен лишь для действительно новой post-merge фактуры. Это обязанность агента,
   а не пользователя.

## Постоянные договорённости с владельцем продукта

- Для запрошенных изменений действует постоянное разрешение владельца продукта:
  агент самостоятельно реализует задачу, отправляет ветку, открывает PR, ждёт
  зелёный CI, штатно сливает, проверяет production и обновляет затронутые
  мобильные сборки без повторных запросов. Последняя прямая команда пользователя,
  включая «только проверить» или «пока не вносить», всегда имеет приоритет.
- Одна явно выбранная задача или один экран = одна ветка и один PR. Если
  пользователь заранее разрешил автономное завершение, агент сам ждёт зелёный
  CI, сливает PR, проверяет production и останавливается, не начиная следующий
  экран без отдельной команды. Красный PR не сливать и обязательные проверки не
  обходить.
- Перед merge сверяйте активные параллельные PR в `main`: PR с более ранним
  `createdAt` выпускается первым, следующий ждёт его merge, обновляется от нового
  `main` и заново проходит обязательный CI. Более поздний PR ждёт текущий. Старые
  неактивные PR из прошлых выпусков эту очередь не блокируют.
- Главные страницы клиента и тренера не менять без прямой просьбы. На Client
  Home голосовой ввод и ввод текстом остаются основными действиями.
- UI-задача не меняет LLM prompt/matching/fallback/сохранение и SpeechKit без
  отдельного продуктового решения.
- Неделя начинается в понедельник. Любая завершённая тренировка считается
  состоявшейся, даже при частично выполненном плане; неполнота плана показывается
  отдельно от факта тренировки.
- Пользовательские тексты должны быть понятны без знания англоязычных терминов:
  «Личный рекорд», «ИИ-анализ». Проценты Progress округляются до целых, прочие
  показатели — максимум до одного знака после запятой.
- Локальные контейнеры, включая PostgreSQL 17 и legacy Supabase, запускаются
  только через Podman. Docker у
  пользователя не установлен и не планируется; не предлагайте его установку.
- Desktop trainer и задачи P2 отложены до нового прямого решения пользователя.

## Три уровня проверки и rollout

Для каждой новой пользовательской функции агент использует следующий порядок.
Если пользователь не просил иначе, работа останавливается после локальной
проверки, зелёного CI и передачи PR: удалённый Preview и production-пилот не
запускаются автоматически.

### 1. Локальная проверка — обязательный первый уровень

- Сначала реализуйте и проверьте функцию локально. `npm run dev` через Podman
  готовит **две локальные** базы: PostgreSQL 17 для Yandex API и замороженную
  Supabase-цепочку для существующих legacy-тестов. Обычная development-сборка
  ещё может выбирать Supabase; это не проверка новой production-функции.
- Новую функцию проверяйте через локальный Yandex API/PostgreSQL (или его
  изолированный contract test), а не только через Supabase-сценарий. Не
  подключайте локальное приложение к удалённым production-базам и не копируйте
  production URL/секреты в локальные env-файлы.
- Если меняется БД, добавьте только numbered migration в
  `services/api/db/migrations`, затем выполните `npm run local:verify` и
  целевые Yandex API/RLS тесты. Generated Supabase types обновляются только
  при отдельной явно разрешённой legacy-правке, не ради Yandex-изменения.
- Выполните целевые тесты, обязательную UI/WebKit-проверку и `npm run check` по
  правилам этого файла. Успешная локальная проверка сама по себе не разрешает
  deployment или изменение production.

### 2. Удалённая проверка до merge — пока недоступна

- Vercel оставлен только как переход со старого адреса на `fit-training.ru`.
  Не используйте комментарий `/preview`, не создавайте Vercel Preview и не
  запускайте Vercel deployment для проверки PR.
- Для PR проверяйте функцию локально и в CI. Если нужен отдельный удалённый
  сайт до merge, сначала согласуйте новую Yandex-hosted Preview-среду как
  отдельную задачу; её пока нет. Не считайте production frontend тестовой средой.
- Удалённый Preview сам по себе не применял бы Yandex PostgreSQL migrations из
  PR; до появления новой среды полный сценарий с новой схемой проверяется
  локально на PostgreSQL 17 и Yandex API.

### 3. Production-пилот для отдельных пользователей — через default-off флаг

- Используйте этот уровень только когда пользователь прямо просит показать
  готовую функцию выбранным production-пользователям. Самостоятельно не
  включайте пилот, не расширяйте allowlist и не меняйте build-time переменные
  production-сборки Yandex frontend в GitHub.
- Для каждой функции создавайте независимые build-time переменные:
  `VITE_<FEATURE>_ENABLED=true` и
  `VITE_<FEATURE>_PILOT_USER_IDS=<auth-user-uuid-1>,<auth-user-uuid-2>`, а также
  отдельную функцию `is<Feature>PilotEnabled(userId: string): boolean` в
  `src/app/feature-flags.ts`.
- Функция включена только при точном значении глобального флага `"true"` и
  наличии текущего `actor.userId` в собственном allowlist функции. При разборе
  списка убирайте пробелы и пустые элементы. Отсутствующий или пустой allowlist
  никому не включает функцию.
- Не переиспользуйте allowlist другой функции и не создавайте generic
  feature-flag framework без отдельной доказанной необходимости. Скрывайте все
  пользовательские входы вне пилота; прямые маршруты защищайте guard и
  безопасным fallback.
- Frontend allowlist не является авторизацией: UUID видны в публичном JS bundle.
  Данные и mutation по-прежнему защищаются RLS и backend ownership-проверками;
  UUID и allowlist не выводятся в UI, логи, аналитику и ошибки.
- Добавьте unit-тесты флага и тесты поведения пользователя внутри и вне пилота,
  включая прямой маршрут. Зафиксируйте переменные и default-off семантику в
  `OPERATIONS.md`, а изменившееся фактическое поведение — в релевантном разделе
  `docs/PRODUCT_WIKI.md`. Production-переменные берутся из конфигурации
  `.github/workflows/deploy-yandex-frontend.yml`, не из Vercel.
- Изменение build-time переменных или allowlist требует нового deployment.
  Runtime-переключение без deployment в этот механизм не входит.

В handoff агент явно сообщает, на каком уровне проверена функция: локально,
в CI или в production-пилоте. Не называйте недоступный Vercel Preview
выполненной проверкой.

## Скорость без потери качества

- Обычная точечная правка одного экрана должна стремиться к циклу примерно
  20–27 минут, если нет внешнего блокера. Если срок заметно растёт, сообщите
  конкретную причину: CI, окружение, найденная регрессия или расширение scope.
- В начале сделайте один preflight: маршрут, feature-компоненты, Fit primitives,
  стили, реальные состояния, все изменяемые тексты и зависящие от них тесты.
- Во время реализации запускайте целевые проверки. Полный `npm run check`
  запускайте один раз после стабилизации diff; не отправляйте промежуточный push,
  который заведомо запустит лишний полный CI.
- Документацию реализованного поведения и rolling snapshot обновляйте в том же
  продуктовом PR. Не создавайте второй PR только ради служебного handoff, если
  после merge не появилось новой существенной фактуры.
- Не сокращайте lint, typecheck, тесты, WebKit, mobile/visual/e2e и production
  verification ради скорости. Допустимое ускорение — кэширование, точный scope,
  параллельные независимые проверки и устранение повторных запусков.

## Границы архитектуры

- UI, hooks и feature-код зависят только от provider-neutral доменных
  контрактов: они не импортируют SDK, не вызывают Supabase/Yandex API и не
  ветвятся по имени backend. Provider-specific transport остаётся в
  queries/repositories и серверных adapters.
- `src/data/queries` — единственное место с Data API/RPC вызовами.
- `src/data/repositories` преобразует DB rows/errors в доменные DTO; SQL там запрещён.
- Feature использует другую feature только через её публичный `index.ts`.
- Не добавляйте generic repository/service, Redux или глобальный mutable state без ADR.
- Server state хранится в TanStack Query; route state — в URL; form state — в React Hook Form.
- Календарная дата — `LocalDate`, а не результат `toISOString()`.

## База данных

- Источник истины для новых изменений схемы — numbered migrations в
  `services/api/db/migrations` (PostgreSQL 17, `node-pg-migrate`). Новые файлы в
  `supabase/migrations` не добавляйте. Существующую Supabase-цепочку не
  переписывайте: она остаётся для локальных legacy-тестов и rollback-архива.
  Ручной SQL в production Dashboard/WebSQL запрещён.
- `npm run dev` автоматически применяет pending Yandex migrations только к
  локальному Podman PostgreSQL. `npm run local:verify` проверяет локальную
  цепочку и actor/RLS. После merge `.github/workflows/deploy-yandex-stage.yml`
  применяет pending migrations к принятому production data plane до
  переключения API-ревизии; не запускайте отдельный ручной apply без причины.
- PK бизнес-сущностей: `uuid default gen_random_uuid()`.
- `created_at`: `default now()`; единственный trigger — общий `updated_at` trigger.
- Бизнес- и auth-trigger запрещены. Инициализация пользователя вызывается явно.
- Простая запись выполняется через Yandex API с actor context; aggregate из
  нескольких таблиц — в одной транзакции. SQL не размещайте в UI/repository.
- Команда не принимает `trainer_id` как основание прав: actor определяется
  серверной app-session, ownership проверяется в транзакции; root при update
  блокируется.
- На доступных runtime таблицах обязательны RLS, минимальные grants, `USING`
  и `WITH CHECK`; роль `fit_api` не получает owner/BYPASSRLS.
- FK обязательны для aggregate children; snapshot/optional links могут быть логическими UUID.
- Архивные записи не участвуют в новых операциях, но история остаётся читаемой.

## Production Yandex и замороженный Supabase

- Production auth и продуктовые чтения/записи идут через Yandex ID/API и
  Managed PostgreSQL. Dual-write и fallback на Supabase после ошибки запрещены.
  Новая функция получает один доменный контракт и Yandex implementation;
  создавать ради неё Supabase adapter или парную migration не нужно.
- Supabase ещё задействован в ограниченных legacy-путях (recovery, оставшиеся
  media и локальные тесты). Не удаляйте их или старые таблицы до отдельного
  decommission/rollback-решения. Если изменение пересекается с таким путём,
  зафиксируйте конкретную совместимость и целевой тест; не расширяйте старую
  схему молча и не направляйте новые production-данные обратно в Supabase.
- Для новой Yandex-схемы в том же PR обновите API/DTO, repository/queries,
  actor/RLS/grants и проверку clean migration chain. При необходимости переноса
  **уже существующих** legacy-данных обновите tenant catalog,
  export/import/validation и локальную rehearsal; для Yandex-only данных
  не добавляйте фиктивное mapping в Supabase.
- Когда старый Supabase-based UI/E2E не умеет создать новые данные, добавьте
  локальный Yandex API/PostgreSQL fixture или contract test. Не считайте
  зелёный Supabase-тест доказательством работы новой production-функции.
- Выявленный gap Yandex-сценария нельзя обходить Supabase fallback. Оставьте
  пользовательский вход default-off или явно заблокированным, зафиксируйте
  блокер в `docs/CURRENT_STATE.md`/`FEATURE_PARITY.md` и закройте его до rollout.
- Никогда не подключайте локальные тесты к production-БД. Не выводите PII в
  логи, fixtures и отчёты. Исторический Supabase snapshot сохраняется до
  завершения observation/backup/rollback-гейтов; это не работающая копия новых
  Yandex-записей.

## Push-уведомления пользователям

Production использует Yandex PostgreSQL `app_private.push_notifications_outbox`
и Yandex dispatcher/sender. Для нового сценария ориентируйтесь на
`services/api/db/migrations/000030_yandex_push_pipeline.sql` и последующие
Yandex migrations, а не на исторические `supabase/migrations` и `pg_cron`.

1. Добавьте actor-scoped producer в новую numbered Yandex migration: уникальный
   `kind`, fan-out на все активные `public.push_subscriptions` получателя,
   `subscription_id` в каждой строке outbox и idempotent dedupe. Уважайте
   `notification_preferences` (отсутствие строки = включено).
2. Если событие периодическое, используйте отдельный Yandex timer/invoker по
   действующему pipeline; не создавайте Supabase cron или Edge Function.
3. Общий dispatcher/sender меняйте лишь при доказанной необходимости. Пуш
   шифруется и отправляется в Cloud Function, не в SQL.
4. Проверьте Yandex producer/dispatcher на идемпотентность, opt-out,
   отсутствие подписок, несколько устройств и отказ отправки. Legacy pgTAP
   остаётся регрессией замороженной Supabase-цепочки, не приёмкой новой функции.

## Качество и безопасность

- Не используйте `select('*')`, `any`, небезопасные casts и проглоченные ошибки.
- Не коммитьте `.env`, DB password, secret/service-role/OAuth secret.
- Локальная разработка использует только локальные Podman Supabase и PostgreSQL
  17; production URL/секреты не копируются в локальные env-файлы. Production
  frontend строится GitHub Actions для Yandex Object Storage, не Vercel.
- Для обычного локального запуска используйте `npm run dev`: команда сама
  запускает обе локальные базы. Не подменяйте `.env.development` удалённым проектом.
- Любая mutation должна подтверждать, что изменилась ожидаемая запись.
- Многошаговая запись обязана полностью откатываться при любой ошибке.
- Добавляйте тест на cross-tenant доступ для каждого нового tenant ID.
- Не копируйте legacy `src/db` или старые migrations; переносите только проверенное поведение.
- Старый источник называйте только `V1 baseline` или `legacy trainer-app`; не переносите в Fit V2 названия и URL исходных репозиториев.
- Не отмечайте parity-сценарий как `Implemented` по одному happy path: зафиксируйте проверяемый инвентарь V1 и тест на каждое обязательное поведение.

## Definition of Done

- Пользовательский сценарий отражён в `FEATURE_PARITY.md`.
- `docs/PRODUCT_WIKI.md` отражает актуальный пользовательский функционал и ограничения после изменения.
- Новая Yandex migration воспроизводится на чистом локальном PostgreSQL 17;
  `npm run local:verify` и actor/RLS тесты зелёные.
- API/domain types актуальны; generated Supabase types не меняются без
  отдельной явно согласованной legacy-правки.
- Unit/component/integration/E2E покрытие соответствует риску.
- `npm run check` зелёный; Yandex DB/RLS тесты зелёные для изменений БД.

# Fit UI / UX Engineering Rules

These rules apply to every UI task in addition to the architectural and product
rules above. The current product is the starting point; a generated component,
Figma frame, screenshot, or external registry is reference material, not a new
source of truth by itself. Every UI task must also read `docs/UI_TASK_PROMPT.md`
and `docs/UI_IDENTITY.md`; `docs/UI_DESIGN_SYSTEM.md` describes the current
implementation that is being migrated.

## EXISTING SYSTEM FIRST

- Inspect the relevant route, feature component, `src/shared/ui.tsx`,
  `src/shared/icons.tsx`, and the applicable tokens/selectors in
  `src/styles.css` before proposing or implementing UI.
- Reproduce the current information architecture, vocabulary, data states, and
  interaction contract before changing presentation.
- Do not replace working controls, layouts, or CSS merely because an external
  library offers an alternative.

## COMPONENT PRIORITY

Use this order: an existing Fit component; a small extension of an existing Fit
component; a focused new Fit primitive; a registry component only when the
first three options are demonstrably unsuitable. Keep domain behavior in the
feature layer. `shadcn`, 21st.dev, and Figma may inform a primitive, but imported
code must be reduced to Fit tokens, accessibility conventions, and actual need.

## DO NOT INVENT A NEW DESIGN LANGUAGE

Use the approved MONOCHROME PERFORMANCE direction from `docs/UI_IDENTITY.md`:
warm graphite `#242426` in light, background `#111214` and milk `#F1EDE6` in
dark, Onest, compact typography and semantic color only for real state or data.
Apply it through the existing semantic token and component system. Preserve
the current screen's information architecture and behavior using
`docs/UI_DESIGN_SYSTEM.md` and real baselines. Do not create feature-local
palettes, a second token system, Tailwind, an unrelated font, a new brand color,
or a parallel component kit.

## AVOID AI-GENERATED UI

Do not ship generic dashboard grids, excessive gradients, floating glass
panels, decorative metrics, fabricated charts, placeholder copy, or controls
that are not backed by a real user action. Generated UI must be treated as a
draft to inspect and simplify, never pasted as the finished Fit interface.

## HIERARCHY BEFORE DECORATION

First make the primary action, reading order, grouping, labels, feedback, and
empty/error behavior unambiguous. Add visual emphasis only after hierarchy is
correct. One screen should have one obvious primary action; secondary and rare
actions must not compete with it.

## MOBILE FIRST FOR CLIENT

- Design and verify Client at 390 px first, then 430 px; preserve safe areas,
  bottom navigation, readable wrapping, touch targets, and keyboard behavior.
- Never rely on hover. Keep primary tasks reachable with one thumb and avoid
  horizontal scrolling except for an explicitly scrollable control such as
  metric tabs.
- A completed workout remains completed even when its plan was only partially
  performed; incomplete plan and confirmed fact are shown separately.

## TRAINER DESKTOP

Trainer changes must be checked at approximately 1440 px as well as in the
existing compact shell. Do not assume a wider viewport automatically creates a
useful desktop layout. Preserve dense operational scanning, keyboard access,
and clear client/workout context; do not turn trainer tools into a marketing
dashboard.

## REUSE WITHOUT OVERENGINEERING

Extract a shared primitive when two or more real consumers share semantics and
interaction, not merely similar pixels. Prefer a small explicit API and local
composition over a configurable mega-component. Do not refactor unrelated
screens to justify reuse.

Creation, review, Live, completion, and history form one workout lifecycle.
Keep a common semantic component contract for WorkoutHeader, Exercise, SetRow,
Status, and CTA across these states. Do not implement separate lookalike
components whose labels, status rules, or interaction states can drift.

## ICONS

Reuse the stroke SVG vocabulary in `src/shared/icons.tsx`. Add an icon there
only when it represents a repeated or important action. Do not mix icon packs,
use emoji as navigation, or substitute ambiguous Unicode glyphs when an
accessible labeled control is required. Icon-only buttons need an accessible
name and at least the standard touch target.

## STATES

Every changed data surface must deliberately cover loading, empty, error,
success, disabled, and retry states that can occur. Mutations need visible
pending and outcome feedback. Never present planned data as confirmed fact, and
never use color as the only status signal.

## NOTIFY USERS OF NOTABLE CHANGES (COACHMARKS)

Trainers reported too many silent UI/behavior changes. When a PR changes
navigation, terminology, or the primary flow of an existing trainer/client
screen in a way a returning user would notice and need explained, wrap the
changed element with `Coachmark` from `src/shared/ui.tsx` (pilot:
`TrainerProgressOverviewCard`).

- One `Coachmark` per notable change, with a new unique `id` (e.g.
  `"<feature>-<yyyy-mm>"`) and `userId={actor?.userId}`. Reusing an old id
  means the message will never show again for users who already dismissed it.
- Keep the copy to a title and one short sentence: what changed and why it
  helps. No images, no multi-step tours.
- Skip it for cosmetic-only tweaks, internal/service tasks, and changes too
  small to need explanation — do not add one to every PR by default.
- Storage is `localStorage` only (`src/shared/coachmarks.ts`), scoped per
  `userId`; no migration or DB table needed for this.
- This is a lightweight in-app alternative to stories/onboarding videos,
  chosen because it scales with weekly release cadence without a separate
  production cycle. Do not build a stories/video system without a new
  decision — see the pilot PR discussion for the tradeoff.

## VISUAL VERIFICATION

Visual verification is mandatory for UI changes. Run the relevant component or
behavioral tests, then inspect the real route with Playwright. At minimum check
Client 390 px and 430 px or Trainer 1440 px according to the affected role;
cross-role/shared changes require all three. Check horizontal overflow, long
Russian text, loading/empty/error/success where applicable, safe-area and fixed
bars, and compare screenshots before and after. Update a committed screenshot
baseline only when the visual change is intentional and explained in the PR.

## FIGMA RULE

When a Figma frame exists, inspect it through the Figma MCP and identify its
component, token, layout, and state mapping before coding. Match product intent,
not accidental coordinates. If Figma conflicts with current behavior,
accessibility, or the established Fit system, document the conflict and do not
silently choose either version. No Figma frame means existing Fit UI remains
the design source of truth.

## UI WORKFLOW

### A. INSPECT

Read the route and its real data states, reusable components, tokens, tests,
and current screenshots. State the user goal and the one primary action.

### B. REFERENCE

Use Figma, shadcn, or 21st.dev only for the missing pattern. Record what is
being borrowed and how it maps to the existing Fit system before adding code.

### C. IMPLEMENT

Make the smallest accessible change inside existing architecture. Reuse Fit
tokens and primitives, preserve API/business logic, and add targeted tests for
new behavior or state transitions.

### D. VERIFY

Run lint, typecheck, targeted tests, and the appropriate Playwright visual
profiles. Inspect screenshots rather than relying only on green assertions.

### E. POLISH

Check copy, wrapping, spacing rhythm, focus/touch behavior, reduced motion,
overflow, and all realistic states. Remove decorative or duplicated UI before
requesting review.
