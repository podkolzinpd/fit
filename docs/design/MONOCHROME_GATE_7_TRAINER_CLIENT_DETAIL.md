# Gate 7 — Trainer Client Detail

Статус: **implemented; local validation complete**.

## Scope

- Роль: Trainer; identity применяется только к точному `/clients/:id`.
- Server-managed `actor.featureFlags.monochromePreview` обязателен.
- `/clients/new`, edit, goal, workouts и progress не меняются.

## Сохранённый продуктовый контракт

- Profile, stats, upcoming workouts, goal, note, invitations, memberships и
  archive используют прежние queries, mutations и маршруты.
- Loading, error/retry, attention, empty goal/note и destructive confirmations
  возникают только из существующей продуктовой логики.

## UI Identity v1

- Page `24/600`, section/key data `18/600`, body `14/400`, labels `12/500`.
- Snapshot, goal, upcoming и note — neutral surfaces 18 px без dashboard grid.
- Plan — единственный base primary 48 px; History/Progress — secondary 48 px.
- Danger остаётся semantic; light/dark сохраняют одинаковую геометрию.
- Coral, purple, glow и локальные hex в route CSS не добавлены.

## Проверки

- AppLayout route tests: 57/57; typecheck passed.
- Flag-off Chromium: 1/1. WebKit overflow: 3/3 на 360/375/390 px.
- Darwin и Linux visual: light/dark на 390, 430 и Trainer 1440 прошли.
- Полный `npm run check`: 123/123 test files, 899/899 tests; API 225/225 при
  23 ожидаемых skips. CI, deployment и production smoke фиксируются в PR.

## Rollback

`monochrome_preview=false` возвращает прежнюю identity без изменения client
data, API или маршрутов.
