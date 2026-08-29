# Gate 8 — Assistant

Статус: **implemented; local acceptance complete**.

## Scope и инварианты

- Точный trainer-only route `/assistant`.
- Существующий Assistant pilot и allowlist не расширяются.
- История, read-only archive, empty first entry, user/assistant messages,
  error/retry, composer и voice states.
- Client collection/confirm/choices, workout collecting/ambiguity/draft/result,
  program brief/confirm, progress period/confirm/inline summary и applied result.
- LLM orchestration, matching, fallback, queries, mutations, storage keys,
  repositories, RLS, data contracts и тексты продукта не меняются.

## UI Identity v1

- Route получает `assistant-identity` только при включённом monochrome rollout;
  `off` возвращает прежний CSS и component tree.
- Onest: title `18/600`, body `14/400`, controls `14/500`, labels `12/500`,
  editable fields `16/400`, key metrics `18/600`.
- User message — graphite/milk polar surface; assistant answer — спокойный
  typographic block. Structured results и active context занимают полную ширину.
- Cards, receipts, inputs and metrics use accepted neutral surfaces and
  `10 / 14 / 18` geometry, without gradients, glow, shadows, coral or purple.
- Base actions — 48 px; explicit compact controls — 44 px. Semantic priority
  does not change height. Disabled keeps readable text without global opacity.
- Success/danger apply only to actual saved/error/recording semantics and are
  always accompanied by text or a recognizable icon.
- Light/dark use identical markup and geometry; the accepted dark theme does
  not inherit the old purple `theme-dark-pilot`.

## Реальные состояния

- Empty today session and starter actions.
- Today conversation, archived history and read-only composer.
- Short/long user turns, assistant copy, loading, error with retry.
- Dictation receipt, saved workout result and inline progress summary.
- Client, program, progress and workout action cards.
- Workout parsing, unmatched choice, editable metrics, pending, disabled,
  save success/error and cancellation.
- Mobile keyboard viewport, fixed navigation and inner draft scrolling.

Искусственные product states не добавлены.

## Проверки

- AppLayout route scope, global `on`, global `off`, no leakage and dark pilot
  separation.
- Assistant domain/unit suite and layout contracts.
- Mobile Chromium: alignment, message rhythm, result/error hierarchy, 44 px
  targets, composer, workout inner scroll, keyboard viewport and no glow.
- Visual audit: 390 and 430 mobile plus 1440 trainer viewport, light/dark;
  conversation, success/error, dictation receipt, workout draft and composer.
- Mobile Chromium — 12/12; iPhone/WebKit — 12/12.
- Full project check зелёный: 123 app files / 966 tests, 225 API tests,
  typecheck, lint, coverage, DB types, iOS permissions, infra policy и
  production build.
- CI, merge and production deploy remain gates before Task 26 is marked
  delivered.

## Rollback

Set `VITE_MONOCHROME_ROLLOUT_MODE=off` and redeploy. No assistant data,
conversation, action or model rollback is required.
