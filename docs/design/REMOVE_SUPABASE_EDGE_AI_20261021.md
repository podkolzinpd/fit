# Удаление старых Supabase Edge AI Functions — 21.10.2026

## Подтверждённая постановка (без изменений)

> Давай удалим старые Supabase Edge Functions parse-workout и summarize-client-training с deploy-workflows, тесты и smoke переведём на native core. Промпты, Yandex Cloud Functions и media сохраняем. Дождись зелёного CI.

## Preflight и границы

Поток: assistant-ops. База: main `162ce7892c7ceaab0b156a37c2b037e0688eaa37`.
Пользовательский результат: в репозитории нет двух старых Supabase Edge AI endpoints и способов их deployment; тесты и smoke используют существующий native core.
API/БД/роли/флаги/UI не меняются; DB migration и локальная PostgreSQL/RLS проверка не требуются. Удалённых ресурсов, secrets и данных задача не касается.

| Уже работает | Переиспользуем | Действительно меняем | Не проверено |
| --- | --- | --- | --- |
| Native parser и summary | `services/api/src/legacy-workout-parser.ts`, `legacy-summary/*` | Две Edge Functions и deploy-workflows, config entry, тестовые импорты и smoke | Удалённые функции и платные LLM-вызовы |

До удаления `summary-contract.ts` и `summary-quality.ts` побайтно совпадают с native core; остальные helpers совпадают либо отличаются только типами/комментарием ESLint. Прямой импорт двух native TS-модулей smoke работает на Node 26.5.

## Acceptance и соответствие покрытия

1. Удалить только `supabase/functions/parse-workout`, `supabase/functions/summarize-client-training`, их два deploy-workflow и запись summary в config.toml.
2. Перевести восемь helper test suites на существующие native-модули без удаления assertions. Public-key helper пока сохраняется в native-каталоге; его отдельное удаление не входит в scope.
3. Старое сравнение prompt/schema двух одинаковых копий → до удаления подтверждено byte equality; после удаления один canonical native contract. Уникальная проверка обращения по роду → уже покрыта `services/api/src/legacy-summary/core.test.ts` (включая исходную фразу).
4. Старый static parser budget test → `legacy-workout-parser.test.ts`: 1200 tokens, один вызов при invalid response/503; goal retry уже проверяет два вызова. Тест возможности Supabase deploy удаляется вместе с retired deployment.
5. Smoke импортирует native prompt/schema/quality, использует process env по умолчанию и сохраняет явный env-file CLI. Offline test проверяет реальный CLI request, quality retry и маскирование ошибки без сетевых LLM-вызовов.
6. Native runtime, prompts, Yandex Cloud Functions/workflows и media остаются без изменений относительно base.
7. Целевые тесты, полный `npm run check`, diff review и зелёный CI точного head обязательны. Результаты ниже заполняются после проверки.

## Проверки

Локально: helper suites 49/49; offline smoke 3/3. Полный `VITEST_MAX_WORKERS=4 npm run check` прошёл: frontend 2789/2789, API 1434/1434 (186 conditional DB skipped), infra 330/330, calendar 12/12, hosting 184/184; lint/typecheck/build/startup зелёные. 899 native/API/shared/features/Yandex workflow файлов сверены побайтно с base без изменений; diff check чистый. CURRENT_STATE — 120 строк.

CI точного head остаётся обязательным гейтом PR. Browser/visual в CI выбираются существующим classifier; его правила, инвентарь и baseline не меняются. Локальные UI/production/remote deploy/платный smoke не запускались: продуктовый runtime не меняется. Измерения ускорения тяжёлых наборов нет; browser матрица неизменна.

После удаления только `scripts/supabase-database-scope.test.mjs` содержит старый Edge path как синтетический вход policy-классификатора (не импорт и не deploy). Исторические docs/allowlist classifier сохраняются; никаких исполняемых импортов удалённых функций нет.
