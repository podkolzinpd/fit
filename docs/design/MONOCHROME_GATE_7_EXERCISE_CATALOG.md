# Gate 7 — Exercise Catalog

Статус: **implemented; local validation complete**.

## Scope

- Trainer, точный `/exercises`.
- Identity требует server-managed `monochrome_preview`.
- Profile, Schedule, Trainer Progress и workout picker не меняются.
- Flag-off сохраняет прежний component tree и текущий UI.

## Сохранённый контракт

- System catalog, search ranking, images, technique instructions и metadata
  переиспользуются без изменения generated catalog или import pipeline.
- Custom exercise list/create/edit/archive/restore используют прежние query
  keys, repository mutations, optimistic versions и auth `user_id`.
- Новые API, database changes, workout mutations и искусственные product states
  не добавлены.

## UI Identity v1

- Page `24/600`, section `18/600`, body `14/400`, item names/controls `14/500`,
  labels `12/500`, search и editable fields `16/400`.
- System catalog — neutral searchable media library. Rows используют 14 px
  geometry; изображения остаются реальным content, а не accent surface.
- Detail — bottom sheet 18 px с существующим technique image, metadata и
  instructions. Light/dark сохраняют одинаковую геометрию.
- Base actions — 48 px, compact pagination/reset — 44 px. Disabled читаем без
  общей opacity; archive остаётся понятным danger action.
- Scoped CSS не содержит literal hex, coral, purple, gradient, glow или
  декоративных semantic fills.

## Реальные состояния и проверки

- Search result, no-result/reset, media fallback и detail open/close.
- Custom query loading/error/retry и empty/list states; create/edit,
  archive/restore, pending/disabled сохраняются в текущей product logic.
- AppLayout unit tests проверяют exact route, flag-off и no-leakage.
- Mobile Chromium проверяет flagged и unflagged accounts, search, media,
  detail transition, form availability и отсутствие horizontal overflow.
- Visual acceptance покрывает catalog result и открытый technique detail в
  light/dark на 390, 430 и 1440×1000.

## Rollback

`monochrome_preview=false` возвращает прежний Exercise Catalog без rollback
данных, API, repositories или маршрутов.
