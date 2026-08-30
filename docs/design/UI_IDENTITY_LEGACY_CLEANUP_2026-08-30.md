# UI Identity v1 — legacy cleanup

Дата: 2026-08-30  
База повторного аудита: `main` на `67c334a` после merge Progress/Goal.

## Граница cleanup

Cleanup устраняет визуальные остатки старой coral/purple identity в текущем
rollout `on`, не удаляя механизм возврата. Режимы `on / preview / off`,
`monochrome_preview`, Supabase feature flag и legacy UI для `off` сохранены.
Продуктовая логика, данные, маршруты и API не менялись.

## Актуальная классификация A/B/C/D

### A — живой legacy, мигрирован в этой серии

- Branding и root/system states: favicon, PWA/iOS assets, browser theme color,
  protected loading/error и render error boundary.
- Shared primitives: skeletons, overlays, sheets, loaders и coachmarks.
- Typography/geometry/icons: Onest hierarchy, допустимые radii и shared SVG
  icons со stroke `1.8` вместо локальных Unicode glyphs.
- Экранные хвосты: Client Home, workout create/edit/detail, Trainer Today,
  Clients, Schedule, Assistant, Progress и Goal, включая повторный scan после
  merge Progress.

После исправлений незакрытых элементов класса A не осталось.

### B — подтверждённый dead code, удалён

- Неиспользуемые CSS-группы `client-shell`, старых Client Home/onboarding,
  Today agenda/quick client, Assistant collection/completion,
  Progress attention/section/next и Goal details.
- Theme overrides для удалённых `client-welcome` и `client-access-card`.
- Недостижимые селекторы `*-identity.theme-dark-pilot`: новая identity и
  прежний dark pilot взаимоисключаются в `AppLayout`.
- Ошибочный selector старого picker sheet был заменён живым selector ранее в
  cleanup shared primitives.

### C — rollback dependency, сохранить

- `src/app/feature-flags.ts`: `VITE_MONOCHROME_ROLLOUT_MODE` и логика
  `isMonochromeUiEnabled` для `on / preview / off`.
- `src/app/AppLayout.tsx`, `src/app/App.tsx`, auth/root theme integration и
  route-scoped identity classes.
- Supabase `monochrome_preview`: migration, typed profile field, repository,
  seed и RLS tests.
- `LegacyExercisesPage` и иные живые условные ветви/старые разметки, которые
  реально показываются в rollout `off`.
- Базовые pre-identity CSS tokens, `.theme-dark-pilot` и legacy component CSS,
  пока они достижимы в `off` или отдельном старом dark pilot.

Удалять этот класс можно только отдельной задачей после решения закрыть окно
rollback.

### D — легитимная новая/semantic UI, не менять

- Утверждённые light/dark foundation literals и success/danger semantic colors.
- Warning amber только для реального предупреждения; data visualization colors
  и числовая типографика Progress/Live.
- Нейтральные inset edges/focus rings, status icons и продуктовые emoji, где
  смысл продублирован текстом.
- Локальные spacing/radius literals, совпадающие с UI Identity и не создающие
  визуальной или поддерживаемой проблемы.

## Логические пакеты

1. Branding + root/system states — `cfade7f`.
2. Shared primitives и overlays/loaders — `08ce2a2`.
3. Typography/radii/icons/token deviations — `a5b5699`.
4. Экранные хвосты, включая актуальные Progress/Goal — `ca7f9b5`.
5. Подтверждённый dead CSS и итоговая regression — текущий cleanup commit.

## Условие следующего cleanup

Сначала принять отдельное решение об окончании rollback-window. Только после
этого можно удалять legacy branches/components, pre-identity tokens,
`.theme-dark-pilot`, Supabase flag infrastructure и режимы `preview/off`.
