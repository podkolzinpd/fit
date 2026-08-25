const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/

type MuscleGroup =
  | 'legs'
  | 'glutes'
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'arms'
  | 'core'
  | 'cardio'
  | 'other'
type InputKind = 'strength' | 'distance' | 'reps' | 'duration'
type ExerciseSource = 'system' | 'custom'
type BlockType = 'single' | 'group'
type BlockPreset = 'set' | 'circuit' | 'interval'

export interface PlannedWorkoutSetDraft {
  sourceSetId?: string
  position: number
  weightKg: number | null
  reps: number | null
  durationMin: number | null
  durationSec: number | null
  distanceKm: number | null
  rpe: number | null
}

export interface PlannedWorkoutExerciseDraft {
  sourceExerciseId?: string
  position: number
  source: ExerciseSource
  ref: string
  customExerciseId: string | null
  name: string
  muscleGroup: MuscleGroup
  inputKind: InputKind
  blockId: string
  blockType: BlockType
  blockPreset: BlockPreset
  blockRounds: number
  restBetweenExercisesSec: number
  restBetweenRoundsSec: number
  restBetweenSetsSec: number
  trainerComment: string | null
  sets: PlannedWorkoutSetDraft[]
}

export interface PlannedWorkoutDraft {
  id: string | null
  requestId?: string
  clientId: string
  workoutDate: string
  startTime: string | null
  endTime: string | null
  notes: string | null
  exercises: PlannedWorkoutExerciseDraft[]
}

export interface SavePlannedWorkoutRequest {
  draft: PlannedWorkoutDraft
  expectedVersion: number | null
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function uuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : undefined
}

function text(
  value: unknown,
  options: { nullable: true; max: number },
): string | null | undefined
function text(
  value: unknown,
  options: { nullable?: false; max: number },
): string | undefined
function text(
  value: unknown,
  options: { nullable?: boolean; max: number },
): string | null | undefined {
  if ((value === null || value === undefined) && options.nullable === true) return null
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (normalized.length === 0) return options.nullable === true ? null : undefined
  return normalized.length <= options.max ? normalized : undefined
}

function integer(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= min
    && value <= max
    ? value
    : undefined
}

function metric(
  value: unknown,
  max: number,
  integerOnly = false,
): number | null | undefined {
  if (value === null || value === undefined) return null
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || value > max
    || (integerOnly && !Number.isInteger(value))
  ) return undefined
  return value
}

function enumValue<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): Value | undefined {
  return typeof value === 'string' && allowed.includes(value as Value)
    ? value as Value
    : undefined
}

function validDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return undefined
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined
}

function nullableTime(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null
  return typeof value === 'string' && TIME_PATTERN.test(value) ? value : undefined
}

function timeValue(value: string): number {
  const [hours = '0', minutes = '0', seconds = '0'] = value.split(':')
  return Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds)
}

function readSet(value: unknown): PlannedWorkoutSetDraft | undefined {
  const input = record(value)
  if (input === undefined) return undefined
  const position = integer(input.position, 0, 32_767)
  const sourceSetId = input.sourceSetId === null || input.sourceSetId === undefined
    ? null
    : uuid(input.sourceSetId)
  const weightKg = metric(input.weightKg, 99_999)
  const reps = metric(input.reps, 2_147_483_647, true)
  const durationMin = metric(input.durationMin, 999_999)
  const durationSec = metric(input.durationSec, 2_147_483_647, true)
  const distanceKm = metric(input.distanceKm, 999_999)
  const rpe = metric(input.rpe, 10)
  if (
    position === undefined
    || sourceSetId === undefined
    || weightKg === undefined
    || reps === undefined
    || durationMin === undefined
    || durationSec === undefined
    || distanceKm === undefined
    || rpe === undefined
    || (rpe !== null && (rpe < 6 || !Number.isInteger(rpe * 2)))
  ) return undefined
  return {
    ...(sourceSetId === null ? {} : { sourceSetId }),
    position,
    weightKg,
    reps,
    durationMin,
    durationSec,
    distanceKm,
    rpe,
  }
}

