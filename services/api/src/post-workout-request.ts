export type WorkoutWellbeing = 'good' | 'normal' | 'hard'
export type WorkoutTrainerReaction = 'thumbs_up' | 'fire' | 'strong'

export interface WorkoutFeedbackRequest {
  sessionRpe: number
  wellbeing: WorkoutWellbeing
  discomfort: boolean
  comment: string
  expectedVersion: number
}

export interface WorkoutTrainerResponseRequest {
  reaction: WorkoutTrainerReaction | null
  review: string
  expectedVersion: number
}

export interface WorkoutQuestionRequest {
  question: string
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

export function readWorkoutFeedbackRequest(
  body: unknown,
): WorkoutFeedbackRequest | undefined {
  const input = record(body)
  if (input === undefined) return undefined
  const version = expectedVersion(input.expectedVersion)
  const comment = typeof input.comment === 'string' ? input.comment.trim() : undefined
  if (
    version === undefined
    || typeof input.sessionRpe !== 'number'
    || !Number.isInteger(input.sessionRpe)
    || input.sessionRpe < 1
    || input.sessionRpe > 10
    || !['good', 'normal', 'hard'].includes(String(input.wellbeing))
    || typeof input.discomfort !== 'boolean'
    || comment === undefined
    || comment.length > 500
    || (input.discomfort && comment.length === 0)
  ) return undefined
  return {
    sessionRpe: input.sessionRpe,
    wellbeing: input.wellbeing as WorkoutWellbeing,
    discomfort: input.discomfort,
    comment,
    expectedVersion: version,
  }
}

export function readWorkoutTrainerResponseRequest(
  body: unknown,
): WorkoutTrainerResponseRequest | undefined {
  const input = record(body)
  if (input === undefined) return undefined
  const version = expectedVersion(input.expectedVersion)
  const review = typeof input.review === 'string' ? input.review.trim() : undefined
  const reaction = input.reaction === null || input.reaction === undefined
    ? null
    : typeof input.reaction === 'string'
      && ['thumbs_up', 'fire', 'strong'].includes(input.reaction)
      ? input.reaction as WorkoutTrainerReaction
      : undefined
  if (
    version === undefined
    || review === undefined
    || review.length > 500
    || reaction === undefined
  ) return undefined
  return { reaction, review, expectedVersion: version }
}

export function readWorkoutQuestionRequest(
  body: unknown,
): WorkoutQuestionRequest | undefined {
  const input = record(body)
  if (input === undefined) return undefined
  const version = expectedVersion(input.expectedVersion)
  const question = typeof input.question === 'string' ? input.question.trim() : undefined
  if (version === undefined || question === undefined
    || question.length === 0 || question.length > 500) return undefined
  return { question, expectedVersion: version }
}
