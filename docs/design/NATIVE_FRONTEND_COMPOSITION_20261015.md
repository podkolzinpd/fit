# Native и локальная legacy composition

Поток: identity-runtime. База: main `2048ffd8`, после #1636/#1638.

## Согласованное решение

«Следующим рекомендую разделить native и legacy composition в
DataBackendProvider, AuthProvider и Assistant. Это позволит убрать SDK из
production-графа, сохранив локальные legacy-тесты».

## Acceptance

1. Release-сборки web/Android/iOS не содержат Supabase SDK, legacy client или
   локальную composition. Режимы development/test сохраняют локальные adapters.
2. Auth, DataBackend и Assistant выбирают adapters на явной границе composition;
   release не выбирает legacy при отсутствующей, просроченной или чужой native
   session. Refresh/logout/cache clearing сохраняются.
3. Helper imports тренировок/шаблонов и notification kinds независимы от
   transports. Public profile сохраняет cache/404/errors, invitation preview и
   диагностический legacy transport доступны только локально. Parser/matching,
   prompt, сохранение и SpeechKit не меняются.
4. Проверка реального production graph останавливает build при попадании SDK,
   legacy client или local composition в любой emitted chunk. Type-only
   контракты не считаются runtime dependencies.
5. Existing local contracts, native import boundary, production WebKit и
   `npm run check` проходят; final diff и exact-head CI проверены перед handoff.

## Реализация

Vite alias `#fit/local-legacy-composition` выбирается только по точному build
mode: development/test -> local composition; любой другой -> native-only
composition с запрещённым legacy getter. Это не runtime feature flag и не
fallback после API ошибки. TypeScript paths описывают общий контракт, Vite
определяет фактическую реализацию. Local SDK остаётся ленивым.

Public profile и summary diagnostic используют отдельный query transport;
local-only dynamic imports исключаются release build. Старые repository exports
сохраняются для совместимости. Existing component tests сохраняют assertions;
изменён только mock-путь вынесенного public profile repository.

Новых таблиц/API/schema, migrations, RLS/grants, deployment, flags/allowlists,
UI primitives, токенов, текстов или новых пользовательских действий нет.
Server-side bridges/media, rollback history, Supabase package и frozen local
DB/E2E остаются. Production и secrets не меняются.
`local:verify` не требуется: нет изменений схемы, SQL, прав или продуктовых queries.

## Проверки

- Existing affected feature/repository contracts: 1108/1108 passed.
- Native AuthProvider импортируется с throwing mocks SDK/client; при отсутствии
  старого auth flag refresh/logout используют native session и очищают cache.
- Новые mode/module guard cases проверяют release isolation, включая Windows
  separator. Они ловят dependency regression, не дублируют функциональную матрицу.
- Первоначальный real build guard обнаружил legacy invitation import; после
  его изоляции production graph без SDK/client/local composition прошёл.
- Production WebKit native/auth/profile/chat/goals/workouts/nutrition: 26/26
  passed, без изменения specs/fixtures; light/dark 390/430/1440 px.
- Real production stale-env canary: 6 JS chunks, SDK/client/local composition
  и synthetic URL/key не включены. Реальный explicit development build сохраняет
  local composition и SDK, в том числе при production bundler semantics.
- Полный `npm run check`: exit 0, frontend 2683/API 1387 passed + 156 standard
  DB skips, infra 275/hosting 158; lint/typecheck/coverage/build passed.
  Functions 82.76%, branches 76.93%, thresholds/exclusions прежние.
- Diff check: passed; exact-head CI — в связанном PR.

Import-only AppRoot test не сохранён: он дублировал проверку dependency graph
реальной production-сборкой и включал неподходящие UI surfaces в unit-метрику.
Unit остаётся для mode/guard/native auth, actual bundle — для всего графа, WebKit
— для поведения страниц. Coverage thresholds/exclusions не менялись.
