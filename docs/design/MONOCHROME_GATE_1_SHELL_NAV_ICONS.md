# Fit — Gate 1, задача 7: shell, navigation и icons

Статус: **принято в Foundation UI Identity v1**.

Дата: 2026-08-29.

## Результат

Создан отдельный preview:
`docs/design/preview/monochrome-shell-navigation.html`. Он переиспользует
утверждённые typography, palette и action tokens, не импортирует product CSS и
не меняет реальные маршруты.

Задача 7 закрыла foundation-блок. Весь набор решений задач 2–7
принят как Foundation UI Identity v1 и стал базой поэтапной миграции.

## Инвентаризация реального shell

| Паттерн | Источник правды |
| --- | --- |
| общий compact phone-frame | `AppLayout.tsx`, `.phone-frame` |
| client navigation | Кабинет, Тренировки, Прогресс, Профиль |
| trainer navigation | Сегодня, Клиенты, Расписание |
| Assistant tab | четвёртая trainer-вкладка только для существующего allowlist pilot |
| page header | `Page` в `src/shared/ui.tsx`: title, back, optional action |
| immersive shell | new/edit/review/save и Live скрывают основную navigation |
| keyboard-open | нижняя navigation скрывается существующей логикой |
| icons | `src/shared/icons.tsx`, outline SVG, stroke 1.8 |

Desktop-sidebar не создавался: реальный trainer workspace сейчас использует
тот же compact phone-frame. При 1440×1000 он остаётся центрированным и
ограниченным существующей шириной около 440 px.

## Shell contract под проверкой

- Phone-frame сохраняет один DOM для обеих тем: max-width 440 px на широком
  viewport и full-bleed без внешнего radius/border на mobile ≤480 px.
- Desktop-preview radius frame — 26 px; внутри приложения cards и controls
  продолжают использовать свои утверждённые 18/14/10 px.
- Shell использует только background, Raised и Divider: нет gradient, blur,
  backdrop-filter, glass, shadow или glow.
- Page title — `24/600`; back/profile/more targets — 44×44 px.
- Centered header использует симметричные 44 px system actions и не смещает
  title при наличии действия справа.
- Geometry light/dark одинакова.

## Navigation contract под проверкой

- Client navigation сохраняет четыре существующих раздела и их названия.
- Trainer navigation сохраняет три базовых раздела; Assistant появляется только
  при существующем role/allowlist условии и не становится новой общей вкладкой.
- Navigation background — Raised с одним Divider сверху, без плавающей капсулы.
- Весь tab target не меньше 64 px; icon — 22 px; label — `12/500`.
- Active state: `aria-current="page"`, основной text color и 32 px filled icon
  tile. Inactive state использует контрастный secondary для tinted surface.
- Focus — 2 px нейтральный outline без glow.
- Active/inactive не используют coral, purple или semantic success/danger.
- Immersive, Live и keyboard-open скрывают основную navigation; альтернативный
  tab bar для этих сценариев не создаётся.

## Icon contract под проверкой

- Один Fit SVG-set: `viewBox 0 0 24 24`, outline, stroke 1.8, round caps/joins.
- Navigation: Home, Today, Clients, Assistant, Schedule, Analytics, Profile.
- System actions: Back, More, ChevronRight, Check, Alert, Info.
- SVG является декоративным внутри элемента с доступным текстом/`aria-label`;
  сама иконка не дублируется в accessibility tree.
- Неоднозначные системные `←`, `›`, `…`, `✓` заменяются соответствующим Fit SVG
  при миграции shared-компонента. Содержательные пользовательские реакции не
  удаляются механически: их смысл проверяется на конкретном экране.
- Success/danger SVG могут получать только утверждённые semantic tokens и всегда
  сопровождаются текстом.

## Проверки

- HTML5 и все preview CSS должны разбираться без syntax errors;
- light/dark должны содержать идентичные client nav, trainer nav, headers и icon
  set;
- touch targets: header 44 px, navigation 64 px;
- icon size 22 px, stroke 1.8;
- новых literal colors, opacity-based inactive states, gradients, blur, shadow
  и glow в task-7 CSS нет;
- product source, package files и production bundle не меняются.

Автоматическая browser-проверка локального `file://` preview недоступна из-за
политики встроенного браузера. Перед финальной приёмкой нужен визуальный
просмотр локального HTML; ограничение не обходится альтернативным
browser-control.

## Принятый Foundation UI Identity v1

| Задача | Зафиксированный слой |
| --- | --- |
| 2 | Onest, scale и weight semantics |
| 3 | light palette и secondary / secondary-strong |
| 4 | dark palette, единый secondary и отдельная dark review |
| 5 | actions/forms, base 48, compact 44, readable disabled |
| 6 | surfaces/states, success/danger и production destructive |
| 7 | shell, navigation и Fit SVG icons |

## Намеренно не изменено

- product screens, routes, roles, allowlists и navigation architecture;
- `src/`, shared React-компоненты, product CSS и feature flags;
- Client Home, voice-first flow, Live, Progress и trainer workspaces;
- утверждённые решения задач 2–6.

## Решение финальной приёмки foundation

Принято без дополнительной корректировки:

1. подходит ли non-floating bottom navigation без glass/blur;
2. достаточно ли active tab отличается через filled icon tile и label;
3. читаемы ли четыре длинные mobile labels на 390/430 px;
4. подходит ли frame/header geometry и одинаковый характер light/dark;
5. воспринимается ли trainer navigation как тот же Fit, а не отдельная система;
6. согласован ли единый SVG-set с actions, forms и states;
7. готов ли весь foundation-блок стать базой первого Client Home pilot.

Отдельная явная команда на миграцию получена. Client Home — первый
продуктовый экран следующего Gate.
