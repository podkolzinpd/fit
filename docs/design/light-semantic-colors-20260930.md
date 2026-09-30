# Light semantic colors — 2026-09-30

## Пользовательский результат

Светлая тема не смешивает светлые text tokens с тёмными semantic surfaces.
Карточка «Тренировка запланирована» и остальные success, danger и current
состояния остаются нейтральными по поверхности, читаемыми и согласованными с
Foundation UI Identity v1.

## Причина

При выводе route-scoped monochrome identity в общий production contract в
`.theme-light` не были перенесены восемь theme-specific tokens:

- `--success-border`, `--success-surface`, `--success-mark-surface`;
- `--danger-border`, `--danger-surface`, `--danger-hover`;
- `--neutral-current`, `--neutral-current-border`.

Из-за CSS inheritance светлая тема использовала их значения из тёмного `:root`.
На first-plan success-card это давало `#242426` на `#1D1E21`, то есть контраст
`1.08:1`.

## Реализация

1. Переиспользовать существующие light surfaces и divider через semantic
   aliases; новые цвета и компоненты не добавлять.
2. Для supporting copy на tinted surface использовать существующий
   `--secondary-label-fg`, а не более слабый `--muted`.
3. Проверять реальные `fg`/`secondary`/`success`/`danger` пары на semantic
   surfaces в обеих темах общим accessibility smoke.
4. Проверить first-plan success-route и общие semantic states при 390, 430 и
   1440 px; отдельно убедиться, что dark theme не изменилась.

## Acceptance matrix

| Состояние | Видимый результат | Проверка |
| --- | --- | --- |
| Light success | Нейтральная светлая card, читаемые заголовок, supporting copy и success label | Runtime contrast + real-route screenshot |
| Light danger | Нейтральная светлая surface, читаемый danger text | Runtime contrast |
| Light current | Светлая neutral surface вместо dark patch | Runtime contrast + Live smoke |
| Dark semantic states | Существующая графитовая поверхность и светлый текст без изменений | Runtime contrast + dark screenshot |
| First-plan actions | «Пригласить спортсмена» остаётся primary, «Перейти на главную» secondary | Existing E2E + visual inspection |

## Вне scope

- тексты, действия, маршруты и бизнес-логика;
- новая палитра или новые semantic tokens;
- редизайн соседних workout-блоков;
- изменения backend, БД, Assistant или SpeechKit.
