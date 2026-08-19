# Fit V2 — обязательные правила разработки

Этот файл обязателен для людей и ИИ-агентов. В начале новой сессии прочитайте
`docs/FIT_WORKFLOW.md` и `docs/CURRENT_STATE.md`. Остальные документы открывайте
только релевантными разделами по таблице workflow — не загружайте всю
документацию без необходимости.

## Порядок работы

1. Сформулируйте пользовательский результат и acceptance cases.
2. Найдите существующий публичный контракт feature. Для parity-задачи сравните его с точным V1 baseline из `FEATURE_PARITY.md`: данные, состояния, действия и mobile visual. Не создавайте параллельный путь к тем же данным.
3. Если меняется БД: migration → SQL/RLS tests → generated types → query → repository → UI.
4. Добавьте happy path, validation, loading, empty, error и retry states.
5. Если изменилось пользовательское поведение, роли, доступы, навигация или известные ограничения, обновите `docs/PRODUCT_WIKI.md`. Описывайте только уже реализованный функционал; планы и идеи оставляйте в `docs/design` и `FEATURE_PARITY.md`.
6. Запустите `npm run check`; для DB-изменений также `npm run db:reset && npm run db:test`.
7. Обновите `docs/CURRENT_STATE.md` в той же ветке, когда фактура уже известна;
   после merge только сверьте snapshot с новым `main`. Отдельный docs-only PR
   нужен лишь для действительно новой post-merge фактуры. Это обязанность агента,
   а не пользователя.

## Постоянные договорённости с владельцем продукта

- Одна явно выбранная задача или один экран = одна ветка и один PR. Если
  пользователь заранее разрешил автономное завершение, агент сам ждёт зелёный
  CI, сливает PR, проверяет production и останавливается, не начиная следующий
  экран без отдельной команды. Красный PR не сливать и обязательные проверки не
  обходить.
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
- Локальные контейнеры и Supabase запускаются только через Podman. Docker у
  пользователя не установлен и не планируется; не предлагайте его установку.
- Desktop trainer и задачи P2 отложены до нового прямого решения пользователя.

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

- Компоненты и hooks не импортируют `@supabase/supabase-js` и не вызывают Supabase.
- `src/data/queries` — единственное место с Data API/RPC вызовами.
- `src/data/repositories` преобразует DB rows/errors в доменные DTO; SQL там запрещён.
- Feature использует другую feature только через её публичный `index.ts`.
- Не добавляйте generic repository/service, Redux или глобальный mutable state без ADR.
- Server state хранится в TanStack Query; route state — в URL; form state — в React Hook Form.
- Календарная дата — `LocalDate`, а не результат `toISOString()`.

## База данных

- Только timestamped migrations, применяемые Supabase CLI. Dashboard SQL запрещён.
- PK бизнес-сущностей: `uuid default gen_random_uuid()`.
- `created_at`: `default now()`; единственный trigger — общий `updated_at` trigger.
- Бизнес- и auth-trigger запрещены. Инициализация пользователя вызывается явно.
- Простая таблица меняется Data API запросом. Aggregate из нескольких таблиц — одной RPC-транзакцией.
- RPC не принимает `trainer_id`; использует `auth.uid()`, проверяет ownership и блокирует root при update.
- На exposed таблицах обязательны RLS, минимальные grants, `USING` и `WITH CHECK`.
- FK обязательны для aggregate children; snapshot/optional links могут быть логическими UUID.
- Архивные записи не участвуют в новых операциях, но история остаётся читаемой.

## Качество и безопасность

- Не используйте `select('*')`, `any`, небезопасные casts и проглоченные ошибки.
- Не коммитьте `.env`, DB password, secret/service-role/OAuth secret.
- Локальная разработка и тесты используют только локальный Supabase. Production URL и publishable key хранятся только в Vercel; не отключайте runtime-проверку этого правила.
- Для обычного локального запуска используйте `npm run dev`: команда сама запускает локальный Supabase. Не подменяйте `.env.development` удалённым проектом.
- Любая mutation должна подтверждать, что изменилась ожидаемая запись.
- Многошаговая запись обязана полностью откатываться при любой ошибке.
- Добавляйте тест на cross-tenant доступ для каждого нового tenant ID.
- Не копируйте legacy `src/db` или старые migrations; переносите только проверенное поведение.
- Старый источник называйте только `V1 baseline` или `legacy trainer-app`; не переносите в Fit V2 названия и URL исходных репозиториев.
- Не отмечайте parity-сценарий как `Implemented` по одному happy path: зафиксируйте проверяемый инвентарь V1 и тест на каждое обязательное поведение.

## Definition of Done

- Пользовательский сценарий отражён в `FEATURE_PARITY.md`.
- `docs/PRODUCT_WIKI.md` отражает актуальный пользовательский функционал и ограничения после изменения.
- Migration воспроизводится чистым `db reset`.
- Generated DB types актуальны.
- Unit/component/integration/E2E покрытие соответствует риску.
- `npm run check` зелёный; DB/RLS тесты зелёные для изменений БД.

# Fit UI / UX Engineering Rules

These rules apply to every UI task in addition to the architectural and product
rules above. The current product is the starting point; a generated component,
Figma frame, screenshot, or external registry is reference material, not a new
source of truth by itself.

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

Use the current light-premium palette, system typography, semantic tokens,
surface hierarchy, radii, shadows, and interaction patterns documented in
`docs/UI_DESIGN_SYSTEM.md`. Do not introduce a second token system, Tailwind,
new fonts, new brand colors, or a parallel component kit inside a feature task.

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
