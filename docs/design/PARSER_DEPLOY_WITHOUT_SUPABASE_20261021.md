# Parser deploy без Supabase — 21.10.2026

## Подтверждённая постановка

> Давай удалим supabase-public-key.ts с тестами и Supabase credentials из deploy Yandex parser, поправим FIT_API_BASE_URL и проверим контракт. Промпты и native-поведение сохраняем. Дождись зелёного CI.

База: main `d060cab9b2be3605fe5699aa17dc9d0340c9d5d4`, поток assistant-ops. По прямой просьбе пользователя подлит main `beb1a3bb` (#1763); пришли только документы/синтетические материалы Lime, конфликты отсутствуют, runtime/dependencies не менялись. Новые UI-правила прочитаны, к этой server/deploy задаче UI-приёмка не применима. Проверяется локальная ветка; UI/роли/темы/флаги не меняются. Production и удалённый deploy не проверялись и не запускаются этой задачей. Supabase public-key helper вызывается только своими пятью тестами. Parser handler уже проксирует Fit session в native API, но workflow не передавал обязательный base URL. Canonical production origin подтверждён существующими Android builds и OPERATIONS.

| Уже работает | Переиспользуем | Меняем | Не проверено |
| --- | --- | --- | --- |
| Native parser/goal proxy | Handler, Fit session, immutable native mounts, release verifier/rollback | Workflow env/mounts, orphan helper/tests, contract tests | Remote deploy/paid AI calls |

## Acceptance

1. Удалить `services/api/src/legacy-summary/supabase-public-key.ts` и `src/data/summary-public-key.test.ts`: пять тестов проверяют только удаляемый orphan helper; runtime callers нет.
2. Удалить только SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY mounts parser workflow. Остальные native credentials, immutable Lockbox version, resource names и release verifier/rollback сохранить. Сам Lockbox и remote credentials не менять.
3. Передавать FIT_API_BASE_URL=https://api.fit-training.ru в создаваемую ревизию parser. Закрепить config/mount в существующем workflow policy test.
4. Расширить существующий parser function test: workout/goal routes, Fit app/pilot headers, request/response passthrough, missing base URL безопасно возвращает503 без fetch, upstream403 передаётся без fallback. Исправить устаревшее название JWT-теста; не дублировать CORS/session assertions. Новые cases ловят отсутствие deploy URL и ошибки proxy-контракта; browser матрица не меняется.
5. Prompts, parser/proxy runtime, native API, media и остальные Cloud Functions/workflows не менять. Миграции/БД не затронуты.
6. Выполнить targeted tests, полный check по classifier и дождаться зелёного CI точного head.

## Проверки

Локально passed: parser function 6/6, workflow policy 2/2, bash syntax 4/4 blocks; полный `VITEST_MAX_WORKERS=4 npm run check`: frontend2784/API1438+186conditionalDBskip/infra330/calendar12/hosting184, lint/typecheck/build/startup. Runtime/prompts неизменны по diff к main. CI точного head — обязательный гейт PR. Тяжёлые browser suites, защищённые inventory/baselines и CI gates не меняются; замера их ускорения нет. DB и remote/paid проверки для этого diff не требуются.
