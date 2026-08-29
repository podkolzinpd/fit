# Gate 9 — Task 27: theme parity and accessibility

Статус: **implemented, merged and deployed; final release matrix is recorded
in `MONOCHROME_GATE_9_RELEASE.md`**.

## Scope и инварианты

- Все route-scoped экраны UI Identity v1, включая public auth family.
- Light и dark проверяются как самостоятельные палитры, а не автоматическая
  инверсия.
- Product logic, routes, data contracts, roles, OAuth, Assistant orchestration,
  feature flag и legacy UI не меняются.
- `VITE_MONOCHROME_ROLLOUT_MODE=off` остаётся единым rollback-механизмом.

## Автоматический контракт

- Каждый реальный visual state перед screenshot проверяет accessible names,
  touch targets не менее 44 px и отсутствие page-level horizontal overflow.
- Контраст фактических CSS token pairs проверяется для primary/secondary text,
  tinted surfaces, primary action, success и danger в light/dark; порог обычного
  текста — WCAG AA `4.5:1`.
- Общий `focus-visible` fallback действует на native controls, links, summary и
  explicit tabindex внутри новой identity и auth family.
- `prefers-reduced-motion: reduce` ограничивает animation/transition duration,
  отключает повтор и smooth scrolling, включая pseudo-elements.
- SVG body map учитывает существующий прозрачный stroked hit target, а не только
  bounding box видимой мышцы.

## Исправленные реальные нарушения

- Native select на auth, Client Card и Exercise Catalog получил фиксированную
  48 px высоту: одного `min-height` мобильному движку было недостаточно.
- Progress period refresh и side switch, а также вопрос тренеру в Workout
  Detail получили compact target 44 px.
- Exercise Catalog search clear увеличен с 36 до 44 px.
- Trainer Schedule перестроил week controls без горизонтального overflow:
  стрелки и семь дней теперь имеют фактические targets не менее 44 px.
- Disabled, semantic colours и light/dark geometry не меняли продуктовую
  семантику.

## Проверки

- Isolated auth, Client Card, Exercise Catalog, Client/Trainer Progress,
  workout detail, Trainer Client form и Trainer Schedule checks.
- Mobile 390 visual route matrix: 29 passed, 2 profile-scoped skips. Client
  Detail baseline закреплён на собственном clean seed и больше не зависит от
  тренировки, созданной соседним тестом.
- Отдельный Chromium smoke покрывает WCAG token contrast, keyboard focus и
  reduced motion: 2/2.
- Full project check зелёный: 123 app files / 966 tests, 225 API tests,
  typecheck, lint, coverage, DB types, iOS permissions, infra policy и build.
- Task 28 завершает финальную matrix 390/430/1440, WebKit/iOS safe areas,
  production evidence и release report в `MONOCHROME_GATE_9_RELEASE.md`.

## Rollback

Set `VITE_MONOCHROME_ROLLOUT_MODE=off` and redeploy. CSS, data and database
rollback are not required; legacy UI remains in the bundle.
