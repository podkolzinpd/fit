import type { BlockPreset, BlockType, ClientStats, ExerciseSnapshot, InputKind, Workout, WorkoutDraft, WorkoutExercise, WorkoutExerciseDraft, WorkoutSet, WorkoutSetDraft, WorkoutSummary } from '../../shared/domain'
import type { LocalDate } from '../../shared/local-date'
import { MUSCLE_GROUP_LABELS } from '../../shared/system-exercises'

export interface ExerciseBlock {
  blockId: string
  blockType: BlockType
  blockPreset: BlockPreset
  blockRounds: number
  restBetweenExercisesSec: number
  restBetweenRoundsSec: number
  exercises: WorkoutExercise[]
}

// Группирует упражнения тренировки в блоки по blockId, сохраняя порядок
// (по позиции первого упражнения блока). Соседние упражнения одного блока
// объединяются; порядок упражнений внутри блока — по позиции.
export function groupIntoBlocks(exercises: WorkoutExercise[]): ExerciseBlock[] {
  const ordered = [...exercises].sort((a, b) => a.position - b.position)
  const blocks: ExerciseBlock[] = []
  const byId = new Map<string, ExerciseBlock>()
  for (const exercise of ordered) {
    const existing = byId.get(exercise.blockId)
    if (existing) {
      existing.exercises.push(exercise)
    } else {
      const block: ExerciseBlock = { blockId: exercise.blockId, blockType: exercise.blockType, blockPreset: exercise.blockPreset, blockRounds: exercise.blockRounds, restBetweenExercisesSec: exercise.restBetweenExercisesSec, restBetweenRoundsSec: exercise.restBetweenRoundsSec, exercises: [exercise] }
      byId.set(exercise.blockId, block)
      blocks.push(block)
    }
  }
  return blocks
}

// True, если подход — последний подтверждаемый в своём блоке: последний сет
// последнего (по позиции) упражнения блока. Используется в live, чтобы отдых
// стартовал только после всего блока (суперсет/трисет/круговая).
export function isLastSetOfBlock(workout: Workout, exerciseId: string, setId: string): boolean {
  const exercise = workout.exercises.find((item) => item.id === exerciseId)
  if (!exercise) return false
  const block = groupIntoBlocks(workout.exercises).find((b) => b.blockId === exercise.blockId)
  if (!block) return false
  const lastExercise = block.exercises[block.exercises.length - 1]
  if (!lastExercise || lastExercise.id !== exerciseId) return false
  const lastSet = [...exercise.sets].sort((a, b) => a.position - b.position)[exercise.sets.length - 1]
  return Boolean(lastSet && lastSet.id === setId)
}

export interface BlockRound {
  round: number // 1-based номер круга
  items: { exercise: WorkoutExercise; set: WorkoutSet }[]
}

// Раскладывает многоэлементный блок «по кругам»: круг R = по одному подходу
// (позиция R-1) каждого упражнения блока, в порядке упражнений. Число кругов
// = максимум подходов среди упражнений блока (1 круг = 1 подход каждого).
export function blockRoundsView(block: ExerciseBlock): BlockRound[] {
  const roundCount = Math.max(block.blockRounds, ...block.exercises.map((e) => e.sets.length), 1)
  const rounds: BlockRound[] = []
  for (let r = 0; r < roundCount; r++) {
    const items: BlockRound['items'] = []
    for (const exercise of block.exercises) {
      const set = [...exercise.sets].sort((a, b) => a.position - b.position)[r]
      if (set) items.push({ exercise, set })
    }
    if (items.length) rounds.push({ round: r + 1, items })
  }
  return rounds
}

// Индекс (0-based) текущего круга: первого, где есть неподтверждённый подход.
// Если все круги подтверждены — возвращает последний.
export function currentRoundIndex(rounds: BlockRound[]): number {
  const idx = rounds.findIndex((round) => round.items.some(({ set }) => !set.confirmedAt))
  return idx === -1 ? Math.max(0, rounds.length - 1) : idx
}

