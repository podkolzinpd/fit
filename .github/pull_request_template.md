## Пользовательский результат

<!-- Какой сценарий меняется и какой пункт FEATURE_PARITY.md закрывается? -->

## Архитектура и БД

- [ ] UI не обращается к Supabase напрямую
- [ ] Migration добавлена, если меняется схема/RLS/RPC
- [ ] Generated types обновлены
- [ ] Ownership/RLS и atomicity проверены
- [ ] Секреты и персональные данные не добавлены

## Проверки

- [ ] `npm run check`
- [ ] `npm run db:reset && npm run db:test` (для DB-изменений)
- [ ] Релевантный Playwright сценарий
