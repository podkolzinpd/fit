# Gate 7 — Trainer Client Goal

Статус: **implemented; local validation complete**.

## Scope

- Trainer, точный `/clients/:id/goal`.
- Identity требует server-managed `monochrome_preview`.
- Client detail, create/edit, workouts, progress и schedule не меняются.

## Сохранённый контракт

- Goal/stage repositories, optimistic versions, dates, mutations, query keys и
  navigation после archive не менялись.
- Create, edit, empty stages, validation сроков, delete/archive confirmation,
  pending, loading/error/retry остаются реальными продуктовыми состояниями.
- Искусственные loading, empty, error или success состояния не добавлены.

## UI Identity v1

- Page `24/600`, sections `18/600`, body `14/400`, controls `14/500`, labels
  `12/500`, editable fields `16/400`.
- Goal/stages — neutral surfaces 18 px; вложенные stage rows и forms — 14 px.
- Все base actions — 48 px независимо от semantic priority. Current stage
  читается контуром и текстом; done не использует общую low-opacity.
- Archive/delete используют утверждённый danger только по семантике. Light/dark
  имеют одинаковую геометрию; coral, purple, glow и локальные hex отсутствуют.

## Проверки

- AppLayout route scope и flag-off: 73/73; typecheck passed.
- Flag-off и реальная create/date validation: 2/2 на mobile Chromium.
- Реальный visual-flow создаёт отдельного клиента, цель и этап, открывает обе
  edit-формы, проверяет archive-confirm и очищает созданные данные.
- Darwin/Linux visual: create/detail, light/dark, 390/430/1440 passed.
- Полный `npm run check`: 123/123 test files, 915/915 tests; API 225/225 при
  23 ожидаемых skips. CI, deployment и production smoke фиксируются в PR.

## Rollback

`monochrome_preview=false` возвращает экран цели к прежней identity без rollback
данных, API, repository logic или маршрутов.