// Ярлык группы определяется пресетом (Сет/Круговая), одиночное — «Обычный».
export const BLOCK_PRESET_LABELS: Record<BlockPreset, string> = {
  set: 'Сет',
  circuit: 'Круговая',
}
export function blockLabel(blockType: BlockType, blockPreset: BlockPreset): string {
  return blockType === 'single' ? 'Обычный' : BLOCK_PRESET_LABELS[blockPreset]
}

// Дефолты отдыха по пресету (сек): между упражнениями / между кругами.
export const PRESET_REST_DEFAULTS: Record<BlockPreset, { betweenExercises: number; betweenRounds: number }> = {
  set: { betweenExercises: 0, betweenRounds: 90 },
  circuit: { betweenExercises: 15, betweenRounds: 60 },
}
export const DEFAULT_REST_BETWEEN_SETS = 90

// --- Блоки на черновике (форма плана) -------------------------------------
// Черновик упражнений может не иметь blockId/blockType; хелперы ниже работают
// с ним, гарантируя корректную группировку для редактора.

export interface DraftBlock {
  blockId: string
  blockType: BlockType
  blockPreset: BlockPreset
  blockRounds: number
  restBetweenExercisesSec: number
  restBetweenRoundsSec: number
  items: { exercise: WorkoutExerciseDraft; index: number }[]
}

export interface DraftBlockRound {
  round: number // 1-based номер круга
  // exerciseIndex — плоский индекс упражнения в exercises (для updateSet);
  // setIndex — позиция подхода = номер круга − 1.
  items: { exercise: WorkoutExerciseDraft; exerciseIndex: number; setIndex: number }[]
}

// Раскладывает многоэлементный черновик-блок «по кругам» для формы плана:
// круг R = по одному подходу (позиция R-1) каждого упражнения блока по очереди.
export function draftBlockRoundsView(block: DraftBlock): DraftBlockRound[] {
  const roundCount = Math.max(block.blockRounds, ...block.items.map(({ exercise }) => exercise.sets.length), 1)
  const rounds: DraftBlockRound[] = []
  for (let r = 0; r < roundCount; r++) {
    const items: DraftBlockRound['items'] = []
    for (const { exercise, index } of block.items) {
      if (exercise.sets[r]) items.push({ exercise, exerciseIndex: index, setIndex: r })
    }
    if (items.length) rounds.push({ round: r + 1, items })
  }
  return rounds
}

// Гарантирует blockId/blockType/blockRounds у каждого упражнения черновика:
// без блока — собственный одиночный блок, 1 круг. Не трогает проставленное.
export function ensureBlockIds(exercises: WorkoutExerciseDraft[]): WorkoutExerciseDraft[] {
  return exercises.map((exercise) => ({
    ...exercise,
    blockId: exercise.blockId ?? crypto.randomUUID(),
    blockType: exercise.blockType ?? 'single',
    blockRounds: exercise.blockRounds ?? 1,
  }))
}

// Группирует черновик по blockId в порядке следования (сохраняя исходный
// индекс каждого упражнения). Соседние упражнения одного блока объединяются.
export function groupDraftsIntoBlocks(exercises: WorkoutExerciseDraft[]): DraftBlock[] {
  const blocks: DraftBlock[] = []
  const byId = new Map<string, DraftBlock>()
  exercises.forEach((exercise, index) => {
    const blockId = exercise.blockId ?? `__solo-${index}`
    const existing = byId.get(blockId)
    if (existing) {
      existing.items.push({ exercise, index })
    } else {
      const block: DraftBlock = { blockId, blockType: exercise.blockType ?? 'single', blockPreset: exercise.blockPreset ?? 'set', blockRounds: exercise.blockRounds ?? 1, restBetweenExercisesSec: exercise.restBetweenExercisesSec ?? 0, restBetweenRoundsSec: exercise.restBetweenRoundsSec ?? 90, items: [{ exercise, index }] }
      byId.set(blockId, block)
      blocks.push(block)
    }
  })
  return blocks
}

