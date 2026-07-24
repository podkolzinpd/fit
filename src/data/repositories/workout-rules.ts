import type { BlockType, ClientStats, InputKind, Workout, WorkoutDraft, WorkoutExercise, WorkoutExerciseDraft, WorkoutSet, WorkoutSetDraft, WorkoutSummary } from '../../shared/domain'
import type { LocalDate } from '../../shared/local-date'
import { MUSCLE_GROUP_LABELS } from '../../shared/system-exercises'

export interface ExerciseBlock {
  blockId: string
  blockType: BlockType
  blockRounds: number
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
      const block: ExerciseBlock = { blockId: exercise.blockId, blockType: exercise.blockType, blockRounds: exercise.blockRounds, exercises: [exercise] }
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

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  single: 'Обычный',
  superset: 'Суперсет',
  triset: 'Трисет',
  circuit: 'Круговая',
}

// --- Блоки на черновике (форма плана) -------------------------------------
// Черновик упражнений может не иметь blockId/blockType; хелперы ниже работают
// с ним, гарантируя корректную группировку для редактора.

export interface DraftBlock {
  blockId: string
  blockType: BlockType
  blockRounds: number
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
      const block: DraftBlock = { blockId, blockType: exercise.blockType ?? 'single', blockRounds: exercise.blockRounds ?? 1, items: [{ exercise, index }] }
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

// Объединяет блок упражнения по индексу со следующим упражнением в один блок
// (по умолчанию суперсет). Общий blockId = у первого блока; тип: если один из
// блоков уже многоэлементный — берём его тип, иначе superset.
export function mergeBlockWithNext(exercises: WorkoutExerciseDraft[], index: number): WorkoutExerciseDraft[] {
  const list = ensureBlockIds(exercises)
  const current = list[index]
  const next = list[index + 1]
  if (!current || !next || current.blockId === next.blockId) return list
  const currentSize = list.filter((e) => e.blockId === current.blockId).length
  const nextSize = list.filter((e) => e.blockId === next.blockId).length
  const currentType = current.blockType ?? 'single'
  const nextType = next.blockType ?? 'single'
  const targetType: BlockType = currentSize > 1 && currentType !== 'single' ? currentType
    : nextSize > 1 && nextType !== 'single' ? nextType
    : 'superset'
  const targetId = current.blockId!
  const fromId = next.blockId!
  const merged = list.map((exercise) =>
    exercise.blockId === targetId || exercise.blockId === fromId
      ? { ...exercise, blockId: targetId, blockType: targetType }
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

// Меняет тип блока для всех упражнений с данным blockId.
export function setBlockType(exercises: WorkoutExerciseDraft[], blockId: string, blockType: BlockType): WorkoutExerciseDraft[] {
  return ensureBlockIds(exercises).map((exercise) =>
    exercise.blockId === blockId ? { ...exercise, blockType } : exercise,
  )
}

// A new set for "＋ Подход" that inherits the relevant params of the last set
// (by input kind), so the trainer doesn't retype identical weight/reps. When
// there are no sets yet, returns an empty set at position 0.
export function nextSetDraft(sets: WorkoutSetDraft[], inputKind: InputKind): WorkoutSetDraft {
  const position = sets.length
  const last = sets[sets.length - 1]
  if (!last) return { position }
  if (inputKind === 'distance') return { position, durationMin: last.durationMin, distanceKm: last.distanceKm }
  if (inputKind === 'reps') return { position, durationMin: last.durationMin, reps: last.reps }
  return { position, weightKg: last.weightKg, reps: last.reps }
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
  return 'кг'
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

// Body Mass Index = weight(kg) / height(m)². Null when data is missing/invalid.
export function bmiValue(heightCm: number, weightKg: number | null): number | null {
  if (!weightKg || weightKg <= 0 || !heightCm || heightCm <= 0) return null
  const meters = heightCm / 100
  return weightKg / (meters * meters)
}

export function bmiLabel(heightCm: number, weightKg: number | null): string {
  const value = bmiValue(heightCm, weightKg)
  return value === null ? '—' : value.toFixed(1)
}

// Total lifted volume (tonnage) over a workout: Σ weight × reps for every set
// of strength exercises, using the actual result and falling back to the plan.
export function workoutTonnage(workout: Workout): number {
  let total = 0
  for (const exercise of workout.exercises) {
    if (exercise.inputKind !== 'strength') continue
    for (const set of exercise.sets) {
      const weight = set.fact.weightKg ?? set.weightKg
      const reps = set.fact.reps ?? set.reps
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

// Actual result if recorded, otherwise the plan — so completed workouts
// marked done without live fact entry still appear on the chart.
function setMetric(inputKind: InputKind, set: WorkoutSet): number | undefined {
  if (inputKind === 'distance') return set.fact.distanceKm ?? set.distanceKm
  if (inputKind === 'reps') return set.fact.reps ?? set.reps
  return set.fact.weightKg ?? set.weightKg
}

// Best result per completed workout for one exercise, oldest first, for the
// progression chart. Only done workouts; workouts without any value skipped.
export function exerciseChartPoints(workouts: Workout[], exerciseRef: string): ExerciseChartPoint[] {
  return workouts
    .filter((workout) => workout.status === 'done')
    .map((workout) => {
      const exercise = workout.exercises.find((item) => item.ref === exerciseRef)
      if (!exercise) return null
      const values = exercise.sets
        .map((set) => setMetric(exercise.inputKind, set))
        .filter((value): value is number => value !== undefined)
      if (values.length === 0) return null
      return { date: workout.workoutDate, value: Math.max(...values) }
    })
    .filter((point): point is ExerciseChartPoint => point !== null)
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
      blockId: nextBlockId(exercise.blockId), blockType: exercise.blockType, blockRounds: exercise.blockRounds,
      sets: exercise.sets.map((set) => ({ position: set.position, weightKg: set.weightKg,
        reps: set.reps, durationMin: set.durationMin, distanceKm: set.distanceKm })),
    })),
  }
}

export function canTransition(from: Workout['status'], to: Workout['status']): boolean {
  return (from === 'planned' && to === 'in_progress') || (from === 'in_progress' && to === 'done')
}
