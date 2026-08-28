# Fit — Gate 1, задача 5: действия и формы

Статус: **принято 2026-08-29**.

Дата: 2026-08-29.

## Результат

Создан отдельный preview:
`docs/design/preview/monochrome-actions-forms.html`. Он использует только
утверждённые typography и palette tokens из foundation preview, не импортирует
product CSS и не меняет реальные экраны.

В matrix показаны одинаковые структура и геометрия для light / dark, но dark
вариант проверяется как самостоятельная визуальная композиция, а не как
автоматическая инверсия.

## Действия

| Вариант | Контракт preview |
| --- | --- |
| Base action | 48 px и radius 14 для primary, secondary, ghost и destructive |
| Compact action | отдельный size 44 px, доступный любому semantic variant только из-за плотности контекста |
| Primary | единственный главный action; иерархия создаётся fill и максимальным contrast |
| Secondary | нейтральная surface, не спорит с primary за visual weight |
| Ghost | прозрачная поверхность и минимальный visual weight |
| Destructive | danger semantic с прямой подписью и обязательным подтверждением; geometry не отличается от других variants |
| Focus | чёткий outline 2 px с offset 2 px, без glow |
| Pending | сохраняет вес primary, меняет подпись, имеет `aria-busy` и блокирует повтор |
| Disabled | сохраняет геометрию и читаемую подпись на существующих surface/text tokens |

Semantic priority не связан с высотой: base primary, secondary, ghost и
destructive имеют одинаковые 48 px; compact-версия каждого из них — 44 px.
Иерархия строится через fill, contrast и visual weight.

Точный danger-red не вводился внутри задачи 5. Нейтральный destructive в этом
preview сохранён как исторический placeholder. Задача 6 позднее утвердила
danger `#A73737` light / `#F0A0A0` dark как обязательную понятную
semantic-индикацию production destructive; одной позиции, outline-геометрии и
глагола недостаточно.

## Формы и controls

| Элемент | Контракт preview |
| --- | --- |
| Text field | минимум 44 px, radius 14, editable `16/400` |
| Textarea | editable `16/400`, фиксированный спокойный surface |
| Focused field | outline без изменения размеров и без glow |
| Disabled field | та же геометрия и явная helper-подпись |
| Segmented control | общий control 44 px, внутренний compact target 36 px, один active |
| Switch row | touch target минимум 52 px, track 42×24, явные on/off/disabled |

Light использует `secondary` на основном фоне и `secondary-strong` на tinted
surfaces. Dark использует только единый `#999A9F`; отдельный
`secondary-strong` не создан.

## Контраст ключевых пар

| Сочетание | Контраст |
| --- | --- |
| light primary: `#F6F2EA` / `#242426` | 13.88:1 |
| light secondary: `#242426` / `#EFEDE8` | 13.24:1 |
| light field: `#242426` / `#E5E2DC` | 11.98:1 |
| light helper on raised: `#666560` / `#F7F5F1` | 5.36:1 |
| light disabled action: `#666560` / `#EFEDE8` | 4.99:1 |
| light disabled field: `#666560` / `#E5E2DC` | 4.52:1 |
| dark primary: `#171719` / `#F1EDE6` | 15.34:1 |
| dark secondary: `#F1EDE6` / `#1D1E21` | 14.28:1 |
| dark field: `#F1EDE6` / `#191A1D` | 14.91:1 |
| dark helper minimum: `#999A9F` / `#26272B` | 5.31:1 |
| dark disabled action: `#999A9F` / `#1D1E21` | 5.93:1 |
| dark disabled field: `#999A9F` / `#191A1D` | 6.20:1 |

WCAG — только нижняя граница. При приёмке dark отдельно оценивается визуальная
различимость secondary, ghost, fields, segmented active state и switches.

## Проверки

- HTML5 разобран без parse errors;
- оба CSS-файла разобраны без syntax errors;
- light и dark содержат одинаковый набор: 11 action specimens, 4 fields,
  3 segment options и 3 switch states;
- новые literal hex, gradients, glow и box-shadow в component CSS отсутствуют;
- `src/`, product CSS, package files и production bundle не изменялись.

Автоматическая browser-проверка локального `file://` preview недоступна из-за
политики встроенного браузера. Перед приёмкой нужен визуальный просмотр
локального HTML; это ограничение не обходится альтернативным browser-control.

## Намеренно не изменено

- типографика и правила веса задачи 2;
- значения и семантика light palette задачи 3;
- значения и семантика dark palette задачи 4;
- product routes, shared-компоненты и feature flags;
- cards, sheets, dialogs, menus, navigation и иконки;
- semantic warning и data-series colors.

## Решение

Задача 5 принята. Зафиксированы base action 48 px и независимый от semantic
variant compact action 44 px, читаемый disabled без общей low-opacity и
одинаковая геометрия light/dark. После принятия задачи 6 destructive использует
утверждённый danger semantic без изменения action geometry.

Следующий допустимый шаг — только Gate 1, задача 6: surfaces и реальные
состояния в изолированной component matrix. Продуктовые экраны всё ещё не
меняются.