// Синхронизирует раунды блока: у всех упражнений блока blockRounds=rounds и
// ровно `rounds` подходов (1 круг = 1 подход каждого). Недостающие подходы
// добавляются по образцу последнего, лишние — срезаются. rounds >= 1.
export function syncBlockRounds(exercises: WorkoutExerciseDraft[], blockId: string, rounds: number): WorkoutExerciseDraft[] {
  const target = Math.max(1, Math.round(rounds))
  return ensureBlockIds(exercises).map((exercise) => {
    if (exercise.blockId !== blockId) return exercise
    const sets = [...exercise.sets]
    while (sets.length < target) sets.push(nextSetDraft(sets, exercise.inputKind))
    sets.length = target
    return { ...exercise, blockRounds: target, sets: sets.map((set, position) => ({ ...set, position })) }
  })
}

// Объединяет блок упражнения по индексу со следующим в одну группу. Если один
// из блоков уже группа — сохраняем его пресет/отдых, иначе новый пресет «Сет»
// с дефолтами отдыха.
export function mergeBlockWithNext(exercises: WorkoutExerciseDraft[], index: number): WorkoutExerciseDraft[] {
  const list = ensureBlockIds(exercises)
  const current = list[index]
  const next = list[index + 1]
  if (!current || !next || current.blockId === next.blockId) return list
  const currentSize = list.filter((e) => e.blockId === current.blockId).length
  const nextSize = list.filter((e) => e.blockId === next.blockId).length
  const seed = currentSize > 1 ? current : nextSize > 1 ? next : null
  const preset: BlockPreset = seed?.blockPreset ?? 'set'
  const defaults = PRESET_REST_DEFAULTS[preset]
  const targetId = current.blockId!
  const fromId = next.blockId!
  const merged = list.map((exercise) =>
    exercise.blockId === targetId || exercise.blockId === fromId
      ? { ...exercise, blockId: targetId, blockType: 'group' as BlockType, blockPreset: preset,
          restBetweenExercisesSec: seed?.restBetweenExercisesSec ?? defaults.betweenExercises,
          restBetweenRoundsSec: seed?.restBetweenRoundsSec ?? defaults.betweenRounds }
      : exercise,
  )
  // Раунды блока = максимум подходов среди упражнений блока (1 круг = 1 подход).
  const rounds = Math.max(1, ...merged.filter((e) => e.blockId === targetId).map((e) => e.sets.length))
  return syncBlockRounds(merged, targetId, rounds)
}

// Разбивает блок на одиночные: каждому упражнению блока — свой blockId, single,
// blockRounds=1 (одиночные управляют подходами вручную, а не кругами).
export function splitBlock(exercises: WorkoutExerciseDraft[], blockId: string): WorkoutExerciseDraft[] {
  return ensureBlockIds(exercises).map((exercise) =>
    exercise.blockId === blockId ? { ...exercise, blockId: crypto.randomUUID(), blockType: 'single', blockRounds: 1 } : exercise,
  )
}

// Меняет пресет группы (Сет/Круговая) и подставляет дефолты отдыха пресета.
export function setBlockPreset(exercises: WorkoutExerciseDraft[], blockId: string, preset: BlockPreset): WorkoutExerciseDraft[] {
  const defaults = PRESET_REST_DEFAULTS[preset]
  return ensureBlockIds(exercises).map((exercise) =>
    exercise.blockId === blockId
      ? { ...exercise, blockPreset: preset, restBetweenExercisesSec: defaults.betweenExercises, restBetweenRoundsSec: defaults.betweenRounds }
      : exercise,
  )
}

// Задаёт произвольное время отдыха у блока (переопределяет дефолты пресета).
export function setBlockRest(exercises: WorkoutExerciseDraft[], blockId: string, patch: { betweenExercises?: number; betweenRounds?: number; betweenSets?: number }): WorkoutExerciseDraft[] {
  return ensureBlockIds(exercises).map((exercise) => {
    if (exercise.blockId !== blockId) return exercise
    return {
      ...exercise,
      ...(patch.betweenExercises !== undefined ? { restBetweenExercisesSec: Math.max(0, patch.betweenExercises) } : {}),
      ...(patch.betweenRounds !== undefined ? { restBetweenRoundsSec: Math.max(0, patch.betweenRounds) } : {}),
      ...(patch.betweenSets !== undefined ? { restBetweenSetsSec: Math.max(0, patch.betweenSets) } : {}),
    }
  })
}

