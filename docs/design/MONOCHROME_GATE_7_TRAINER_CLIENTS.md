# Gate 7 — Trainer Clients

Статус: **production preview; PR #663, deployment verified**.

## Scope

- Роль: Trainer.
- Identity применяется только к точному `/clients`.
- Route scope включается только при server-managed
  `actor.featureFlags.monochromePreview === true`.
- `/clients/new`, `/clients/:id`, edit, goal, workouts и progress в этой задаче
  не меняются.

## Сохранённый продуктовый контракт

- Query, refetch, сортировка по последней активности, archive visibility и
  переход в карточку клиента используют прежние данные и маршруты.
- Search сохраняет существующий порог показа, фильтрацию по имени и clear.
- Loading, query error/retry, empty list и empty search result возникают только
  из существующей логики; искусственные состояния не добавлялись.

## Применённая UI Identity v1

- Page `24/600`, client name `16/600`, metadata `12/500`, controls `14/500`,
  search input `16/400`.
- Client cards — neutral surface 18 px, avatar 44 px / 14 px, gap 8 px. Add —
  compact 44 px primary; empty action — base 48 px.
- Search — neutral 48 px sunken field. Empty/query states используют foundation
  surfaces и утверждённый danger только для реальной ошибки.
- Archive дублируется текстом. Unicode chevron заменён общим outline SVG.
- Light/dark сохраняют одинаковую геометрию; navigation active state neutral.
  Coral, purple, glow и локальные hex не добавлены.

## Проверки

- Route/component unit tests: 55/55; typecheck passed.
- Flag-off Chromium smoke: 1/1.
- WebKit overflow smoke: 3/3 на 360/375/390 px.
- Darwin visual: 3 passed, 3 ожидаемых role-profile skips. Linux visual: 3
  passed, 3 ожидаемых skips; соседние client detail, schedule и progress
  baselines в desktop suite остались неизменны.
- Полный `npm run check`: 123/123 test files, 893/893 tests; API 225/225 при
  23 ожидаемых skips. Обязательный CI прошёл полностью; PR #663 влит как
  `3760115`, production deployment `6152916140` успешен. Authenticated browser
  smoke заблокирован административной policy до navigation и остаётся ручным.

## Rollback

`monochrome_preview=false` возвращает `/clients` к прежней identity после
обновления authenticated session state. Откат не требует изменения client data,
API или маршрутов.
