# Gate 7 — Workout Create/Edit

Статус: **implemented; local validation complete**.

## Scope

- Роли: Client и Trainer в существующем общем workout lifecycle.
- Identity применяется только к `/workouts/new`, `/workouts/:id/edit`,
  `/today?view=review|save` и `/me?view=review|save`.
- Route scope включается только при server-managed
  `actor.featureFlags.monochromePreview === true`.
- Workout detail, completion, history и Live не меняются в этой задаче.

## Сохранённый продуктовый контракт

- Voice, text и catalog по-прежнему создают тот же draft; parse, ambiguity,
  review, plan/fact, assignment и save используют прежние данные и порядок.
- Создание и редактирование сохраняют прежние validation, API/RPC, права,
  mutation и переходы после Save/Cancel.
- Picker, overflow actions, fixed save bar, planned/fact sets и запись результата
  работают через существующие компоненты; параллельная форма не создавалась.
- Искусственные loading, empty, error или success states не добавлялись.

## Применённая UI Identity v1

- Page `24/600`, section `18/600`, body `14/400`, controls/meta `14/500` и
  `12/500`, editable fields `16/400`.
- Sections и exercise cards используют neutral surfaces 18 px; поля, segmented
  controls и composer — 14 px. Нет coral, purple, glow и локальных hex.
- Base actions — 48 px, compact controls — 44 px независимо от semantic
  variant. Иерархию создают fill, contrast и visual weight.
- Disabled остаётся читаемым без общей low-opacity. Destructive использует
  утверждённый danger semantic только вместе с понятным действием.
- Light/dark сохраняют одинаковую геометрию; graphite primary меняет полярность
  на milk primary, dark surfaces проверяются отдельно.

## Реальные состояния и visual review

- Empty plan с disabled Save; completed/fact с заполненным подходом; catalog
  picker; review; save; light и dark.
- Client viewports: 390×844 и 430×932. Trainer review/save: 1440×1000.
- Для Darwin и Linux закоммичены отдельные baseline. Каждый screenshot state
  изолирован, чтобы draft из completed flow не маскировал чистую dark-форму.
- У пользователя без preview-флага формы и review/save сохраняют прежнюю
  identity; email не участвует в routing или UI-условиях.

## Проверки

- AppLayout route scope: enabled и disabled cases для всех четырёх route family.
- Chromium: полный быстрый start → review → save; отдельный flag-off smoke.
- WebKit: mobile create/catalog/fixed action и запись результата прошлого плана.
- Native visual: 18 passed, 3 ожидаемых desktop skips; Linux exact comparison:
  18 passed, 3 ожидаемых desktop skips.
- Полный `npm run check`, CI, deployment и production smoke фиксируются в PR до
  перехода к задаче 14.

## Rollback

`monochrome_preview=false` возвращает все перечисленные маршруты к прежней
айдентике после обновления authenticated session state. Немигрированные detail,
completion и history не получают `workout-create-edit-identity` при любом
значении флага.