// Перемещает блок (целиком, со всеми его упражнениями) на одну позицию вверх/вниз,
// меняя его местами с соседним блоком. На границах — без изменений. position
// пересчитывается по итоговому порядку; внутренний порядок блока сохраняется.
export function moveBlock(exercises: WorkoutExerciseDraft[], blockId: string, direction: -1 | 1): WorkoutExerciseDraft[] {
  const list = ensureBlockIds(exercises)
  const blocks = groupDraftsIntoBlocks(list)
  const from = blocks.findIndex((b) => b.blockId === blockId)
  const to = from + direction
  if (from === -1 || to < 0 || to >= blocks.length) return list
  const reordered = [...blocks]
  ;[reordered[from], reordered[to]] = [reordered[to]!, reordered[from]!]
  return reordered
    .flatMap((block) => block.items.map(({ exercise }) => exercise))
    .map((exercise, position) => ({ ...exercise, position }))
}

// Заменяет упражнение по индексу на другое из каталога, сохраняя место
// (position), принадлежность блоку и число подходов. Если тип ввода меняется
// (strength↔reps↔distance), значения подходов очищаются — их поля больше не
// подходят под новый тип; тренер вводит заново.
export function replaceExercise(
  exercises: WorkoutExerciseDraft[],
  index: number,
  snapshot: ExerciseSnapshot,
  previous?: Pick<WorkoutExerciseDraft, 'sets' | 'prefilledFromDate'>,
): WorkoutExerciseDraft[] {
  return exercises.map((exercise, current) => {
    if (current !== index) return exercise
    const sets = previous?.sets ?? (exercise.inputKind === snapshot.inputKind
      ? exercise.sets
      : exercise.sets.map((set) => ({ position: set.position })))
    return {
      ...exercise,
      source: snapshot.source,
      ref: snapshot.ref,
      customExerciseId: snapshot.customExerciseId,
      name: snapshot.name,
      muscleGroup: snapshot.muscleGroup,
      inputKind: snapshot.inputKind,
      prefilledFromDate: previous?.prefilledFromDate,
      sets,
    }
  })
}

// A new set for "＋ Подход" that inherits the relevant params of the last set
// (by input kind), so the trainer doesn't retype identical weight/reps. When
// there are no sets yet, returns an empty set at position 0.
export function nextSetDraft(sets: WorkoutSetDraft[], inputKind: InputKind): WorkoutSetDraft {
  const position = sets.length
  const last = sets[sets.length - 1]
  if (!last) return { position }
  // Не добавляем undefined-поля: это сохраняет компактный payload и совместимость
  // старых черновиков с durationMin.
  const inherit = <T extends object>(values: T) => Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as WorkoutSetDraft
  if (inputKind === 'distance') return inherit({ position, durationSec: last.durationSec, durationMin: last.durationMin, distanceKm: last.distanceKm, rpe: last.rpe })
  if (inputKind === 'reps') return inherit({ position, durationSec: last.durationSec, durationMin: last.durationMin, reps: last.reps, rpe: last.rpe })
  if (inputKind === 'duration') return inherit({ position, durationSec: last.durationSec, durationMin: last.durationMin, rpe: last.rpe })
  return inherit({ position, weightKg: last.weightKg, reps: last.reps, rpe: last.rpe })
}

export interface ExerciseChartPoint {
  date: LocalDate
  value: number
}

// Upcoming = not yet done and dated today or later, nearest first.
// History = everything else (done, or planned in the past), most recent first.
export function splitClientWorkouts(workouts: Workout[], today: LocalDate): { upcoming: Workout[]; history: Workout[] } {
  const upcoming = workouts
    .filter((workout) => workout.status !== 'done' && workout.workoutDate >= today)
    .sort((a, b) => (a.workoutDate < b.workoutDate ? -1 : a.workoutDate > b.workoutDate ? 1 : 0))
  const history = workouts
    .filter((workout) => workout.status === 'done' || workout.workoutDate < today)
    .sort((a, b) => (a.workoutDate > b.workoutDate ? -1 : a.workoutDate < b.workoutDate ? 1 : 0))
  return { upcoming, history }
}

const ATTENTION_DAYS = 14

