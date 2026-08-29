# Gate 4 — Live-тренировка

Статус: **implemented; PR validation in progress**.

## Scope

- Роли: Client и Trainer.
- Route: существующие маршруты `*/live`.
- Identity включается только при server-managed
  `actor.featureFlags.monochromePreview === true`.
- Client Home сохраняет уже принятую identity; Progress и остальные маршруты
  не меняются.

## Сохранённый продуктовый контракт

- Порядок упражнений и подходов, ввод факта, автосохранение черновика,
  подтверждение, редактирование, добавление, замена, удаление и завершение
  работают на прежних данных и командах.
- Таймер тренировки, отдых между подходами, упражнениями и кругами, recovery
  после reload/offline, частичное завершение и fixed bottom bar не меняли
  продуктовую семантику.
- Маршруты, права ролей, API/RPC, тексты и условия сохранения не менялись.

## Применённая UI Identity v1

- Onest и принятая компактная типографическая шкала; timer — отдельное крупное
  табличное число, рабочие значения — `30/600`.
- Базовые actions — 48 px, compact — 44 px независимо от variant; repeated
  primary подтверждает текущий подход, а завершение тренировки остаётся
  secondary до финального подтверждения.
- Текущий exercise использует одну нейтральную поверхность радиуса 18 px и
  узкую янтарную линию. Янтарный обозначает только текущую работу или отдых и
  всегда сопровождается текстом.
- `LIVE` использует утверждённый danger token и явную подпись; обычный timer
  остаётся нейтральным. Coral, purple, glow и декоративные semantic-заливки не
  используются.
- Геометрия light/dark совпадает; значения поверхностей и контраста проверяются
  отдельно для каждой темы.

## Реальные состояния

Покрыты существующие loading/error, current/upcoming/confirmed exercise,
compact/expanded set, rest, circuits, reorder, exercise picker, overflow menu,
keyboard-open, offline draft recovery, save pending/error, partial finish и
обычное завершение. Искусственные состояния не добавлялись.

## Visual review

- Light и dark: committed full-page baselines 390 и 430 px.
- Проверены current work, timer, repeated primary, surface hierarchy, fixed bar,
  safe area и отсутствие horizontal overflow.
- Новый локальный аккаунт без flag явно не получает `live-identity`; server flag
  остаётся fail-closed.

## Проверки

- AppLayout и Live unit-набор: 46 tests.
- Пять основных Chromium-сценариев Trainer/Live и восемь WebKit-сценариев
  реальных состояний: green.
- Light/dark visual baselines 390/430: green локально.
- Полный `npm run check`, CI и deployment фиксируются в PR до перехода к
  Progress.

## Rollback

Переключение server-row `monochrome_preview=false` возвращает Live обеих ролей
к прежней айдентике после обновления session state; новая сборка и изменение
продуктовых данных не требуются.
