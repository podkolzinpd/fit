# Gate 7 — профиль тренера

Статус: **implemented; local validation in progress**.

## Scope

- Trainer, точный `/profile`.
- Identity требует server-managed `monochrome_preview`.
- Client Profile `/me/profile`, Join, Exercise Catalog и другие trainer routes
  не меняются.
- Flag-off сохраняет прежний UI и текущую продуктовую логику.

## Сохранённый контракт

- Имя, фамилия и часовой пояс используют прежний profile mutation, refresh,
  save/error states и cancel/reset.
- Theme, RPE, archived clients и body-map appearance сохраняют прежнее local
  preference поведение.
- Install panel, feedback form, Join, Exercise Catalog и logout используют
  существующие transitions, repositories и routing.
- Отдельные уведомления и подключения не добавлены: этих состояний нет в
  текущем trainer Profile product contract.

## UI Identity v1

- Page `24/600`, section `18/600`, body `14/400`, controls `14/500`, compact
  labels `12/500`, editable fields `16/400`.
- Profile form, settings, body-map selector, service actions и раскрываемые
  panels образуют последовательный settings workspace на neutral surfaces.
- Inputs и base actions — 48 px; segmented body-map modes — compact 44 px.
  Semantic priority не меняет высоту action.
- Logout использует danger только вместе с понятным текстом; success/error
  остаются семантическими состояниями сохранения или отправки.
- Light/dark имеют одинаковую геометрию. Scoped CSS не содержит literal hex,
  coral, purple, gradient, glow или декоративных semantic fills.

## Реальные состояния и проверки

- Profile edit, cancel/reset, saving/saved/error и readable disabled.
- Theme, RPE, archived clients и body-map controls.
- Install instructions/installed state из существующей install logic.
- Feedback kind, editable text, minimum-length disabled, submitting/error/sent.
- AppLayout unit tests проверяют exact trainer route, flag-off, client
  isolation и no-leakage.
- Chromium и WebKit проверяют controls, раскрываемые panels и отсутствие
  horizontal overflow.
- Visual acceptance покрывает base Profile и feedback в light/dark на 390,
  430 и 1440×1000.

## Rollback

`monochrome_preview=false` возвращает прежний Trainer Profile без rollback
данных, preferences, repositories или маршрутов.
