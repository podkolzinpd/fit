# Native и локальная legacy composition

Поток: identity-runtime. База: main `2048ffd8`, после #1636/#1638; rebase на `1f512b42` после #1632/#1641.

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

Vite alias `#fit/local-auth`, `#fit/local-data`, `#fit/local-assistant` выбирается только по точному build
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
- Полный `npm run check`: exit 0, frontend 2691/API 1387 passed + 156 standard
  DB skips, infra 275/hosting 158; lint/typecheck/coverage/build passed.
  Functions 82.77%, branches 76.95%, thresholds/exclusions прежние.
- Diff check: passed; exact-head CI — в связанном PR.

Import-only AppRoot test не сохранён: он дублировал проверку dependency graph
реальной production-сборкой и включал неподходящие UI surfaces в unit-метрику.
Unit остаётся для mode/guard/native auth, actual bundle — для всего графа, WebKit
— для поведения страниц. Coverage thresholds/exclusions не менялись.

CI 38655217481: все checks, кроме WebKit shard3, прошли. Trace показал, что
offline body-map fixture через AuthProvider загружала общий local registry и
`legacy-cloud-functions.ts`; её existing network guard закономерно блокировал
этот import. Local auth/data/Assistant разнесены в независимые build aliases;
fixture, assertions, timeouts и network isolation не изменены.

После разделения original body-map WebKit case passed (9.7s), все 54 targeted
auth/data/Assistant/parser cases passed. Existing auth-context tests теперь
запрещают imports workout/Assistant adapters, не добавляя функциональные дубли.
Финальные full check (frontend2691/API1387+156DBskip/infra275/hosting158/build),
production WebKit26/26 и release/development graphs прошли для исправленной
версии на main1f512b42; exact-head CI — в связанном PR.

Rebase на main `cb9799e8` (#1642, только same-origin hosting/proxy/policy files):
source/dependency/config diff приложения относительно проверенного `885ce795`
пуст. Targeted infra275/275 и hosting158/158 passed. Предыдущий exact-head CI
устарел из-за обязательного up-to-date gate; новый CI — в связанном PR.

Обновление PR #1640 от main `1ccf81d1` (15.10): rebase трёх commits
прошёл автоматически. Изменения удалённой ветки `430cfe9f` сохранены;
composition/auth/data/Assistant и build aliases совпадают с ней. Новые
SpeechKit/Cloud.ru изменения взяты из main без правок. Полный локальный
`npm run check` passed: frontend2695/API1418+159DBskip/infra302/hosting169,
coverage functions82.75/branches76.97%, production build/startup guard passed.
CI обновлённой ветки — отдельный гейт; browser suite отдельно не повторялась
локально при этом rebase (предыдущая приёмка выше, новый прогон — в CI).
