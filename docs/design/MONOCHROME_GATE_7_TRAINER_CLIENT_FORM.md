# Gate 7 — Trainer Client Create/Edit

Статус: **implemented; local validation complete**.

## Scope

- Trainer `/clients/new` и точный `/clients/:id/edit`.
- Identity требует server-managed `monochrome_preview`.
- Detail, goal, workouts, progress и client self-edit не меняются.

## Сохранённый контракт

- React Hook Form, Zod schema, create/update/preferences mutations, optimistic
  version и navigation после save не менялись.
- Реальные validation, pending, loading/error/retry edit-state и voice note
  остаются продуктовой логикой, искусственные состояния не добавлены.

## UI Identity v1

- Page `24/600`, section `18/600`, body `14/400`, labels `12/500`, fields `16/400`.
- Neutral surfaces 18 px, fields/actions 48 px, одинаковая геометрия light/dark.
- Cancel — secondary, Save — primary. Trainer-only surface нейтральна.
- Coral navigation, purple/glow и локальные hex отсутствуют.

## Проверки

- AppLayout: 65/65; typecheck passed.
- Flag-off + реальная validation: 2/2.
- WebKit keyboard/overflow: 4/4 на 360/375/390 px.
- Darwin/Linux visual: create/edit, light/dark, 390/430/1440 passed.
- Полный `npm run check`: 123/123 test files, 907/907 tests; API 225/225 при
  23 ожидаемых skips. CI, deployment и production smoke фиксируются в PR.

## Rollback

`monochrome_preview=false` возвращает обе формы к прежней identity без rollback
данных, API или маршрутов.
