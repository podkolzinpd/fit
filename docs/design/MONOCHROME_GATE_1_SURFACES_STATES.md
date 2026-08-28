# Fit — Gate 1, задача 6: surfaces и состояния

Статус: **принято 2026-08-29**.

Дата: 2026-08-29.

## Результат

Создан отдельный preview:
`docs/design/preview/monochrome-surfaces-states.html`. Он переиспользует
утверждённые foundation и actions/forms CSS, не импортирует product CSS и не
меняет реальные экраны.

Light и dark используют одинаковую структуру и геометрию. Surface contrast,
scrim, active card, overlays и semantic states в dark проверяются отдельно, а
не получаются автоматической инверсией light.

## Инвентаризация реальных паттернов

В matrix включены только существующие в продуктовой логике паттерны:

| Preview | Реальный источник |
| --- | --- |
| neutral и active workout card | `ClientHomeOverview`, состояния `H05/H06` Gate 0 |
| loading skeleton | `Skeleton`, `AsyncView` в `src/shared/ui.tsx` |
| empty | `EmptyState`; текст подтверждён `src/shared/ui.test.tsx` |
| info / unavailable | `StatePanel tone="info"`; реальный editing-denied в `WorkoutsPages.tsx` |
| error + retry | `AsyncView`; «Не удалось загрузить данные» + «Повторить» |
| saving / saved / error | `SaveStatus`; профиль и сохранение Live-подхода |
| confirm dialog | `useConfirm` / `ConfirmDialog` с `role="alertdialog"` |
| overflow menu | `OverflowMenu`; реальные действия редактора упражнения |
| bottom sheet | `ClientPicker`, `ExercisePicker`, exercise settings sheet |

Отдельный полноэкранный success-state не создан: в текущем продукте успешное
завершение подтверждается следующим экраном или компактным `SaveStatus`.

## Surface contract под проверкой

- Card группирует один объект и использует Raised на Grouped surface.
- Active card сохраняет ту же геометрию, получает явную текстовую метку и
  усиленный нейтральный contour; active не кодируется одной заливкой.
- Sheet, dialog и menu используют Raised, Divider и scrim без shadow, gradient
  или glow.
- Scrim основан на утверждённом `#111214`: 56% для light и 72% для dark.
  Значения различаются осознанно, потому что dark depth проверяется отдельно.
- Menu items и dialog actions сохраняют базовый мобильный target 48 px.

## Semantic colors

В задаче утверждены только два новых semantic token. Цвет всегда дублируется
иконкой, текстом и ролью компонента; цветных semantic-заливок карточек нет.

| Роль | Light | Dark | Применение |
| --- | --- | --- | --- |
| Success | `#2F6B4F` | `#8FC7A8` | только подтверждённый saved/success |
| Danger | `#A73737` | `#F0A0A0` | error, destructive label и danger icon |

Warning, info-blue и дополнительные semantic surfaces не добавлены: для этой
matrix нет подтверждённой необходимости. Info и empty остаются нейтральными.

Утверждённый danger заменяет нейтральный destructive preview-placeholder из
задачи 5 и становится обязательной понятной semantic-индикацией production
destructive.

## Контраст semantic-пар

| Сочетание | Контраст |
| --- | --- |
| light success / background | 6.03:1 |
| light success / raised | 5.78:1 |
| light success / grouped | 5.38:1 |
| light danger / background | 6.20:1 |
| light danger / raised | 5.94:1 |
| light danger / grouped | 5.53:1 |
| dark success / background | 9.73:1 |
| dark success / raised | 7.75:1 |
| dark danger / background | 9.14:1 |
| dark danger / raised | 7.28:1 |

Все пары проходят WCAG AA для обычного текста. Это не заменяет отдельную
визуальную проверку dark overlays, states и active card.

## Проверки

- HTML5 и CSS syntax проверяются отдельно;
- light/dark должны содержать идентичный набор cards, overlays, state panels и
  SaveStatus;
- SVG-иконки используют stroke 1.8 и не заменяются emoji;
- новые цвета ограничены двумя semantic candidates и documented scrim;
- product source, package files и production bundle не меняются.

Автоматическая browser-проверка локального `file://` preview недоступна из-за
политики встроенного браузера. Перед приёмкой нужен визуальный просмотр
локального HTML; ограничение не обходится альтернативным browser-control.

## Намеренно не изменено

- typography и правила веса задачи 2;
- light/dark foundation задач 3–4;
- action sizing, hierarchy, forms и disabled задачи 5;
- product routes, shared React-компоненты и feature flags;
- navigation, shell, charts и data-series colors;
- искусственные состояния, которых нет в текущей продуктовой логике.

## Решение

Задача 6 принята. Surface hierarchy, overlays и реальные состояния утверждены.
Success `#2F6B4F` / `#8FC7A8` и danger `#A73737` / `#F0A0A0` становятся
единственными green/red semantic-парами. Они используются только по реальному
смыслу, дублируются текстом/иконкой и не создают декоративных semantic-заливок.
Production destructive теперь использует danger semantic вместо временного
neutral-placeholder. Геометрия light/dark остаётся одинаковой.

Следующий допустимый шаг — только Gate 1, задача 7: shell, navigation и icons в
изолированном preview. Продуктовые экраны всё ещё не меняются.
