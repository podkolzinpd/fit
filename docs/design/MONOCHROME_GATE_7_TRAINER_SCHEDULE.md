# Gate 7 — Trainer Schedule

Статус: **production preview deployed**.

## Scope

- Trainer, точный `/schedule`.
- Identity требует server-managed `monochrome_preview`.
- Workout create/detail, Trainer Progress, Exercises и Profile не меняются.

## Сохранённый контракт

- Query keys, pagination, date URL, week navigation, auto-focus hour, internal
  scroll, workout links и back-navigation не менялись.
- Timed/untimed events, planned/current/partial/done/skipped/decision statuses,
  loading/error/retry и empty day остаются текущей продуктовой логикой.
- Искусственные loading, empty, error или success состояния не добавлены.

## UI Identity v1

- Page `24/600`, month `18/600`, selected date `14/600`, controls/events
  `12/500`, secondary event content `12/400`.
- Today/date/week controls — compact 44 px; selected day — primary fill внутри
  одной neutral week surface; `Запланировать` — compact primary 44 px.
- Planned events нейтральны. Semantic states используют edge + текст на neutral
  surface, а не декоративные semantic fills. Цвет не является единственным
  обозначением статуса.
- Light/dark имеют одинаковую геометрию. Coral, purple, glow, shadows и локальные
  hex в scoped CSS отсутствуют.

## Проверки

- AppLayout route scope, flag-off и schedule presentation: 86/86; typecheck passed.
- Flag-off и реальные week/date controls: 2/2 на mobile Chromium.
- Реальный visual-flow использует seed-клиента, создаёт planned workout на
  отдельной фиксированной дате каждого viewport, проверяет event card и всегда
  удаляет тренировку через `finally`, чтобы не загрязнять следующие baseline.
- Darwin/Linux visual: event workspace, light/dark, 390/430/1440 passed.
- Полный `npm run check`: 123/123 test files, 923/923 tests; API 225/225 при
  23 ожидаемых skips. Финальный CI полностью зелёный. Production deployment
  `6154311630` завершён успешно; browser smoke заблокирован admin policy и не
  обходился.

## Rollback

`monochrome_preview=false` возвращает Schedule к прежней identity без rollback
данных, API, repository logic или маршрутов.
