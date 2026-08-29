# Client pilot — общий visual audit

Статус: **passed**.

Проверенная production-точка: `ce4f8fa` (`Client Progress`, PR #655).

## Scope

- Client Home `/me` — light/dark, 390 и 430 px.
- Live `*/live` — light/dark, 390 и 430 px.
- Client Progress `/me/progress` — light/dark, real/scheme и measurements,
  390 и 430 px.
- Источник сравнения — committed native и exact Linux baselines, прошедшие
  обязательные Chromium visual и оба WebKit CI shards.

## Итог

Три области воспринимаются как один визуальный язык Fit и проходят Gate 3–5
без stabilization-задачи. Это не перекраска старого интерфейса: Home строится
вокруг цельной voice action, Live — вокруг текущей работы и repeated primary,
Progress — вокруг одного результата и плотной data surface. Разная плотность
обусловлена задачей экрана, а foundation остаётся общей.

## Проверка системы

| Область | Результат |
| --- | --- |
| Onest и типографика | Единая шкала `24/600`, `18/600`, `16/600`, `14/400`, `14/500`, `12/500`; крупные числа есть только в Live/Progress по смыслу. |
| Spacing и плотность | Общая сетка 4/8/12/16/18/24. Home намеренно свободнее, Live и Progress плотнее без тесноты и случайных отступов. |
| Радиусы и геометрия | Карточки 18 px, controls 14 px, сегменты 10 px; actions 48 px, compact 44 px независимо от variant. |
| Surfaces и карточки | Тёплые нейтральные уровни, одна поверхность на смысловой блок, без glow, glass и декоративных градиентов. |
| Actions и controls | Primary определяется полярной заливкой; secondary/ghost — поверхностью или границей. Disabled остаётся читаемым. |
| Navigation | Home и Progress используют одну flat bottom navigation; Live корректно переходит в immersive shell. Active state нейтрален. |
| Inputs | Live и measurements используют одинаковую геометрию, `16/400` для editable content и видимые границы обеих тем. |
| Иконографика | Outline SVG, единый stroke и touch target; emoji не используются как navigation/action icon. |
| Semantic states | Success — только подтверждённый рост, amber — текущая работа, danger — LIVE/опасное действие; смысл всегда продублирован текстом. |
| Light/dark | Геометрия одинакова; иерархия поверхностей и controls отдельно читается на `#FBFAF7` и `#111214`. Dark не выглядит автоматической инверсией. |
| Legacy | Coral/purple, локальные brand-заливки и ad-hoc hex в мигрированных route scopes отсутствуют. |
| Grayscale | Иерархия сохраняется за счёт композиции, масштаба, поверхности и веса, а не зависимости от цвета. |

## Согласованные различия

- Home оставляет больше воздуха и один доминирующий voice-first action.
- Live убирает обычную навигацию, уплотняет рабочие controls и добавляет узкий
  amber current-work marker.
- Progress использует больше divider и data rows, но не создаёт альтернативные
  buttons, fields, navigation или surfaces.

Эти различия расширяют UI Identity v1 под реальную задачу и не образуют три
параллельные дизайн-системы.

## Production

- Client Home: PR #653, production green.
- Live: PR #654, production green.
- Client Progress: PR #655, Vercel deployment `6151374269` green.
- `monochrome_preview` остаётся default OFF и управляется server-side по
  authenticated `user_id`; немигрированные routes и остальные пользователи не
  затронуты.
- Authenticated browser smoke после Progress был запущен, но остановлен до
  загрузки приложения admin-enforced browser policy. Ограничение не обходилось;
  локальные authenticated Chromium/WebKit и все обязательные CI lanes зелёные.

## Решение

Gate 3–5 и общий client pilot audit приняты. Можно переходить к Gate 6, начиная
с задачи 9 — My Workouts. Foundation UI Identity v1 пересматривать не нужно.
