import type { BlockPreset, BlockType, ClientStats, ExerciseSnapshot, InputKind, Workout, WorkoutDraft, WorkoutExercise, WorkoutExerciseDraft, WorkoutSet, WorkoutSetDraft, WorkoutSummary } from '../../shared/domain'
import type { LocalDate } from '../../shared/local-date'
import type { RunningFormat } from '../../shared/running-formats'
import { runningFormatExerciseName } from '../../shared/running-formats'
import { MUSCLE_GROUP_LABELS } from '../../shared/system-exercises'
import { copiedExerciseName } from '../../shared/exercise-catalog-curation'
import { isRowingExerciseRef, rowingPaceLabel, runDistanceLabel, runPaceLabel } from '../../shared/run-metrics'

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
  interval: 'Интервалы',
}
export function blockLabel(blockType: BlockType, blockPreset: BlockPreset): string {
  return blockType === 'single' ? 'Обычный' : BLOCK_PRESET_LABELS[blockPreset]
}

// Дефолты отдыха по пресету (сек): между упражнениями / между кругами.
export const PRESET_REST_DEFAULTS: Record<BlockPreset, { betweenExercises: number; betweenRounds: number }> = {
  set: { betweenExercises: 0, betweenRounds: 90 },
  circuit: { betweenExercises: 15, betweenRounds: 60 },
  interval: { betweenExercises: 0, betweenRounds: 0 },
}
export const DEFAULT_REST_BETWEEN_SETS = 90

export function restSecondsAfterSet(workout: Workout, exercise: WorkoutExercise, set: WorkoutSet): number {
  const block = groupIntoBlocks(workout.exercises).find((item) => item.blockId === exercise.blockId)
  const multi = Boolean(block && block.exercises.length > 1)
  const lastExerciseOfRound = block?.exercises.at(-1)?.id === exercise.id
  const workoutFinished = workout.exercises.every((item) => item.sets.every((itemSet) => itemSet.id === set.id || itemSet.confirmedAt))
  if (workoutFinished) return 0
  if (!multi) return exercise.restBetweenSetsSec ?? DEFAULT_REST_BETWEEN_SETS
  return lastExerciseOfRound ? block!.restBetweenRoundsSec : block?.restBetweenExercisesSec ?? 0
}

const RUNNING_INTERVAL_ROUNDS = 6
const RUNNING_INTERVAL_DISTANCE_KM = 0.4
const RUNNING_INTERVAL_DURATION_SEC = 100
const RUNNING_RECOVERY_DURATION_SEC = 90

function runningIntervalSets(durationSec: number, distanceKm?: number): WorkoutSetDraft[] {
  return Array.from({ length: RUNNING_INTERVAL_ROUNDS }, (_, position) => ({
    position,
    durationSec,
    ...(distanceKm === undefined ? {} : { distanceKm }),
  }))
}

export function createRunningFormatDrafts(
  exercise: ExerciseSnapshot,
  format: RunningFormat,
  startPosition = 0,
): WorkoutExerciseDraft[] {
  if (exercise.ref !== 'running' || exercise.inputKind !== 'distance') return []
  const base: WorkoutExerciseDraft = {
    ...exercise,
    name: runningFormatExerciseName(format),
    position: 0,
    blockId: crypto.randomUUID(),
    blockType: 'single',
    blockRounds: 1,
    sets: [{ position: 0 }],
  }
  const drafts = format === 'interval-passive'
    ? applyRunningIntervalPreset([base], 0)
    : format === 'interval-active'
      ? applyRunningActiveRecoveryPreset([base], 0)
      : format === 'interval-custom'
        ? [{ ...base, blockPreset: 'interval' as const, restBetweenSetsSec: RUNNING_RECOVERY_DURATION_SEC }]
        : [base]
  return drafts.map((draft, index) => ({ ...draft, position: startPosition + index }))
}

