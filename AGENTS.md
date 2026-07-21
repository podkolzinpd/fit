# Fit V2 — обязательные правила разработки

Этот файл обязателен для людей и ИИ-агентов. Перед изменением кода прочитайте `ARCHITECTURE.md` и соответствующий пункт `FEATURE_PARITY.md`.

## Порядок работы

1. Сформулируйте пользовательский результат и acceptance cases.
2. Найдите существующий публичный контракт feature. Не создавайте параллельный путь к тем же данным.
3. Если меняется БД: migration → SQL/RLS tests → generated types → query → repository → UI.
4. Добавьте happy path, validation, loading, empty, error и retry states.
5. Запустите `npm run check`; для DB-изменений также `npm run db:reset && npm run db:test`.

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
- Любая mutation должна подтверждать, что изменилась ожидаемая запись.
- Многошаговая запись обязана полностью откатываться при любой ошибке.
- Добавляйте тест на cross-tenant доступ для каждого нового tenant ID.
- Не копируйте legacy `src/db` или старые migrations; переносите только проверенное поведение.

## Definition of Done

- Пользовательский сценарий отражён в `FEATURE_PARITY.md`.
- Migration воспроизводится чистым `db reset`.
- Generated DB types актуальны.
- Unit/component/integration/E2E покрытие соответствует риску.
- `npm run check` зелёный; DB/RLS тесты зелёные для изменений БД.
