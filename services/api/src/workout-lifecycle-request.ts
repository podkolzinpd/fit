const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/

export interface RescheduleWorkoutRequest {
  expectedVersion: number
  startTime: string | null
  workoutDate: string
}

export interface WorkoutCommentRequest {
  comment: string
  expectedVersion: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function expectedVersion(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
    ? value
    : undefined
}

function validDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return undefined
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined
}

function nullableTime(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null
  return typeof value === 'string' && TIME_PATTERN.test(value) ? value : undefined
}

export function readRescheduleWorkoutRequest(
  body: unknown,
): RescheduleWorkoutRequest | undefined {
  const input = record(body)
  if (input === undefined) return undefined
  const version = expectedVersion(input.expectedVersion)
  const workoutDate = validDate(input.workoutDate)
  const startTime = nullableTime(input.startTime)
  return version === undefined
    || workoutDate === undefined
    || startTime === undefined
    ? undefined
    : { expectedVersion: version, startTime, workoutDate }
}

export function readWorkoutCommentRequest(
  body: unknown,
): WorkoutCommentRequest | undefined {
  const input = record(body)
  if (input === undefined || typeof input.comment !== 'string') return undefined
  const version = expectedVersion(input.expectedVersion)
  const comment = input.comment.trim()
  return version === undefined || comment.length > 5_000
    ? undefined
    : { comment, expectedVersion: version }
}