function daysBetween(from: LocalDate, to: LocalDate): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const start = Date.UTC(fy ?? 0, (fm ?? 1) - 1, fd)
  const end = Date.UTC(ty ?? 0, (tm ?? 1) - 1, td)
  return Math.round((end - start) / 86_400_000)
}

export function computeClientStats(summaries: WorkoutSummary[], today: LocalDate): ClientStats {
  const done = summaries.filter((workout) => workout.status === 'done')
  const missed = summaries.filter(
    (workout) => workout.status === 'planned' && workout.workoutDate < today,
  )

  const lastWorkoutDate = done.reduce<LocalDate | null>(
    (latest, workout) => (latest === null || workout.workoutDate > latest ? workout.workoutDate : latest),
    null,
  )
  const firstWorkoutDate = summaries.reduce<LocalDate | null>(
    (earliest, workout) => (earliest === null || workout.workoutDate < earliest ? workout.workoutDate : earliest),
    null,
  )

  const denominator = done.length + missed.length
  const completionPercent = denominator === 0 ? null : Math.round((done.length / denominator) * 100)
  const daysInWork = firstWorkoutDate === null ? null : Math.max(0, daysBetween(firstWorkoutDate, today))
  const needsAttention = lastWorkoutDate !== null && daysBetween(lastWorkoutDate, today) >= ATTENTION_DAYS

  return { doneCount: done.length, completionPercent, lastWorkoutDate, daysInWork, needsAttention }
}

