# UI Identity retirement — 2026-08-30

Статус: завершено в `cleanup/ui-identity-retirement`.

## Принятое решение

Foundation UI Identity v1 становится единственным production UI. Не создаётся
новый feature flag или альтернативная тема. Product logic, данные, маршруты и
доступы не меняются.

## Последовательность

- [x] Удалить runtime-режимы rollout `on / preview / off`.
- [x] Удалить чтение `monochrome_preview` из authenticated session и domain.
- [x] Удалить route-scoped old/new branches и legacy Exercise Catalog.
- [x] Свести light/dark к одной production theme system без dark pilot runtime.
- [x] Удалить preview seed и отдельный RLS-тест feature flag.
- [x] Закрыть историческую feature-flag таблицу для frontend-ролей.
- [x] После merge Progress повторно обновиться от `main` и пересканировать
  замороженные файлы.
- [x] Удалить оставшиеся legacy CSS, old-theme tokens и `theme-dark-pilot`.
- [x] Обновить пересекающиеся E2E/visual baselines.
- [x] Выполнить полный check, visual regression и финальный zero-search.

## Замороженные пересечения с Progress

До merge ветки `feat/yafit-414-progress-visual-shell` не переписываются:

- `src/styles.css`;
- `src/features/progress/TrainingSummaryCard.tsx` и тест;
- `e2e/client-progress.spec.ts`;
- `e2e/mobile-shell.webkit.spec.ts`;
- `e2e/ui-visual.spec.ts` и Progress snapshots;
- `docs/CURRENT_STATE.md`, `docs/PRODUCT_WIKI.md` и актуальная Progress roadmap.

После merge эти файлы сканируются заново от актуального `main`. Старые
селекторы и baselines удаляются только по фактической достижимости нового UI.

## Database guardrail

Runtime больше не читает `public.user_feature_flags`; grants для `anon` и
`authenticated` отозваны, seed и RLS-test удалены. Репозиторий запрещает
автоматический destructive DDL, поэтому физический `drop table` выполняется
отдельным согласованным manual rollout после проверки внешних consumers. До
этого момента сгенерированный schema type сохраняет историческую таблицу как
факт схемы, но application/domain types и queries её не используют.

## Acceptance

- один production UI и одна light/dark theme system;
- нет runtime rollback branches и UI feature flags;
- после Progress merge нет живых coral/purple tokens, glow, gradients или
  old-theme selectors;
- исторические migration/design records не считаются живой runtime-
  зависимостью и не переписываются задним числом.

## Результат

- Живой application/e2e scope: 0 rollout branches, 0 `theme-dark-pilot`,
  0 `monochrome_preview`, 0 `LegacyExercisesPage`, 0 coral/purple literals,
  0 decorative gradients/glow/shadows.
- Корневой класс бывшего preview переименован в нейтральный `ui-identity`.
- Visual regression на чистом seed: Client 390 — 30/30, Client 430 — 30/30,
  Trainer 1440 — 17/17 применимых сценариев.
- Полный `npm run check` прошёл: 908 app tests, 64 infrastructure tests,
  230 API tests, lint, typecheck, DB types, iOS permissions и production builds.
- Единственное намеренно сохранённое наследие — историческая forward-only
  migration и соответствующий generated DB type физически существующей
  `public.user_feature_flags`. Runtime её не читает, frontend grants отозваны;
  physical drop остаётся отдельной ручной destructive-операцией.
