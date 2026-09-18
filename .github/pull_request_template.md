## Пользовательский результат

<!-- Какой сценарий меняется и какой пункт FEATURE_PARITY.md закрывается? -->

## Архитектура и БД

- [ ] UI/feature использует provider-neutral контракт и не ветвится по backend
- Backend scope: `не затрагивается / Supabase / Yandex / обе реализации`
- Cutover stream: `не затрагивается / identity-runtime / data-media / assistant-ops / product`
- Зависит от PR: `нет / ссылка`
- Feature flag и поведение до/после cutover: `не требуется / описание`
- [ ] Для общего data-контракта проверены эквивалентные Supabase/Yandex adapters
- [ ] Migration добавлена, если меняется схема/RLS/RPC
- [ ] Обе migration chain, schema parity и tenant catalog проверены, если применимо
- [ ] Generated types обновлены
- [ ] Ownership/RLS и atomicity проверены
- [ ] Секреты и персональные данные не добавлены

## Проверки

- [ ] `npm run check`
- [ ] `npm run db:reset && npm run db:test` (для DB-изменений)
- [ ] Релевантный Playwright сценарий
