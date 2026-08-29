# Gate 6 — Client Card Edit

Статус: **implemented; local validation complete**.

## Scope

- Роль: Client.
- Новый route scope: только `/me/edit`.
- Существующий `/me` first-run уже использует принятую Client Home identity;
  его разметка и поведение в этой задаче не дублируются и не меняются.
- Identity включается только при server-managed
  `actor.featureFlags.monochromePreview === true`.
- Trainer create/edit forms и workout lifecycle `/me?view=review|save` не
  меняются.

## Сохранённый продуктовый контракт

- Загружается прежняя собственная карточка клиента; имя, пол, возраст, рост и
  цель используют прежнюю схему, repository mutation и optimistic version.
- Save по-прежнему обновляет карточку, refresh-ит actor и ведёт в `/me`;
  Cancel ведёт в `/me/profile` без мутации данных.
- Loading, error/retry и отсутствие карточки возникают только по существующим
  условиям `AsyncView`. Искусственные состояния не добавлялись.
- API/RPC, права, validation, русские тексты и product logic не менялись.

## Применённая UI Identity v1

- Page title `24/600`, section `18/600`, labels `12/500`, helper/body `14/400`,
  editable content `16/400`.
- Форма собрана как одна нейтральная surface 18 px; поля используют sunken
  surface 14 px, без gradients, glow, coral, purple и локальных оттенков.
- Cancel и Save имеют одинаковую базовую высоту 48 px. Иерархию создают fill и
  contrast: secondary остаётся прозрачным, primary меняет полярность в dark.
- Disabled не использует общую low-opacity; focus остаётся заметным в обеих
  темах. Геометрия light/dark совпадает.
- Bottom navigation переиспользует утверждённый клиентский pattern без нового
  active-state компонента.

## Visual review

- Committed full-page light/dark baselines: 390 и 430 px для Darwin и Linux.
- Проверены длинная цель, парные числовые поля, native select/number controls,
  safe area, нижняя навигация и отсутствие horizontal overflow.
- Новый аккаунт без preview-флага явно не получает identity class на
  `/me/profile` и `/me/edit`.

## Проверки

- AppLayout route scope: 31/31 tests.
- Chromium flag-off/profile coverage: 2/2.
- WebKit реальный create/save/cancel/reload flow: 1/1.
- Native light/dark visual 390/430: 2/2; exact Linux no-update comparison
  390/430: 2/2.
- Полный `npm run check`, CI, deployment и production smoke фиксируются в PR до
  перехода к задаче 13.

## Rollback

Переключение server-row `monochrome_preview=false` возвращает `/me/edit` к
прежней айдентике после обновления session state. Trainer forms и
`/me?view=review|save` не получают `client-card-edit-identity` независимо от
значения флага.
