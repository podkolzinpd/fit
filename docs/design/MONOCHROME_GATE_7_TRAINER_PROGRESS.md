# Gate 7 — Trainer Progress и замеры

Статус: **implemented; local validation in progress**.

## Scope

- Trainer, точный `/progress/:clientId`.
- Реальные состояния `view=running` и `view=measurements` входят в ту же задачу.
- Identity требует server-managed `monochrome_preview`.
- Client `/me/progress`, Client Detail, Schedule, Exercises и Profile не меняются.

## Сохранённый контракт

- Query keys, repositories, realtime, summary generation, periods, body-map,
  chart drag, measurement CRUD, custom metrics и duplicate-date flow не менялись.
- Summary, running, measurements, create/edit form, history, settings,
  loading/error/retry и dialog/sheet остаются реальными product states.
- Искусственные loading, empty, error или success состояния не добавлены.

## UI Identity v1

- Page `24/600`, section `18/600`, body `14/400`, labels/controls `12/500`,
  editable fields `16/400`, key numbers `18–40/600`.
- Progress остаётся одним вертикальным data workspace без dashboard grid.
  Neutral surfaces 18 px, вложенные controls/rows 14 px, без декоративных
  gradients, glow и shadows.
- Периоды и mode controls — compact 44 px. Measurement actions — base 48 px;
  primary определяется fill/contrast, а не высотой.
- Success, warning и danger используются только по реальной семантике и вместе
  с текстом. График и выбранная метрика используют основной monochrome цвет.
- Light/dark имеют одинаковую геометрию. Scoped CSS не содержит literal hex,
  coral или purple.

## Проверки

- AppLayout route scope, query states, flag-off и no-leakage покрыты unit tests.
- Mobile Chromium проверяет flag-off, summary, measurement form, history,
  metric settings и отсутствие horizontal overflow.
- Visual acceptance покрывает summary и открытую реальную measurement form в
  light/dark на 390, 430 и 1440×1000.
- Полный CI, deployment и production smoke фиксируются в PR.

## Rollback

`monochrome_preview=false` возвращает Trainer Progress к прежней identity без
rollback данных, API, repositories или маршрутов.
