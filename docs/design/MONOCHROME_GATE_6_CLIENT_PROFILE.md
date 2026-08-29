# Gate 6 — Client Profile

Статус: **implemented; local validation complete**.

## Scope

- Роль: Client.
- Route: только `/me/profile`.
- Identity включается только при server-managed
  `actor.featureFlags.monochromePreview === true`.
- `/me/edit`, `/join`, Trainer Profile и другие формы не меняются.

## Сохранённый продуктовый контракт

- Профиль и email, переход к редактированию, связи с тренерами, приглашения,
  выбор вида карты тела, тема, install panel, feedback form и logout используют
  прежние данные, мутации, маршруты и тексты.
- Loading, error/retry, самостоятельные занятия, connected trainers, active
  invitation, disconnect/revoke success/error, install и feedback states
  возникают только по существующим условиям.
- Компонент push-уведомлений существует в кодовой базе, но в реальном
  `ClientProfilePage` сейчас не смонтирован. В рамках визуальной миграции он не
  добавляется: это было бы изменением продукта и затронуло бы flag-off UI.
- API/RPC, права и продуктовая логика не менялись.

## Применённая UI Identity v1

- Header `24/600`, имя `18/600`, section `16–18/600`, controls `14/500`,
  meta `12/500`, body `14/400`, editable feedback `16/400`.
- Profile, trainer connections, display settings, menu и раскрываемые панели
  используют один neutral surface family 18 px без gradients, glow и shadows.
- Base actions 48 px; compact «Пригласить тренера» — 44 px. Опасные disconnect,
  revoke и logout используют danger token вместе с прямым текстом.
- Switch и body-map segmented control сохраняют 44 px targets, нейтральный
  active state и одинаковую light/dark геометрию.
- Bottom navigation полностью переиспользует Client Home pattern.

## Visual review

- Light и dark: committed mobile baselines 390 и 430 px.
- Отдельный feedback baseline проверяет нижнюю часть длинного экрана, segments,
  textarea `16/400`, disabled/secondary actions и logout.
- Native WebKit/Chromium и exact Linux screenshots подтверждают одинаковую
  геометрию, отсутствие horizontal overflow и цельный navigation pattern.
- Новый аккаунт без preview-флага явно не получает identity class.

## Проверки

- Полный `npm run check`: 123 app-файла / 871 tests, 225 API tests, policies,
  lint, typecheck и production build — green.
- AppLayout route scope: 29/29 tests; fail-closed Chromium account — green.
- Реальный flow подключения, подтверждённого отключения и смены тренера — green.
- Native light/dark/feedback visual 390/430: 2/2; exact Linux no-update
  comparison 390/430: 2/2.
- CI, deployment и production smoke фиксируются в PR до перехода к задаче 12.

## Rollback

Переключение server-row `monochrome_preview=false` возвращает Client Profile к
прежней айдентике после обновления session state. `/me/edit` и `/join` не
получают `client-profile-shell-identity` независимо от значения флага.