function readExercise(value: unknown): PlannedWorkoutExerciseDraft | undefined {
  const input = record(value)
  if (input === undefined || !Array.isArray(input.sets)) return undefined
  const position = integer(input.position, 0, 32_767)
  const sourceExerciseId = input.sourceExerciseId === null
    || input.sourceExerciseId === undefined
    ? null
    : uuid(input.sourceExerciseId)
  const source = enumValue(input.source, ['system', 'custom'] as const)
  const ref = text(input.ref, { max: 300 })
  const customExerciseId = input.customExerciseId === null
    || input.customExerciseId === undefined
    ? null
    : uuid(input.customExerciseId)
  const name = text(input.name, { max: 300 })
  const muscleGroup = enumValue(input.muscleGroup, [
    'legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core',
    'cardio', 'other',
  ] as const)
  const inputKind = enumValue(input.inputKind, [
    'strength', 'distance', 'reps', 'duration',
  ] as const)
  const blockId = uuid(input.blockId)
  const blockType = enumValue(input.blockType, ['single', 'group'] as const)
  const blockPreset = enumValue(input.blockPreset, [
    'set', 'circuit', 'interval',
  ] as const)
  const blockRounds = integer(input.blockRounds, 1, 32_767)
  const restBetweenExercisesSec = integer(
    input.restBetweenExercisesSec,
    0,
    32_767,
  )
  const restBetweenRoundsSec = integer(input.restBetweenRoundsSec, 0, 32_767)
  const restBetweenSetsSec = integer(input.restBetweenSetsSec, 0, 32_767)
  const trainerComment = text(input.trainerComment, { nullable: true, max: 5_000 })
  const sets = input.sets.map(readSet)
  if (
    position === undefined
    || sourceExerciseId === undefined
    || source === undefined
    || ref === undefined
    || customExerciseId === undefined
    || name === undefined
    || muscleGroup === undefined
    || inputKind === undefined
    || blockId === undefined
    || blockType === undefined
    || blockPreset === undefined
    || blockRounds === undefined
    || restBetweenExercisesSec === undefined
    || restBetweenRoundsSec === undefined
    || restBetweenSetsSec === undefined
    || trainerComment === undefined
    || sets.some((set) => set === undefined)
    || new Set(sets.map((set) => set?.position)).size !== sets.length
    || (source === 'custom' && customExerciseId === null)
    || (source === 'system' && customExerciseId !== null)
  ) return undefined
  return {
    ...(sourceExerciseId === null ? {} : { sourceExerciseId }),
    position,
    source,
    ref,
    customExerciseId,
    name,
    muscleGroup,
    inputKind,
    blockId,
    blockType,
    blockPreset,
    blockRounds,
    restBetweenExercisesSec,
    restBetweenRoundsSec,
    restBetweenSetsSec,
    trainerComment,
    sets: sets as PlannedWorkoutSetDraft[],
  }
}

export function readSavePlannedWorkoutRequest(
  body: unknown,
  workoutId: string | null,
): SavePlannedWorkoutRequest | undefined {
  const input = record(body)
  if (input === undefined || !Array.isArray(input.exercises)) return undefined
  const clientId = uuid(input.clientId)
  const requestId = input.requestId === null || input.requestId === undefined
    ? null
    : uuid(input.requestId)
  const workoutDate = validDate(input.workoutDate)
  const startTime = nullableTime(input.startTime)
  const endTime = nullableTime(input.endTime)
  const notes = text(input.notes, { nullable: true, max: 5_000 })
  const exercises = input.exercises.map(readExercise)
  const expectedVersion = workoutId === null
    ? null
    : integer(input.expectedVersion, 1, Number.MAX_SAFE_INTEGER)
  if (
    clientId === undefined
    || requestId === undefined
    || workoutDate === undefined
    || startTime === undefined
    || endTime === undefined
    || notes === undefined
    || exercises.some((exercise) => exercise === undefined)
    || new Set(exercises.map((exercise) => exercise?.position)).size
      !== exercises.length
    || (
      startTime !== null
      && endTime !== null
      && timeValue(endTime) <= timeValue(startTime)
    )
    || (workoutId !== null && expectedVersion === undefined)
  ) return undefined
  return {
    draft: {
      id: workoutId,
      ...(requestId === null ? {} : { requestId }),
      clientId,
      workoutDate,
      startTime,
      endTime,
      notes,
      exercises: exercises as PlannedWorkoutExerciseDraft[],
    },
    expectedVersion: expectedVersion ?? null,
  }
}

export function readExpectedVersion(body: unknown): number | undefined {
  const input = record(body)
  return input === undefined
    ? undefined
    : integer(input.expectedVersion, 1, Number.MAX_SAFE_INTEGER)
}
