const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface LiveOperationRequest {
  expectedVersion: number
  operationId: string
}

export interface LiveSetDraft {
  weightKg: number | null
  reps: number | null
  durationMin: number | null
  durationSec: number | null
  distanceKm: number | null
  rpe: number | null
}

export interface LiveSetRequest extends LiveOperationRequest {
  draft: LiveSetDraft
}

type ExerciseSource = 'system' | 'custom'
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

export interface LiveExerciseSnapshot {
  customExerciseId: string | null
  inputKind: InputKind
  muscleGroup: MuscleGroup
  name: string
  ref: string
  source: ExerciseSource
}

export interface LiveExerciseRequest extends LiveOperationRequest {
  exercise: LiveExerciseSnapshot
}

export interface LiveReorderRequest extends LiveOperationRequest {
  direction: -1 | 1
}

export interface LiveCommentRequest extends LiveOperationRequest {
  comment: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function integer(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= min
    && value <= max
    ? value
    : undefined
}

function enumValue<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): Value | undefined {
  return typeof value === 'string' && allowed.includes(value as Value)
    ? value as Value
    : undefined
}

function text(value: unknown, max: number, allowBlank = false): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if ((!allowBlank && normalized.length === 0) || normalized.length > max) {
    return undefined
  }
  return normalized
}

function uuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : undefined
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

export function readLiveOperationRequest(
  body: unknown,
): LiveOperationRequest | undefined {
  const input = record(body)
  if (input === undefined) return undefined
  const expectedVersion = integer(
    input.expectedVersion,
    1,
    Number.MAX_SAFE_INTEGER,
  )
  const operationId = typeof input.operationId === 'string'
    && UUID_PATTERN.test(input.operationId)
    ? input.operationId
    : undefined
  return expectedVersion === undefined || operationId === undefined
    ? undefined
    : { expectedVersion, operationId }
}

export function readLiveSetRequest(body: unknown): LiveSetRequest | undefined {
  const operation = readLiveOperationRequest(body)
  const input = record(body)
  const draftInput = record(input?.draft)
  if (operation === undefined || draftInput === undefined) return undefined

  const weightKg = metric(draftInput.weightKg, 99_999)
  const reps = metric(draftInput.reps, 2_147_483_647, true)
  const durationMin = metric(draftInput.durationMin, 999_999)
  const durationSec = metric(draftInput.durationSec, 2_147_483_647, true)
  const distanceKm = metric(draftInput.distanceKm, 999_999)
  const rpe = metric(draftInput.rpe, 10)
  if (
    weightKg === undefined
    || reps === undefined
    || durationMin === undefined
    || durationSec === undefined
    || distanceKm === undefined
    || rpe === undefined
    || (rpe !== null && (rpe < 6 || !Number.isInteger(rpe * 2)))
  ) return undefined

  return {
    ...operation,
    draft: {
      weightKg,
      reps,
      durationMin,
      durationSec,
      distanceKm,
      rpe,
    },
  }
}

export function readLiveExerciseRequest(
  body: unknown,
): LiveExerciseRequest | undefined {
  const operation = readLiveOperationRequest(body)
  const input = record(body)
  const exerciseInput = record(input?.exercise)
  if (operation === undefined || exerciseInput === undefined) return undefined

  const source = enumValue(exerciseInput.source, ['system', 'custom'] as const)
  const ref = text(exerciseInput.ref, 300)
  const name = text(exerciseInput.name, 300)
  const muscleGroup = enumValue(exerciseInput.muscleGroup, [
    'legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core',
    'cardio', 'other',
  ] as const)
  const inputKind = enumValue(exerciseInput.inputKind, [
    'strength', 'distance', 'reps', 'duration',
  ] as const)
  const customExerciseId = exerciseInput.customExerciseId === null
    || exerciseInput.customExerciseId === undefined
    ? null
    : uuid(exerciseInput.customExerciseId)
  if (
    source === undefined
    || ref === undefined
    || name === undefined
    || muscleGroup === undefined
    || inputKind === undefined
    || customExerciseId === undefined
    || (source === 'custom' && customExerciseId === null)
    || (source === 'system' && customExerciseId !== null)
  ) return undefined

  return {
    ...operation,
    exercise: {
      customExerciseId,
      inputKind,
      muscleGroup,
      name,
      ref,
      source,
    },
  }
}

export function readLiveReorderRequest(
  body: unknown,
): LiveReorderRequest | undefined {
  const operation = readLiveOperationRequest(body)
  const input = record(body)
  if (
    operation === undefined
    || (input?.direction !== -1 && input?.direction !== 1)
  ) return undefined
  return { ...operation, direction: input.direction }
}

export function readLiveCommentRequest(
  body: unknown,
): LiveCommentRequest | undefined {
  const operation = readLiveOperationRequest(body)
  const input = record(body)
  const comment = text(input?.comment, 5_000, true)
  return operation === undefined || comment === undefined
    ? undefined
    : { ...operation, comment }
}