// Actual workout duration by the timer (start → finish), as "42 мин" or
// "1 ч 05 мин". Returns null when timestamps are missing or non-positive.
export function workoutDurationLabel(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null
  const ms = Date.parse(completedAt) - Date.parse(startedAt)
  if (!Number.isFinite(ms) || ms <= 0) return null
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} мин`
  return `${hours} ч ${String(minutes).padStart(2, '0')} мин`
}

export function chartUnitFor(inputKind: InputKind): string {
  if (inputKind === 'distance') return 'км'
  if (inputKind === 'reps') return 'повт.'
  if (inputKind === 'duration') return 'сек'
  return 'кг'
}

export function durationSeconds(durationSec?: number, durationMin?: number): number | undefined {
  return durationSec ?? (durationMin === undefined ? undefined : Math.round(durationMin * 60))
}

export function durationLabel(durationSec?: number, durationMin?: number): string | null {
  const seconds = durationSeconds(durationSec, durationMin)
  if (seconds === undefined) return null
  if (seconds < 60) return `${seconds} сек`
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function setLine(weightKg?: number, reps?: number, distanceKm?: number, durationSec?: number, durationMin?: number, rpe?: number): string {
  return [weightKg && `${weightKg} кг`, reps && `${reps} повт.`, distanceKm && `${distanceKm} км`, durationLabel(durationSec, durationMin), rpe !== undefined && `RPE ${rpe}`].filter(Boolean).join(' × ')
}

// Результат подхода: строка факта (факт, иначе план) и приписка плана — только
// если факт был введён и отличается от плана хоть по одному параметру.
// Совпал факт с планом или факта нет вовсе → planNote = null.
export function formatFactVsPlan(set: WorkoutSet): { fact: string; planNote: string | null } {
  const weight = set.fact.weightKg ?? set.weightKg
  const reps = set.fact.reps ?? set.reps
  const distance = set.fact.distanceKm ?? set.distanceKm
  const durationSec = set.fact.durationSec ?? set.durationSec
  const durationMin = durationSec === undefined ? (set.fact.durationMin ?? set.durationMin) : undefined
  const rpe = set.fact.rpe ?? set.rpe
  const fact = setLine(weight, reps, distance, durationSec, durationMin, rpe) || 'Без результата'
  const differs =
    (set.fact.weightKg !== undefined && set.fact.weightKg !== set.weightKg) ||
    (set.fact.reps !== undefined && set.fact.reps !== set.reps) ||
    (set.fact.distanceKm !== undefined && set.fact.distanceKm !== set.distanceKm) ||
    (set.fact.durationSec !== undefined && set.fact.durationSec !== set.durationSec) ||
    (set.fact.durationMin !== undefined && set.fact.durationMin !== set.durationMin) ||
    (set.fact.rpe !== undefined && set.fact.rpe !== set.rpe)
  const planNote = differs ? `план ${setLine(set.weightKg, set.reps, set.distanceKm, set.durationSec, set.durationMin, set.rpe)}` : null
  return { fact, planNote }
}

// Фактический результат подтверждённого подхода — строка вида «90 кг × 8 повт.».
// Возвращает null, если подход не подтверждён (confirmedAt пуст) или у него нет
// ни одного фактического значения: такой подход не выполнялся, план за факт не
// выдаём (иначе история расходится с графиком «строго по факту»).
export function factLine(set: WorkoutSet): string | null {
  if (!set.confirmedAt) return null
  const line = setLine(set.fact.weightKg, set.fact.reps, set.fact.distanceKm, set.fact.durationSec, set.fact.durationMin, set.fact.rpe)
  return line || null
}

// Ordered, de-duplicated muscle-group labels for a workout's exercises.
export function muscleGroupLabels(workout: Workout): string[] {
  const seen = new Set<string>()
  const labels: string[] = []
  for (const exercise of workout.exercises) {
    const label = MUSCLE_GROUP_LABELS[exercise.muscleGroup]
    if (!seen.has(label)) { seen.add(label); labels.push(label) }
  }
  return labels
}

// Сводка тренировки для карточки истории/предстоящих/расписания: список
// упражнений (по порядку, без дублей), у каждого — свой комментарий тренера.
// Используется одинаково в плане и в истории.
export interface SummaryExercise {
  name: string
  comment: string | null
}
export function exerciseSummary(workout: Workout): SummaryExercise[] {
  const seen = new Map<string, SummaryExercise>()
  const list: SummaryExercise[] = []
  for (const exercise of workout.exercises) {
    const existing = seen.get(exercise.name)
    if (existing) {
      // Дубль по имени: подтягиваем комментарий, если у первого его не было.
      if (!existing.comment && exercise.trainerComment) existing.comment = exercise.trainerComment
      continue
    }
    const item: SummaryExercise = { name: exercise.name, comment: exercise.trainerComment ?? null }
    seen.set(exercise.name, item)
    list.push(item)
  }
  return list
}

// Body Mass Index = weight(kg) / height(m)². Null when data is missing/invalid.
export function bmiValue(heightCm: number | null, weightKg: number | null): number | null {
  if (!weightKg || weightKg <= 0 || !heightCm || heightCm <= 0) return null
  const meters = heightCm / 100
  return weightKg / (meters * meters)
}

export function bmiLabel(heightCm: number | null, weightKg: number | null): string {
  const value = bmiValue(heightCm, weightKg)
  return value === null ? '—' : value.toFixed(1)
}

// Total lifted volume (tonnage) over a workout: Σ weight × reps for every set
// of strength exercises, using only confirmed actual results.
export function workoutTonnage(workout: Workout): number {
  let total = 0
  for (const exercise of workout.exercises) {
    if (exercise.inputKind !== 'strength') continue
    for (const set of exercise.sets) {
      if (!set.confirmedAt) continue
      const weight = set.fact.weightKg
      const reps = set.fact.reps
      if (weight && reps) total += weight * reps
    }
  }
  return total
}

// Compact tonnage label, e.g. "1 250 кг" (or "1.2 т" once past a tonne).
export function tonnageLabel(kg: number): string {
  if (kg <= 0) return '—'
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} т`
  return `${Math.round(kg)} кг`
}

// Строго фактический результат подхода (без подмены планом): график прогрессии
// отражает только реально выполненное. Подходы без факта отфильтровываются.
function setMetric(inputKind: InputKind, set: WorkoutSet): number | undefined {
  if (!set.confirmedAt) return undefined
  if (inputKind === 'distance') return set.fact.distanceKm
  if (inputKind === 'reps') return set.fact.reps
  if (inputKind === 'duration') return durationSeconds(set.fact.durationSec, set.fact.durationMin)
  return set.fact.weightKg
}

