const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type Gender = 'male' | 'female'
export type MuscleGroup =
  | 'legs'
  | 'glutes'
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'arms'
  | 'core'
  | 'cardio'
  | 'other'
export type InputKind = 'strength' | 'distance' | 'reps' | 'duration'

export interface ClientCardDraft {
  fullName: string
  gender: Gender | null
  ageYears: number | null
  ageUpdatedAt: string | null
  heightCm: number | null
  goal: string | null
}

export interface CreateClientCardDraft extends ClientCardDraft {
  note: string | null
  initialWeightKg?: number | null
  initialWeightRecordedOn?: string | null
}

export interface VersionedClientCardRequest {
  draft: ClientCardDraft
  expectedVersion: number
}

export interface ClientPreferencesRequest {
  alias: string | null
  note: string | null
  expectedVersion: number
}

export interface ArchiveRequest {
  archived: boolean
  expectedVersion: number
}

export interface CustomExerciseDraft {
  name: string
  muscleGroup: MuscleGroup
  inputKind: InputKind
}

export interface VersionedCustomExerciseRequest {
  draft: CustomExerciseDraft
  expectedVersion: number
}

export interface ProfileDraft {
  firstName: string | null
  lastName: string | null
  timezone: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function nullableText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (normalized.length === 0) return null
  return normalized.length <= max ? normalized : undefined
}

function requiredText(value: unknown, min: number, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length >= min && normalized.length <= max
    ? normalized
    : undefined
}

function nullableMetric(
  value: unknown,
  min: number,
  max: number,
  integerOnly = false,
): number | null | undefined {
  if (value === null || value === undefined) return null
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= min
    && value <= max
    && (!integerOnly || Number.isInteger(value))
    ? value
    : undefined
}

function nullableDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return undefined
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined
}

function expectedVersion(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
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

function readClientFields(body: unknown): ClientCardDraft | undefined {
  const input = record(body)
  if (input === undefined) return undefined
  const fullName = requiredText(input.fullName, 2, 120)
  const gender = input.gender === null || input.gender === undefined || input.gender === ''
    ? null
    : enumValue(input.gender, ['male', 'female'] as const)
  const ageYears = nullableMetric(input.ageYears, 1, 119, true)
  const ageUpdatedAt = nullableDate(input.ageUpdatedAt)
  const heightCm = nullableMetric(input.heightCm, 0.01, 259.99)
  const goal = nullableText(input.goal, 5_000)
  if (
    fullName === undefined
    || gender === undefined
    || ageYears === undefined
    || ageUpdatedAt === undefined
    || heightCm === undefined
    || goal === undefined
  ) return undefined
  return { fullName, gender, ageYears, ageUpdatedAt, heightCm, goal }
}

export function readCreateClientCardDraft(
  body: unknown,
): CreateClientCardDraft | undefined {
  const input = record(body)
  const draft = readClientFields(body)
  const note = nullableText(input?.note, 5_000)
  const initialWeightKg = nullableMetric(input?.initialWeightKg, 0.01, 999.99)
  const initialWeightRecordedOn = nullableDate(input?.initialWeightRecordedOn)
  return draft === undefined || note === undefined || initialWeightKg === undefined
    || initialWeightRecordedOn === undefined
    || ((initialWeightKg === null) !== (initialWeightRecordedOn === null))
    ? undefined
    : { ...draft, note, initialWeightKg, initialWeightRecordedOn }
}

export function readVersionedClientCardRequest(
  body: unknown,
): VersionedClientCardRequest | undefined {
  const input = record(body)
  const draft = readClientFields(input?.draft)
  const version = expectedVersion(input?.expectedVersion)
  return draft === undefined || version === undefined
    ? undefined
    : { draft, expectedVersion: version }
}

export function readClientPreferencesRequest(
  body: unknown,
): ClientPreferencesRequest | undefined {
  const input = record(body)
  if (input === undefined) return undefined
  const alias = nullableText(input.alias, 120)
  const note = nullableText(input.note, 5_000)
  const version = expectedVersion(input.expectedVersion)
  return alias === undefined || note === undefined || version === undefined
    ? undefined
    : { alias, note, expectedVersion: version }
}

export function readArchiveRequest(body: unknown): ArchiveRequest | undefined {
  const input = record(body)
  const version = expectedVersion(input?.expectedVersion)
  return input === undefined
    || typeof input.archived !== 'boolean'
    || version === undefined
    ? undefined
    : { archived: input.archived, expectedVersion: version }
}

export function readCustomExerciseDraft(
  body: unknown,
): CustomExerciseDraft | undefined {
  const input = record(body)
  if (input === undefined) return undefined
  const name = requiredText(input.name, 1, 300)
  const muscleGroup = enumValue(input.muscleGroup, [
    'legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core',
    'cardio', 'other',
  ] as const)
  const inputKind = enumValue(input.inputKind, [
    'strength', 'distance', 'reps', 'duration',
  ] as const)
  return name === undefined || muscleGroup === undefined || inputKind === undefined
    ? undefined
    : { name, muscleGroup, inputKind }
}

export function readVersionedCustomExerciseRequest(
  body: unknown,
): VersionedCustomExerciseRequest | undefined {
  const input = record(body)
  const draft = readCustomExerciseDraft(input?.draft)
  const version = expectedVersion(input?.expectedVersion)
  return draft === undefined || version === undefined
    ? undefined
    : { draft, expectedVersion: version }
}

export function readProfileDraft(body: unknown): ProfileDraft | undefined {
  const input = record(body)
  if (input === undefined) return undefined
  const firstName = nullableText(input.firstName, 120)
  const lastName = nullableText(input.lastName, 120)
  const timezone = requiredText(input.timezone, 1, 100)
  if (firstName === undefined || lastName === undefined || timezone === undefined) {
    return undefined
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
  } catch {
    return undefined
  }
  return { firstName, lastName, timezone }
}
