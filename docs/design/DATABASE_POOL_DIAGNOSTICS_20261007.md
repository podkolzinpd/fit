# Диагностика бюджета соединений — 2026-10-07

Результат: отличать ожидание локального пула от ошибок подключения к PostgreSQL
и проверить запас общего runtime-бюджета, прежде чем менять лимиты.
Публичные API/DTO, SQL, RLS, схема, UI, retries и scaling не меняются.

## Acceptance checklist

1. Добавить диагностику времени получения соединения, очереди, занятых/свободных
   соединений и ошибок подключения без SQL, секретов и персональных данных.
2. Проверить и документировать общий бюджет соединений API и dispatcher.
3. Не менять connection limits, pool size, scaling, pooling mode, IAM или схему;
   не выполнять нагрузочные тесты production.

## Проверка

| Пункт | Результат | Доказательство | Статус |
| --- | --- | --- | --- |
| 1 | Агрегат `database_pool_window`, стабильная роль процесса, безопасный код/category, high-water snapshots | `services/api/src/db/pg-pool.test.ts`: queue, fast acquisition, failure, bounds, privacy, release; targeted16/16 и API1186/1186 | Локально проверено; CI/deployment впереди |
| 2 | Формула с runtime preflight и перекрытием ревизий; 20 — общий лимит пользователя, не каждого контейнера | `OPERATIONS.md`, `database.tf`, `container.tf`, `variables.tf`, deployment workflow; console readback7октября: runtime20/owner5, SESSION, API8/min1, dispatcher1 | Код и cloud-конфигурация проверены; фактическая нагрузка production ещё не измерена |
| 3 | Defaults и overrides сохранены, только observability и документация | Тест defaults/overrides и diff review; Terraform/schema/UI не изменены | Локально проверено |

`npm run check`: lint/typecheck/frontend2477/db-types/iOS permissions/media/
infra/calendar/hosting115 прошли; API-параллельный прогон упёрся в timeout5s
неизменённого tenant-migration bundle compression test. Последовательный **весь**
API-набор `npm run test -- --maxWorkers=1` прошёл1186/1186 (100 actor/RLS skipped
без локальной DB); API lint/typecheck/build и корневой build тоже прошли.
Ни timeout, ни assertions, ни исходный тест не менялись. CI остаётся обязательным.

Связанный YAFIT-тикет не создан: в этой сессии нет доступного Tracker connector.
Это явно не является доказательством проверки production. Пользовательские
экраны/контракты не меняются; UI/WebKit/native проверки этой правке не нужны.
DB migrations/clean-chain/RLS не изменены, локальные тесты не используют
production credentials. Нагрузочное испытание и изменение лимитов — отдельное
решение после наблюдения.
