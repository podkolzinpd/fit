# Готовые (стандартные) тренировки для первого запуска

## Context

Новый клиент, который никогда не занимался и не знает, как составить тренировку,
сейчас видит на первом экране онбординга (`ClientFirstRunIntro`) только голос/текст —
и должен сам придумать, что делать, чтобы получить свою первую тренировку. Это
барьер для пробы приложения. Пользователь попросил добавить несколько готовых
тренировок, чтобы такой клиент мог тапнуть и сразу потренироваться по готовому
плану, а не изобретать тренировку с нуля.

Решено с пользователем: точка входа — первый экран онбординга (не отдельный
постоянный каталог); доступно всем клиентам (и без тренера, и с тренером);
содержимое — 3–4 шаблона, которые я составляю сама из системного каталога
упражнений (`SYSTEM_EXERCISE_CATALOG`).

## Ключевая находка

`ClientHomeOverview.tsx:212-214` — `ClientFirstRunIntro` уже показывается ЛЮБОМУ
клиенту (не только самостоятельному через `createQuickOwn`), как только у него
`workouts.length === 0`:
```tsx
const firstRun = !workoutsLoading && workouts?.length === 0
return <div className="client-home-overview">
  {firstRun ? <ClientFirstRunIntro actions={selfTraining} showConnection={showFirstRunConnection} /> : selfTraining}
```
Значит нужна одна точка расширения (`actions`/новый слот в `ClientFirstRunIntro`),
достижимая из двух мест: `MyClientPage` (записи о клиенте ещё нет) и
`ClientHomeOverview`/`TodayPage` (запись есть, тренировок ноль — это покрывает и
самостоятельных, и клиентов с тренером). CTA добавляется **только в `firstRun`-ветку**,
а не в постоянно рендерящийся `selfTraining` — иначе нарушится правило AGENTS.md
«На Client Home голосовой ввод и ввод текстом остаются основными действиями»
(это про повседневный экран, не про одноразовый первый).

Сохранение тренировки переиспользуется как есть: `WorkoutDraft` →
`workoutsRepository.save(draft)` (`src/data/repositories/workouts.repository.ts:222-226`)
→ RPC `save_workout`. Параллельный Yandex-бэкенд уже реализует то же самое
(`yandex-main.repository.ts:927-930`) — новой миграции и правок дублирующего
бэкенда не требуется.

## Контент: `PRESET_WORKOUTS`

Новый файл `src/shared/preset-workouts.ts`:
```ts
export interface PresetWorkoutSetTemplate { reps?: number; durationSec?: number; distanceKm?: number }
export interface PresetWorkoutExerciseTemplate { ref: string; sets: PresetWorkoutSetTemplate[] }
export interface PresetWorkoutTemplate {
  id: string; title: string; description: string; estimatedDurationMin: number
  exercises: PresetWorkoutExerciseTemplate[]
}
export const PRESET_WORKOUTS: readonly PresetWorkoutTemplate[] = [ /* 4 шаблона ниже */ ]
```

Черновой контент (refs проверить по актуальному `SYSTEM_EXERCISE_CATALOG` при
реализации — при исследовании нашлись в `system-exercises.ts` и не в
`RETIRED_SYSTEM_EXERCISE_REFS`, но финальную сверку делать в коде, не на глаз):
1. **`full-body-no-equipment`** — «Всё тело без инвентаря» (~20 мин): `joint-warmup`(1×180s), `push-ups`(3×8), `lunges`(3×10), `plank`(3×30s), `crunches`(3×15).
2. **`cardio-starter`** — «Кардио для начала» (~20 мин): `joint-warmup`(1×180s), `jump-rope`(3×40), `stationary-bike`(distanceKm 3), `burpees`(3×8).
3. **`stretch-mobility`** — «Растяжка и мобильность» (~15 мин): `cat-cow`, `thoracic-mobility`, `shoulder-mobility`, `hip-mobility`, `ankle-mobility`, `dynamic-hamstring-stretch` (все 1×60s).
4. **`core-basics`** — «Кор без инвентаря» (~15 мин): `joint-warmup`(1×120s), `plank`(3×30s), `side-plank`(2×20s), `crunches`(3×15), `leg-raise`(3×12), `russian-twist`(3×20).

Маппер в том же файле — конвертирует шаблон в `ParsedWorkoutExercise[]`
(формат, который уже принимает экран ревью тренировки, см.
`src/features/workouts/quick-workout-entry.ts:7-24`), подставляя реальный
`ExerciseSnapshot` из живого каталога (`catalog.exercises`), а не статический
снэпшот — иначе в сохранённый `WorkoutExerciseDraft` попадут неполные данные
(`TodayPage.tsx` `draftExercise()` спредит `item.exercise` целиком):
```ts
export function presetWorkoutToParsedItems(
  preset: PresetWorkoutTemplate,
  catalog: readonly ExerciseSnapshot[],
): ParsedWorkoutExercise[] {
  return preset.exercises.map((item) => {
    const exercise = catalog.find((c) => c.ref === item.ref)
    if (!exercise) throw new Error(`Preset "${preset.id}" references unknown exercise ref "${item.ref}"`)
    return { line: exercise.name, exercise, sets: item.sets.map((set, position) => ({ position, ...set })), hasValues: true }
  })
}
```