// Best result per ДЕНЬ for one exercise, oldest first, for the progression
// chart. Только done-тренировки; если в один день несколько тренировок с этим
// упражнением — берём лучший результат дня (иначе на графике дублируются даты
// и линия «скачет»). Точки без значений пропускаются.
export function exerciseChartPoints(workouts: Workout[], exerciseRef: string): ExerciseChartPoint[] {
  const bestByDate = new Map<LocalDate, number>()
  for (const workout of workouts) {
    if (workout.status !== 'done') continue
    const values = workout.exercises
      .filter((item) => item.ref === exerciseRef)
      .flatMap((exercise) => exercise.sets.map((set) => setMetric(exercise.inputKind, set)))
      .filter((value): value is number => value !== undefined)
    if (values.length === 0) continue
    const best = Math.max(...values)
    const current = bestByDate.get(workout.workoutDate)
    if (current === undefined || best > current) bestByDate.set(workout.workoutDate, best)
  }
  return [...bestByDate.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

export function copyWorkout(source: Workout, workoutDate = source.workoutDate): WorkoutDraft {
  // Копия сохраняет структуру блоков (тип), но получает свежие block_id,
  // чтобы не конфликтовать с исходной тренировкой.
  const blockIdMap = new Map<string, string>()
  const nextBlockId = (sourceBlockId: string): string => {
    const existing = blockIdMap.get(sourceBlockId)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    blockIdMap.set(sourceBlockId, fresh)
    return fresh
  }
  return {
    clientId: source.clientId, workoutDate, startTime: source.startTime ?? undefined,
    endTime: source.endTime ?? undefined, notes: source.notes ?? undefined,
    exercises: source.exercises.map((exercise) => ({
      source: exercise.source, ref: exercise.ref, customExerciseId: exercise.customExerciseId,
      name: exercise.name, muscleGroup: exercise.muscleGroup, inputKind: exercise.inputKind,
      position: exercise.position,
      blockId: nextBlockId(exercise.blockId), blockType: exercise.blockType, blockPreset: exercise.blockPreset, blockRounds: exercise.blockRounds,
      restBetweenExercisesSec: exercise.restBetweenExercisesSec, restBetweenRoundsSec: exercise.restBetweenRoundsSec, restBetweenSetsSec: exercise.restBetweenSetsSec,
      trainerComment: exercise.trainerComment,
      // При копировании завершённой тренировки факт становится исходным
      // планом новой. Иначе тренеру приходится заново набивать только что
      // выполненные веса и повторы.
      sets: exercise.sets.map((set) => ({ position: set.position,
        weightKg: source.status === 'done' ? set.fact?.weightKg ?? set.weightKg : set.weightKg,
        reps: source.status === 'done' ? set.fact?.reps ?? set.reps : set.reps,
        durationSec: source.status === 'done' ? set.fact?.durationSec ?? set.durationSec : set.durationSec,
        durationMin: source.status === 'done' ? set.fact?.durationMin ?? set.durationMin : set.durationMin,
        distanceKm: source.status === 'done' ? set.fact?.distanceKm ?? set.distanceKm : set.distanceKm,
        rpe: source.status === 'done' ? set.fact?.rpe ?? set.rpe : set.rpe })),
    })),
  }
}

// Завершённую тренировку редактируем по факту, а не по исходному плану.
// Если факт у конкретного поля не записан, оставляем план как ориентир.
export function completedWorkoutDraft(source: Workout): WorkoutDraft {
  const draft = copyWorkout(source)
  return {
    ...draft,
    exercises: draft.exercises.map((exercise, exerciseIndex) => ({
      ...exercise,
      sourceExerciseId: source.exercises[exerciseIndex]?.id,
      sets: exercise.sets.map((set, setIndex) => {
        const sourceSet = source.exercises[exerciseIndex]?.sets[setIndex]
        const fact = sourceSet?.fact
        return {
          ...set,
          sourceSetId: sourceSet?.id,
          weightKg: fact?.weightKg ?? set.weightKg,
          reps: fact?.reps ?? set.reps,
          durationSec: fact?.durationSec ?? set.durationSec,
          durationMin: fact?.durationMin ?? set.durationMin,
          distanceKm: fact?.distanceKm ?? set.distanceKm,
          rpe: fact?.rpe ?? set.rpe,
        }
      }),
    })),
  }
}

export function canTransition(from: Workout['status'], to: Workout['status']): boolean {
  return (from === 'planned' && to === 'in_progress') || (from === 'in_progress' && to === 'done')
}