export function applyRunningIntervalPreset(exercises: WorkoutExerciseDraft[], index: number): WorkoutExerciseDraft[] {
  const list = ensureBlockIds(exercises)
  const exercise = list[index]
  if (!exercise || exercise.ref !== 'running' || exercise.inputKind !== 'distance' || exercise.blockType !== 'single') return list
  return list.map((item, current) => current === index ? {
    ...item,
    name: 'Бег — интервалы',
    blockPreset: 'interval',
    blockRounds: 1,
    restBetweenSetsSec: RUNNING_RECOVERY_DURATION_SEC,
    sets: runningIntervalSets(RUNNING_INTERVAL_DURATION_SEC, RUNNING_INTERVAL_DISTANCE_KM),
  } : item)
}

export function applyRunningActiveRecoveryPreset(exercises: WorkoutExerciseDraft[], index: number): WorkoutExerciseDraft[] {
  const list = ensureBlockIds(exercises)
  const exercise = list[index]
  if (!exercise || exercise.ref !== 'running' || exercise.inputKind !== 'distance' || exercise.blockType !== 'single') return list
  const blockId = crypto.randomUUID()
  const shared = {
    blockId,
    blockType: 'group' as const,
    blockPreset: 'interval' as const,
    blockRounds: RUNNING_INTERVAL_ROUNDS,
    restBetweenExercisesSec: 0,
    restBetweenRoundsSec: 0,
  }
  const work: WorkoutExerciseDraft = {
    ...exercise,
    ...shared,
    name: 'Бег — быстрый отрезок',
    restBetweenSetsSec: undefined,
    sets: runningIntervalSets(RUNNING_INTERVAL_DURATION_SEC, RUNNING_INTERVAL_DISTANCE_KM),
  }
  const recovery: WorkoutExerciseDraft = {
    source: 'system',
    ref: 'running',
    name: 'Бег — восстановление',
    muscleGroup: 'cardio',
    inputKind: 'distance',
    position: exercise.position + 1,
    ...shared,
    sets: runningIntervalSets(RUNNING_RECOVERY_DURATION_SEC),
  }
  return list.flatMap((item, current) => current === index ? [work, recovery] : [item])
    .map((item, position) => ({ ...item, position }))
}

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
  options?: { clearFact?: boolean },
): WorkoutExerciseDraft[] {
  return exercises.map((exercise, current) => {
    if (current !== index) return exercise
    const sets = options?.clearFact
      ? exercise.sets.map((set) => ({ position: set.position, sourceSetId: set.sourceSetId }))
      : previous?.sets ?? (exercise.inputKind === snapshot.inputKind
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
      clearFact: options?.clearFact || undefined,
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

// Past plans still awaiting a decision are neither a completed result nor a
// warning. They get their own calm action queue for both roles.
export function splitClientWorkouts(workouts: Workout[], today: LocalDate): { upcoming: Workout[]; needsDecision: Workout[]; history: Workout[] } {
  const upcoming = workouts
    .filter((workout) => (workout.status === 'planned' || workout.status === 'in_progress') && workout.workoutDate >= today)
    .sort((a, b) => (a.workoutDate < b.workoutDate ? -1 : a.workoutDate > b.workoutDate ? 1 : 0))
  const needsDecision = workouts
    .filter((workout) => workout.status === 'planned' && workout.workoutDate < today)
    .sort((a, b) => (a.workoutDate > b.workoutDate ? -1 : a.workoutDate < b.workoutDate ? 1 : 0))
  const history = workouts
    .filter((workout) => workout.status === 'done' || workout.status === 'cancelled' || (workout.status === 'in_progress' && workout.workoutDate < today))
    .sort((a, b) => (a.workoutDate > b.workoutDate ? -1 : a.workoutDate < b.workoutDate ? 1 : 0))
  return { upcoming, needsDecision, history }
}

// «Не состоялась» — сохранённое решение по плану, а удалённые тренировки
// по-прежнему не показываются. Просроченный план не выдаём за факт.
export type WorkoutStatusTone = 'planned' | 'in_progress' | 'done' | 'partial' | 'decision' | 'cancelled'

export interface WorkoutStatusPresentation {
  label: string
  tone: WorkoutStatusTone
}

// Частичное завершение остаётся производным представлением по подтверждённым
// подходам. «Не состоялась» — отдельное сохранённое решение по прошлому плану.
export function workoutStatusPresentation(workout: Workout, today: LocalDate): WorkoutStatusPresentation {
  if (workout.status === 'cancelled') return { label: 'Не состоялась', tone: 'cancelled' }
  if (workout.status === 'done') {
    const sets = workout.exercises.flatMap((exercise) => exercise.sets)
    const confirmed = sets.filter((set) => set.confirmedAt).length
    if (confirmed > 0 && confirmed < sets.length) return { label: 'Частично', tone: 'partial' }
    return { label: 'Готово', tone: 'done' }
  }
  if (workout.status === 'in_progress') return workout.workoutDate >= today
    ? { label: 'Идёт', tone: 'in_progress' }
    : { label: 'Не завершена', tone: 'in_progress' }
  return workout.workoutDate >= today
    ? { label: 'План', tone: 'planned' }
    : { label: 'План', tone: 'decision' }
}

export function clientWorkoutStatusLabel(workout: Workout, today: LocalDate): string {
  return workoutStatusPresentation(workout, today).label
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
    (workout) => workout.status === 'cancelled'
      || (workout.status === 'planned' && workout.workoutDate < today),
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

function setLine(weightKg?: number, reps?: number, distanceKm?: number, durationSec?: number, durationMin?: number, rpe?: number, showRpe = true, exerciseRef?: string): string {
  const duration = durationLabel(durationSec, durationMin)
  const distance = runDistanceLabel(distanceKm)
  const rowing = isRowingExerciseRef(exerciseRef)
  const pace = rowing
    ? rowingPaceLabel(durationSeconds(durationSec, durationMin), distanceKm)
    : runPaceLabel(durationSeconds(durationSec, durationMin), distanceKm)
  const repsLabel = reps && `${reps} ${rowing ? 'гребков/мин' : 'повт.'}`
  const result = (rowing
    ? [distance, duration, repsLabel, showRpe && rpe !== undefined && `RPE ${rpe}`]
    : [weightKg && `${weightKg} кг`, repsLabel, distance, duration, showRpe && rpe !== undefined && `RPE ${rpe}`]
  ).filter(Boolean).join(' × ')
  return pace && result ? `${result} · темп ${pace}` : result
}

// Короткий план допустим только когда каждая строка будет выглядеть одинаково.
// Разные значения и пустой план сохраняют подробную таблицу: там важен порядок.
export function compactPlannedSetSummary(sets: readonly WorkoutSet[], showRpe = false, exerciseRef?: string): string | null {
  if (sets.length === 0) return null
  const lines = sets.map((set) => setLine(set.weightKg, set.reps, set.distanceKm, set.durationSec, set.durationMin, set.rpe, showRpe, exerciseRef))
  const first = lines[0]
  if (!first || !lines.every((line) => line === first)) return null
  return sets.length === 1 ? first : `${sets.length} × ${first}`
}

function setCountLabel(count: number): string {
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'подходов'
  if (last === 1) return 'подход'
  if (last >= 2 && last <= 4) return 'подхода'
  return 'подходов'
}

// Карточка плана всегда получает короткий читаемый итог. Одинаковые подходы
// сворачиваются полностью, у разных показываем первые два значения и оставляем
// полный порядок в раскрываемом списке.
export function compactPlannedSetOverview(sets: readonly WorkoutSet[], showRpe = false, exerciseRef?: string): string {
  const compact = compactPlannedSetSummary(sets, showRpe, exerciseRef)
  if (compact) return compact
  if (sets.length === 0) return 'Без подходов'
  const lines = sets.map((set) => setLine(set.weightKg, set.reps, set.distanceKm, set.durationSec, set.durationMin, set.rpe, showRpe, exerciseRef) || 'без значений')
  const preview = lines.slice(0, 2).join(' · ')
  return `${sets.length} ${setCountLabel(sets.length)} · ${preview}${lines.length > 2 ? ' · …' : ''}`
}

// Итог тренировки — это чтение факта, а не таблица для редактирования. Одинаковые
// подтверждённые подходы сворачиваются в одну строку; разные остаются в порядке
// выполнения, но без служебных номера и статуса каждой строки.
export function compactCompletedSetSummary(sets: readonly WorkoutSet[], showRpe = false, exerciseRef?: string): string {
  const completed = sets.filter((set) => Boolean(set.confirmedAt))
  const lines = completed.map((set) => {
    const weight = set.fact.weightKg ?? set.weightKg
    const reps = set.fact.reps ?? set.reps
    const distance = set.fact.distanceKm ?? set.distanceKm
    const durationSec = set.fact.durationSec ?? set.durationSec
    const durationMin = durationSec === undefined ? (set.fact.durationMin ?? set.durationMin) : undefined
    const rpe = set.fact.rpe ?? set.rpe
    return setLine(weight, reps, distance, durationSec, durationMin, rpe, showRpe, exerciseRef) || 'Без результата'
  })
  const first = lines[0]
  const fact = !first ? 'Без выполненных подходов'
    : lines.every((line) => line === first) && lines.length > 1 ? `${lines.length} × ${first}`
      : lines.join(' · ')
  const missed = sets.length - completed.length
  return missed > 0 ? `${fact} · не выполнено: ${missed}` : fact
}

type ExerciseDetailMode = 'planned' | 'completed'

type ExerciseDetailValue = {
  skipped: boolean
  weightKg?: number
  reps?: number
  distanceKm?: number
  durationSec?: number
  rpe?: number
}

function compactSeries(values: readonly string[]): string {
  return values.length <= 4 ? values.join(' / ') : `${values.slice(0, 4).join(' / ')} / …`
}

function repeatedSeries(values: readonly string[], suffix = ''): string {
  const visible = values.filter((value) => value !== '—')
  const first = visible[0]
  if (first && visible.length === values.length && values.every((value) => value === first)) {
    return values.length === 1 ? `${first}${suffix}` : `${values.length} × ${first}${suffix}`
  }
  return `${compactSeries(values)}${suffix}`
}

// Детальный экран тренировки показывает только две спокойные строки:
// название и легко сканируемый итог. Полный порядок подходов остаётся внутри
// раскрытия, поэтому одинаковые значения сворачиваются, а разные
// объединяются через «/» без повторения служебного слова «подходы».
export function compactExerciseDetailSummary(
  inputKind: InputKind,
  sets: readonly (WorkoutSet | WorkoutSetDraft)[],
  mode: ExerciseDetailMode,
  showRpe = false,
  exerciseRef?: string,
): string {
  if (sets.length === 0) return 'Без значений'

  const values: ExerciseDetailValue[] = sets.map((set) => {
    const savedSet = 'fact' in set ? set : null
    const skipped = mode === 'completed' && !savedSet?.confirmedAt
    if (skipped) return { skipped }
    const fact = mode === 'completed' ? savedSet?.fact ?? {} : {}
    const durationSec = fact.durationSec
      ?? (fact.durationMin === undefined ? set.durationSec : Math.round(fact.durationMin * 60))
      ?? (set.durationMin === undefined ? undefined : Math.round(set.durationMin * 60))
    return {
      skipped,
      weightKg: fact.weightKg ?? set.weightKg,
      reps: fact.reps ?? set.reps,
      distanceKm: fact.distanceKm ?? set.distanceKm,
      durationSec,
      rpe: fact.rpe ?? set.rpe,
    }
  })

  const completed = values.filter((value) => !value.skipped)
  if (completed.length === 0) return 'Не выполнено'

  let summary: string
  if (inputKind === 'strength') {
    const withoutValues = completed.filter((value) => value.weightKg === undefined && value.reps === undefined).length
    if (withoutValues === completed.length) return mode === 'completed' ? 'Без результата' : 'Без значений'
    if (withoutValues > 0 && mode === 'planned') return 'Значения заполнены частично'
    const weights = completed.map((value) => value.weightKg)
    const commonWeight = weights[0] !== undefined && weights.every((weight) => weight === weights[0]) ? weights[0] : undefined
    const reps = values.map((value) => value.skipped || value.reps === undefined ? '—' : String(value.reps))
    if (commonWeight !== undefined) {
      const completedReps = completed.map((value) => value.reps)
      const sameCompleteReps = completedReps[0] !== undefined && completedReps.every((repetition) => repetition === completedReps[0])
      summary = sameCompleteReps && completed.length === values.length
        ? values.length === 1 ? `${commonWeight} кг × ${completedReps[0]}` : `${values.length} × ${commonWeight} кг × ${completedReps[0]}`
        : `${commonWeight} кг × ${compactSeries(reps)}`
    } else {
      summary = compactSeries(values.map((value) => value.skipped
        ? '—'
        : [value.weightKg !== undefined ? `${value.weightKg} кг` : null, value.reps !== undefined ? String(value.reps) : null].filter(Boolean).join(' × ') || 'без результата'))
    }
  } else if (inputKind === 'reps') {
    summary = repeatedSeries(values.map((value) => value.skipped || value.reps === undefined ? '—' : String(value.reps)), ' повт.')
  } else if (inputKind === 'duration') {
    summary = repeatedSeries(values.map((value) => value.skipped ? '—' : durationLabel(value.durationSec) ?? '—'))
  } else {
    const distances = completed.map((value) => runDistanceLabel(value.distanceKm))
    const commonDistance = distances[0] && distances.every((distance) => distance === distances[0]) ? distances[0] : null
    const durations = values.map((value) => value.skipped ? '—' : durationLabel(value.durationSec) ?? '—')
    const completedDurations = completed.map((value) => durationLabel(value.durationSec))
    const commonDuration = completedDurations[0] && completedDurations.every((duration) => duration === completedDurations[0]) ? completedDurations[0] : null
    if (commonDistance && commonDuration && completed.length === values.length) {
      summary = values.length === 1 ? `${commonDistance} · ${commonDuration}` : `${values.length} × ${commonDistance} · ${commonDuration}`
    } else if (commonDistance) {
      summary = `${commonDistance} · ${compactSeries(durations)}`
    } else {
      summary = compactSeries(values.map((value) => value.skipped
        ? '—'
        : [runDistanceLabel(value.distanceKm), durationLabel(value.durationSec)].filter(Boolean).join(' · ') || 'без значений'))
    }
    if (values.length === 1) {
      const pace = isRowingExerciseRef(exerciseRef)
        ? rowingPaceLabel(values[0]?.durationSec, values[0]?.distanceKm)
        : runPaceLabel(values[0]?.durationSec, values[0]?.distanceKm)
      if (pace) summary += ` · ${pace}`
    }
    if (isRowingExerciseRef(exerciseRef)) {
      const strokeRates = values.map((value) => value.skipped || value.reps === undefined ? '—' : String(value.reps))
      if (strokeRates.some((value) => value !== '—')) summary += ` · ${repeatedSeries(strokeRates)} гребков/мин`
    }
  }

  if (showRpe) {
    const rpeValues = values.map((value) => value.skipped || value.rpe === undefined ? '—' : String(value.rpe))
    if (rpeValues.some((value) => value !== '—')) summary += ` · RPE ${compactSeries(rpeValues)}`
  }
  return summary
}

// Результат подхода: строка факта (факт, иначе план) и приписка плана — только
// если факт был введён и отличается от плана хоть по одному параметру.
// Совпал факт с планом или факта нет вовсе → planNote = null.
export function formatFactVsPlan(set: WorkoutSet, showRpe = true, exerciseRef?: string): { fact: string; planNote: string | null } {
  const weight = set.fact.weightKg ?? set.weightKg
  const reps = set.fact.reps ?? set.reps
  const distance = set.fact.distanceKm ?? set.distanceKm
  const durationSec = set.fact.durationSec ?? set.durationSec
  const durationMin = durationSec === undefined ? (set.fact.durationMin ?? set.durationMin) : undefined
  const rpe = set.fact.rpe ?? set.rpe
  const fact = setLine(weight, reps, distance, durationSec, durationMin, rpe, showRpe, exerciseRef) || 'Без результата'
  const differs =
    (set.fact.weightKg !== undefined && set.fact.weightKg !== set.weightKg) ||
    (set.fact.reps !== undefined && set.fact.reps !== set.reps) ||
    (set.fact.distanceKm !== undefined && set.fact.distanceKm !== set.distanceKm) ||
    (set.fact.durationSec !== undefined && set.fact.durationSec !== set.durationSec) ||
    (set.fact.durationMin !== undefined && set.fact.durationMin !== set.durationMin) ||
    (showRpe && set.fact.rpe !== undefined && set.fact.rpe !== set.rpe)
  const planNote = differs ? `план ${setLine(set.weightKg, set.reps, set.distanceKm, set.durationSec, set.durationMin, set.rpe, showRpe, exerciseRef)}` : null
  return { fact, planNote }
}

// Введённые фактические значения без учёта статуса подхода. Используется в live,
// чтобы после перехода к следующей строке тренер видел набранные числа до
// подтверждения подхода.
export function enteredFactLine(set: WorkoutSet, showRpe = true, exerciseRef?: string): string | null {
  const line = setLine(set.fact.weightKg, set.fact.reps, set.fact.distanceKm, set.fact.durationSec, set.fact.durationMin, set.fact.rpe, showRpe, exerciseRef)
  return line || null
}

// Фактический результат подтверждённого подхода — строка вида «90 кг × 8 повт.».
// В истории и аналитике неподтверждённый ввод не считаем выполненным фактом.
export function factLine(set: WorkoutSet, showRpe = true, exerciseRef?: string): string | null {
  return set.confirmedAt ? enteredFactLine(set, showRpe, exerciseRef) : null
}

// Короткий ориентир для тренера: берём последний заполненный подход из прошлой
// завершённой тренировки. Это только справка — текущие значения не меняем.
export function previousResultLine(sets: readonly WorkoutSetDraft[], exerciseRef?: string): string | null {
  for (let index = sets.length - 1; index >= 0; index -= 1) {
    const set = sets[index]!
    const line = setLine(set.weightKg, set.reps, set.distanceKm, set.durationSec, set.durationMin, undefined, true, exerciseRef)
    if (line) return line
  }
  return null
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

export function copyWorkout(source: Workout, workoutDate = source.workoutDate, options: { refreshCatalogNames?: boolean } = {}): WorkoutDraft {
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
      name: options.refreshCatalogNames ? copiedExerciseName(exercise) : exercise.name, muscleGroup: exercise.muscleGroup, inputKind: exercise.inputKind,
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
  // Omitted results stay in the original plan. Do not turn them back into
  // performed sets when the saved result is opened for another edit.
  const editable = source.status === 'done' ? {
    ...source,
    exercises: source.exercises.flatMap((exercise) => {
      const sets = exercise.sets.filter((set) => set.confirmedAt)
      return sets.length ? [{ ...exercise, sets }] : []
    }),
  } : source
  const draft = copyWorkout(editable)
  return {
    ...draft,
    exercises: draft.exercises.map((exercise, exerciseIndex) => ({
      ...exercise,
      position: exerciseIndex,
      sourceExerciseId: editable.exercises[exerciseIndex]?.id,
      sets: exercise.sets.map((set, setIndex) => {
        const sourceSet = editable.exercises[exerciseIndex]?.sets[setIndex]
        const fact = sourceSet?.fact
        return {
          ...set,
          position: setIndex,
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
