# Gate 7 — Workout Detail, Completion and Exercise History

Статус: **implemented; local validation complete**.

## Scope

- Роли: Client и Trainer в существующем общем workout lifecycle.
- Identity применяется только к `/workouts/:id` и
  `/workouts/:id/history/:exerciseSlug`.
- Route scope включается только при server-managed
  `actor.featureFlags.monochromePreview === true`.
- Create/Edit и Live сохраняют собственные ранее принятые scope; списки,
  Trainer Today и карточка клиента в этой задаче не меняются.

## Сохранённый продуктовый контракт

- Planned, in-progress, done и partial вычисляются из прежних workout/set data;
  status, fact и незаполненный план не подменяются декоративным состоянием.
- Завершение, feedback клиента, ответ тренера, overflow actions, edit/delete и
  переход в историю используют прежние mutation, права и маршруты.
- Exercise history сохраняет прежние statistics/history/technique tabs,
  personal record, график и chronology; новые метрики не добавлялись.
- Искусственные loading, empty, error или success states не создавались.

## Применённая UI Identity v1

- Page `24/600`, section и ключевые значения `18/600`, body `14/400`, controls
  `14/500`, meta `12/500`. Вес 600 не используется как общий вес интерфейса.
- Completion, fact summary, feedback, exercise rows, progress proof, chart и
  history используют один neutral surface family с радиусом 18 px; вложенные
  controls и tabs — 14 px.
- Base actions остаются 48 px, compact actions — 44 px независимо от variant.
  Иерархию создают fill, contrast и visual weight.
- Partial сопровождается текстом; personal record и сохранённый результат
  используют success только по реальной семантике. Danger остаётся только у
  понятного destructive action.
- Light/dark сохраняют одинаковую геометрию; dark проверен отдельно. Coral,
  purple, glow и локальные hex в route CSS не добавлены.

## Реальные состояния и visual review

- Частичное завершение с подтверждённым фактом и незавершённым упражнением;
  completion summary; feedback client/trainer; личный рекорд; statistics,
  history и chart/empty-chart proof; light и dark.
- Client viewports: 390×844 и 430×932. Trainer workspace: 1440×1000.
- Для Darwin и Linux закоммичены отдельные visual baselines.
- У пользователя без preview-флага detail и history сохраняют прежнюю identity;
  email не участвует в routing, компонентах или UI-условиях.

## Проверки

- AppLayout route scope: enabled и disabled cases для detail и history; create,
  edit и Live исключены регулярными выражениями маршрута.
- Chromium: отдельный flag-off smoke на отсутствующих detail/history routes.
- WebKit: реальное partial completion на 390/430, trainer review и client
  post-workout feedback.
- Native visual: 3/3; Linux visual: 3/3 после повторной проверки одного
  инфраструктурного navigation failure WebKit.
- Полный `npm run check`, CI, deployment и production smoke фиксируются в PR до
  перехода к Trainer Today.

## Rollback

`monochrome_preview=false` возвращает detail и exercise history к прежней
айдентике после обновления authenticated session state. Откат не требует
изменения workout data, API или маршрутов.