Контракт-тест `src/shared/preset-workouts.test.ts` — по образцу
`src/shared/program-catalog.test.ts:6-16` (уникальность id, каждый `ref` реально
есть в `SYSTEM_EXERCISE_CATALOG` и активен через `isActiveCatalogExercise`),
плюс юнит-тест на `presetWorkoutToParsedItems` (маппинг sets/position, throw на
неизвестный ref).

## Фичефлаг и Coachmark — сознательно не добавляю

- **Без feature-флага.** По AGENTS.md pilot-уровень (`VITE_<FEATURE>_ENABLED` +
  allowlist) нужен только когда явно просят показать готовую фичу выбранным
  production-пользователям — здесь этого не просили, риска для бэкенда нет
  (сохранение не меняется). Обычный PR через три стандартных уровня проверки.
- **Без Coachmark.** Он нужен для явного экрана, который меняется для
  вернувшегося пользователя. `firstRun`-ветка по определению показывается
  только один раз (пока `workouts.length === 0`) — сравнивать не с чем.

## UI-встройка

**Нет карточки клиента** — `src/features/clients/ClientsPages.tsx`, `MyClientPage`
(строки ~23-61): расширить тип параметра `quickStart.mutationFn` до экспортируемого
`FirstWorkoutIntent`; в `actions`, которые уходят в `ClientFirstRunIntro`, добавить
`<PresetWorkoutPicker onSelect={(presetId) => quickStart.mutate({ mode: 'preset', presetId })} pending={quickStart.isPending} />`
рядом с существующим `.client-home-self-training` блоком.

**Карточка есть, тренировок ноль** (покрывает и самостоятельных, и клиентов с
тренером) — `ClientHomeOverview.tsx`: новый опциональный проп `presetPrompt?: ReactNode`,
рендерить его только внутри `firstRun`-ветки (строка 214), ветку `: selfTraining`
не трогать. `TodayPage.tsx`: передать `presetPrompt={<PresetWorkoutPicker onSelect={handlePresetSelected} />}`,
где
```tsx
function handlePresetSelected(presetId: string) {
  const preset = PRESET_WORKOUTS.find((p) => p.id === presetId)
  if (!preset) return
  setItems(presetWorkoutToParsedItems(preset, catalog.exercises))
  trackGoal('today_preset_workout_selected')
  setScreen('review')
}
```

**Плюмбинг intent** (нужен только для пути через `MyClientPage`, где карточка
создаётся раньше, чем монтируется `TodayPage`) — `first-workout-intent.ts`:
добавить `| { mode: 'preset'; presetId: string }` в `FirstWorkoutIntent` и ветку
валидации в `takeFirstWorkoutIntent`; экспортировать тип из
`src/features/workouts/index.ts`. В `TodayPage.tsx` — второй эффект потребления
intent рядом с существующим voice-эффектом, дергающий `handlePresetSelected`.

**Новый компонент** `src/features/workouts/PresetWorkoutPicker.tsx` — не
переиспользует тяжёлый `ExercisePicker` (он для выбора отдельных упражнений в
черновик), а простой сворачиваемый блок: кнопка-ссылка «Попробовать готовую
тренировку» → раскрывает до 4 карточек в стиле `.trainer-catalog-card`
(`TrainerCatalogPage.tsx` ~L94, `styles.css` ~5822) с названием, описанием,
числом упражнений/длительностью и кнопкой «Выбрать». Новые CSS-правила рядом с
`.first-run-client`/`.client-home-self-training` (~1680-1772).

## PR-разбивка (одна задача = один PR, по AGENTS.md/FIT_WORKFLOW.md)

**Перед PR 1**: скопировать этот план без сокращений в `docs/design/PRESET_WORKOUTS.md`
и в связанный YAFIT-тикет — первым действием на ветке (правило `FIT_WORKFLOW.md:33`).

**PR 1 — контент и доменный плюмбинг, без UI:**
`src/shared/preset-workouts.ts` (+тест), `docs/design/PRESET_WORKOUTS.md`,
`first-workout-intent.ts` (+тест на `preset`-вариант), экспорт типа из
`src/features/workouts/index.ts`. Только vitest, без e2e.

**PR 2 — UI-встройка для обеих аудиторий:**
`PresetWorkoutPicker.tsx` (+компонент-тест: раскрытие всех карточек, `onSelect`
с правильным id, `pending` блокирует кнопки), правки `ClientsPages.tsx`,
`ClientHomeOverview.tsx`, `TodayPage.tsx`, `styles.css`. E2e — расширить
существующий сценарий первого запуска в `e2e/mobile-shell.webkit.spec.ts`
(~L655-704, тот же inline-стиль, не отдельный spec-файл) шагом «раскрыть
готовые тренировки → выбрать → дойти до экрана ревью с ожидаемым числом
упражнений → сохранить»; по возможности добавить аналогичный шаг для клиента с
тренером в `e2e/auth.spec.ts`, если там уже есть подходящий фикстур-клиент —
не изобретать новый.

## Проверка

- `npm run check` (типы/линт/vitest) на каждом PR.
- Контракт-тест `preset-workouts.test.ts` ловит опечатку в `ref` или ссылку на
  снятое с публикации упражнение.
- Ручная проверка в браузере (через `/run`): новый клиент без карточки → видит
  тумблер → выбирает шаблон → попадает на экран ревью с нужными упражнениями →
  сохраняет → тренировка появляется в «Мои тренировки». Отдельно проверить
  клиента с существующим тренером и нулём тренировок — тот же путь через
  `ClientHomeOverview`.
