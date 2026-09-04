import { z } from 'zod'
import type { DataBackend } from '../../app/data-backend-context'
import type {
  Client,
  ClientGoal,
  ClientTrainingSummary,
  ExerciseProgressPage,
  ExerciseSnapshot,
  ProgressDraft,
  ProgressEntry,
  PublishedTrainingSummary,
  SaveClientGoalInput,
  SaveGoalStageInput,
  SessionActor,
  TrainerAttentionWorkout,
  TrainerMembership,
  Workout,
  WorkoutDraft,
  WorkoutPersonalRecord,
  WorkoutSetDraft,
  WorkoutSummary,
} from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { validateGoalCriteriaSuggestion } from '../../shared/goal-criteria-suggestions'
import { SYSTEM_EXERCISE_CATALOG } from '../../shared/system-exercises'
import { isActiveCatalogExercise } from '../../shared/exercise-catalog-retirement'
import { subscribeToPush, unsubscribeFromPush } from '../../features/notifications/push-subscription'
import { createYandexMainQueries, type YandexMainQueries } from '../queries/yandex-main.queries'
import { toJson } from '../queries/json'
import { currentAppFeedbackContext } from './app-feedback.repository'
import type { CustomExercise } from './exercises.repository'
import { RepositoryError } from './error'
import { roundMetric } from './progress.repository'
import {
  publishedTrainingSummaryFromRow,
  trainingSummaryFromRow,
} from './training-summaries.repository'
import { yandexPilotRepository, type YandexPilotTrainingData } from './yandex-pilot.repository'

const uuid = z.uuid()
const clientSchema = z.object({
  id: uuid,
  hasAccount: z.boolean(),
  fullName: z.string(),
  canonicalFullName: z.string(),
  gender: z.enum(['male', 'female']).nullable(),
  ageYears: z.number().int().nullable(),
  ageUpdatedAt: z.iso.date().nullable(),
  heightCm: z.number().nullable(),
  goal: z.string().nullable(),
  note: z.string().nullable(),
  currentWeightKg: z.number().nullable(),
  lastActivityAt: z.iso.datetime().optional(),
  archivedAt: z.iso.datetime().nullable(),
  version: z.number().int().positive(),
  membershipVersion: z.number().int().positive().nullable(),
})
const clientsSchema = z.object({ clients: z.array(clientSchema) })
const membershipSchema = z.object({
  clientId: uuid,
  trainerId: uuid,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  joinedAt: z.iso.datetime(),
  isRoot: z.boolean(),
})
const invitationSchema = z.object({
  id: uuid,
  clientId: uuid,
  targetRole: z.enum(['client', 'trainer']),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
})
const connectionsSchema = z.object({
  memberships: z.array(membershipSchema),
  invitations: z.array(invitationSchema),
})
const customMetricSchema = z.object({
  id: uuid,
  clientId: uuid,
  name: z.string(),
  unit: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  version: z.number().int().positive(),
})
const progressEntrySchema = z.object({
  id: uuid,
  clientId: uuid,
  createdBy: uuid.nullable(),
  recordedOn: z.iso.date(),
  weightKg: z.number().nullable().optional(),
  chestCm: z.number().nullable().optional(),
  waistCm: z.number().nullable().optional(),
  hipCm: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  customMetrics: z.array(z.object({ metricId: uuid, value: z.number() })),
  version: z.number().int().positive(),
})
const goalCriterionSchema = z.object({
  id: uuid,
  goalId: uuid,
  metric: z.enum(['weight', 'waist', 'chest', 'hips', 'exercise_working_weight', 'exercise_reps', 'exercise_volume', 'exercise_best_result', 'cardio_distance', 'cardio_duration', 'cardio_pace', 'cardio_distance_time', 'workout_regularity', 'custom']),
  operation: z.enum(['decrease_to', 'increase_to', 'maintain_range', 'change_by', 'track_only']),
  targetValue: z.number().nullable(),
  rangeMin: z.number().nullable(),
  rangeMax: z.number().nullable(),
  unit: z.string(),
  baselineValue: z.number().nullable().optional(),
  baselineRecordedOn: z.iso.date().nullable().optional(),
  secondaryTargetValue: z.number().nullable().optional(),
  secondaryUnit: z.string().nullable().optional(),
  exerciseSource: z.enum(['system', 'custom']).nullable().optional(),
  exerciseRef: z.string().nullable().optional(),
  exerciseName: z.string().nullable().optional(),
  customExerciseId: uuid.nullable().optional(),
  customMetricId: uuid.nullable().optional(),
  customMetricName: z.string().nullable().optional(),
  regularityPeriod: z.enum(['week', 'month']).nullable().optional(),
  regularityMode: z.enum(['average', 'each_period']).nullable().optional(),
  confirmationStatus: z.enum(['suggested', 'confirmed', 'needs_review']),
  position: z.number().int().nonnegative(),
  version: z.number().int().positive(),
})
const goalSchema = z.object({
  id: uuid,
  clientId: uuid,
  title: z.string(),
  targetDate: z.iso.date().nullable(),
  status: z.enum(['active', 'archived']),
  version: z.number().int().positive(),
  stages: z.array(z.object({
    id: uuid,
    goalId: uuid,
    title: z.string(),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    position: z.number().int().nonnegative(),
    version: z.number().int().positive(),
  })),
  criteria: z.array(goalCriterionSchema).optional(),
}).nullable()
const progressBundleSchema = z.object({
  entries: z.array(progressEntrySchema),
  customMetrics: z.array(customMetricSchema),
  goal: goalSchema,
})
const regularitySchema = z.object({ regularity: z.array(z.object({
  period: z.enum(['week', 'month']),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  plannedCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  completedPlannedCount: z.number().int().nonnegative(),
  partialCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  completionPercent: z.number().int().nullable(),
})) })
const runningSchema = z.object({ sessions: z.array(z.object({
  workoutId: uuid,
  workoutDate: z.iso.date(),
  format: z.enum(['free', 'easy', 'long', 'tempo', 'recovery', 'interval', 'interval_active', 'mixed']),
  distanceKm: z.number().optional(),
  durationSec: z.number().optional(),
  paceSecPerKm: z.number().optional(),
  rpe: z.number().optional(),
})) })
const exerciseProgressSchema = z.object({
  items: z.array(z.object({
    workoutId: uuid,
    workoutDate: z.iso.date(),
    completedAt: z.iso.datetime(),
    exerciseName: z.string(),
    inputKind: z.enum(['strength', 'distance', 'reps', 'duration']),
    confirmedSetCount: z.number().int().nonnegative(),
    primaryValue: z.number().nullable(),
    previousPrimaryValue: z.number().nullable(),
    primaryChange: z.number().nullable(),
    allTimePrimaryValue: z.number().nullable(),
    bestWeightKg: z.number().nullable(),
    repsAtBestWeight: z.number().int().nullable(),
    bestWeightReps: z.number().nullable(),
    allTimeBestWeightKg: z.number().nullable(),
    allTimeBestWeightReps: z.number().nullable(),
    isPrimaryPr: z.boolean(),
    isWeightPr: z.boolean(),
    isWeightRepsPr: z.boolean(),
    trainerComment: z.string().nullable(),
    sets: z.array(z.object({
      weightKg: z.number().nullable().optional(),
      reps: z.number().nullable().optional(),
      durationSec: z.number().nullable().optional(),
      distanceKm: z.number().nullable().optional(),
      rpe: z.number().nullable().optional(),
    })),
  })),
  nextCursor: z.object({ completedAt: z.iso.datetime(), workoutId: uuid }).nullable(),
  totalCount: z.number().int().nonnegative(),
})
const internalSummarySchema = z.object({
  id: uuid, client_id: uuid, period_start: z.iso.date(), period_end: z.iso.date(),
  trainer_summary: z.record(z.string(), z.unknown()),
  client_summary: z.record(z.string(), z.unknown()),
  display_metrics: z.record(z.string(), z.unknown()),
  generated_at: z.iso.datetime(), version: z.number().int().positive(),
  published: z.boolean().optional(),
})
const publishedSummarySchema = z.object({
  id: uuid, source_summary_id: uuid, client_id: uuid,
  period_start: z.iso.date(), period_end: z.iso.date(),
  summary: z.record(z.string(), z.unknown()),
  display_metrics: z.record(z.string(), z.unknown()),
  generated_at: z.iso.datetime(), published_at: z.iso.datetime(),
})

function errorForStatus(status: number, code?: string): RepositoryError {
  if (status === 401) return new RepositoryError('session_expired', 'Сессия Yandex ID истекла. Войдите заново.')
  if (status === 403) return new RepositoryError('PT403', 'Недостаточно прав для этого действия.')
  if (status === 404) return new RepositoryError('PT404', 'Запись не найдена или больше недоступна.')
  if (status === 409) {
    return new RepositoryError(code === 'active_workout_exists' ? code : 'PT409',
      code === 'active_workout_exists'
        ? 'У клиента уже идёт другая тренировка. Откройте её и продолжите.'
        : 'Данные уже изменились. Обновите страницу и повторите.')
  }
  if (status === 422) return new RepositoryError('PT422', 'Операцию нельзя выполнить с текущими данными.')
  if (status >= 500) return new RepositoryError('service_unavailable', 'Yandex Cloud временно недоступен. Попробуйте позднее.')
  return new RepositoryError('invalid_request', 'Сервер не принял запрос. Проверьте данные и повторите.')
}

async function response(work: () => Promise<Response>): Promise<Response> {
  let result: Response
  try { result = await work() } catch (error) {
    throw new RepositoryError('network_unavailable', 'Не удалось подключиться к серверу. Проверьте интернет и повторите попытку.', { cause: error })
  }
  if (result.ok) return result
  let code: string | undefined
  try {
    const payload = z.object({ error: z.string().optional() }).parse(await result.clone().json())
    code = payload.error
  } catch {
    code = undefined
  }
  throw errorForStatus(result.status, code)
}

async function readJson<Schema extends z.ZodType>(
  queries: YandexMainQueries,
  path: string,
  schema: Schema,
): Promise<z.output<Schema>> {
  const result = await response(() => queries.read(path))
  return schema.parse(await result.json())
}

async function writeJson<Schema extends z.ZodType>(
  queries: YandexMainQueries,
  path: string,
  method: 'DELETE' | 'POST' | 'PUT',
  body: object | undefined,
  schema: Schema,
): Promise<z.output<Schema>> {
  const result = await response(() => queries.write(path, method, body))
  return schema.parse(await result.json())
}

async function writeEmpty(
  queries: YandexMainQueries,
  path: string,
  method: 'DELETE' | 'POST' | 'PUT',
  body?: object,
): Promise<void> {
  await response(() => queries.write(path, method, body))
}

function client(value: z.infer<typeof clientSchema>): Client {
  return {
    ...value,
    ageUpdatedAt: value.ageUpdatedAt === null ? null : localDate(value.ageUpdatedAt),
    lastActivityAt: value.lastActivityAt,
  }
}

function customExercise(value: YandexPilotTrainingData['customExercises'][number]): CustomExercise {
  return {
    id: value.id,
    source: 'custom',
    ref: value.id,
    customExerciseId: value.id,
    name: value.name,
    muscleGroup: value.muscleGroup,
    inputKind: value.inputKind,
    createdBy: value.createdBy ?? '',
    archivedAt: value.archivedAt,
    version: value.version,
  }
}

function workout(value: YandexPilotTrainingData['workouts'][number]): Workout {
  return {
    id: value.id,
    trainerId: value.trainerId,
    clientId: value.clientId,
    clientName: value.clientName,
    createdBy: value.createdBy,
    workoutDate: localDate(value.workoutDate),
    startTime: value.startTime,
    endTime: value.endTime,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    status: value.status,
    notes: value.notes,
    trainerReview: value.trainerReview ?? undefined,
    trainerReaction: value.trainerReaction ?? undefined,
    trainerReviewAuthorId: value.trainerReviewAuthorId ?? undefined,
    trainerReviewedAt: value.trainerReviewedAt ?? undefined,
    clientComment: value.clientComment ?? undefined,
    sessionRpe: value.sessionRpe ?? undefined,
    wellbeing: value.wellbeing ?? undefined,
    discomfort: value.discomfort ?? undefined,
    feedbackSubmittedAt: value.feedbackSubmittedAt ?? undefined,
    clientQuestion: value.clientQuestion ?? undefined,
    clientQuestionAskedAt: value.clientQuestionAskedAt ?? undefined,
    clientQuestionResolvedAt: value.clientQuestionResolvedAt ?? undefined,
    stageId: value.stageId ?? null,
    stageTitle: value.stageTitle ?? null,
    hasPr: value.hasPr ?? false,
    version: value.version,
    exercises: value.exercises.map((exercise) => ({
      id: exercise.id,
      position: exercise.position,
      source: exercise.source,
      ref: exercise.ref,
      customExerciseId: exercise.customExerciseId ?? undefined,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      inputKind: exercise.inputKind,
      blockId: exercise.blockId,
      blockType: exercise.blockType,
      blockPreset: exercise.blockPreset,
      blockRounds: exercise.blockRounds,
      restBetweenExercisesSec: exercise.restBetweenExercisesSec,
      restBetweenRoundsSec: exercise.restBetweenRoundsSec,
      restBetweenSetsSec: exercise.restBetweenSetsSec,
      trainerComment: exercise.trainerComment ?? undefined,
      sets: exercise.sets.map((set) => ({
        id: set.id,
        position: set.position,
        weightKg: set.plan.weightKg ?? undefined,
        reps: set.plan.reps ?? undefined,
        durationMin: set.plan.durationMin ?? undefined,
        durationSec: set.plan.durationSec ?? undefined,
        distanceKm: set.plan.distanceKm ?? undefined,
        rpe: set.plan.rpe ?? undefined,
        fact: {
          weightKg: set.fact.weightKg ?? undefined,
          reps: set.fact.reps ?? undefined,
          durationMin: set.fact.durationMin ?? undefined,
          durationSec: set.fact.durationSec ?? undefined,
          distanceKm: set.fact.distanceKm ?? undefined,
          rpe: set.fact.rpe ?? undefined,
        },
        confirmedAt: set.confirmedAt,
        version: set.version,
      })),
    })),
  }
}

function workoutDraft(draft: WorkoutDraft): Record<string, unknown> {
  return {
    clientId: draft.clientId,
    requestId: draft.requestId ?? null,
    workoutDate: draft.workoutDate,
    startTime: draft.startTime ?? null,
    endTime: draft.endTime ?? null,
    notes: draft.notes ?? null,
    stageId: draft.stageId ?? null,
    ...(draft.id === undefined ? {} : { expectedVersion: draft.version }),
    exercises: draft.exercises.map((exercise) => ({
      sourceExerciseId: exercise.sourceExerciseId ?? null,
      position: exercise.position,
      source: exercise.source,
      ref: exercise.ref,
      customExerciseId: exercise.customExerciseId ?? null,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      inputKind: exercise.inputKind,
      blockId: exercise.blockId ?? crypto.randomUUID(),
      blockType: exercise.blockType ?? 'single',
      blockPreset: exercise.blockPreset ?? 'set',
      blockRounds: exercise.blockRounds ?? 1,
      restBetweenExercisesSec: exercise.restBetweenExercisesSec ?? 0,
      restBetweenRoundsSec: exercise.restBetweenRoundsSec ?? 0,
      restBetweenSetsSec: exercise.restBetweenSetsSec ?? 0,
      trainerComment: exercise.trainerComment ?? null,
      sets: exercise.sets.map((set) => ({
        sourceSetId: set.sourceSetId ?? null,
        position: set.position,
        weightKg: set.weightKg ?? null,
        reps: set.reps ?? null,
        durationMin: set.durationMin ?? null,
        durationSec: set.durationSec ?? null,
        distanceKm: set.distanceKm ?? null,
        rpe: set.rpe ?? null,
      })),
    })),
  }
}

function progressDraft(draft: ProgressDraft): Record<string, unknown> {
  return {
    id: draft.id ?? null,
    clientId: draft.clientId,
    recordedOn: draft.recordedOn,
    weightKg: draft.weightKg ?? null,
    chestCm: draft.chestCm ?? null,
    waistCm: draft.waistCm ?? null,
    hipCm: draft.hipCm ?? null,
    notes: draft.notes ?? null,
    customMetrics: draft.customMetrics.map((metric) => ({
      ...metric,
      value: roundMetric(metric.value),
    })),
  }
}

function goalDraft(input: SaveClientGoalInput): Record<string, unknown> {
  const criterion = (value: NonNullable<SaveClientGoalInput['criterion']>) => ({
    id: value.id ?? null,
    version: value.version ?? null,
    metric: value.metric,
    operation: value.operation,
    targetValue: value.targetValue ?? null,
    rangeMin: value.rangeMin ?? null,
    rangeMax: value.rangeMax ?? null,
    unit: value.unit,
    secondaryTargetValue: value.secondaryTargetValue ?? null,
    secondaryUnit: value.secondaryUnit ?? null,
    exerciseSource: value.exerciseSource ?? null,
    exerciseRef: value.exerciseRef ?? null,
    exerciseName: value.exerciseName ?? null,
    customExerciseId: value.customExerciseId ?? null,
    customMetricId: value.customMetricId ?? null,
    customMetricName: value.customMetricName ?? null,
    regularityPeriod: value.regularityPeriod ?? null,
    regularityMode: value.regularityMode ?? null,
    confirmationStatus: value.confirmationStatus,
    position: value.position ?? 0,
  })
  return {
    id: input.id ?? null,
    clientId: input.clientId,
    title: input.title,
    targetDate: input.targetDate ?? null,
    ...(input.criteria !== undefined && input.criteria !== null
      ? { criteria: input.criteria.map(criterion) }
      : input.criterion === undefined
        ? {}
        : { criterion: input.criterion === null ? null : criterion(input.criterion) }),
  }
}

function mapGoal(value: Exclude<z.infer<typeof goalSchema>, null>): ClientGoal {
  return {
    id: value.id,
    clientId: value.clientId,
    title: value.title,
    targetDate: value.targetDate === null ? null : localDate(value.targetDate),
    status: value.status,
    version: value.version,
    stages: value.stages.map((stage) => ({
      ...stage,
      startsOn: localDate(stage.startsOn),
      endsOn: localDate(stage.endsOn),
    })),
    criteria: (value.criteria ?? []).map((item) => ({
      ...item,
      baselineValue: item.baselineValue ?? null,
      baselineRecordedOn: item.baselineRecordedOn ? localDate(item.baselineRecordedOn) : null,
      secondaryTargetValue: item.secondaryTargetValue ?? null,
      secondaryUnit: item.secondaryUnit ?? null,
      exerciseSource: item.exerciseSource ?? null,
      exerciseRef: item.exerciseRef ?? null,
      exerciseName: item.exerciseName ?? null,
      customExerciseId: item.customExerciseId ?? null,
      customMetricId: item.customMetricId ?? null,
      customMetricName: item.customMetricName ?? null,
      regularityPeriod: item.regularityPeriod ?? null,
      regularityMode: item.regularityMode ?? null,
    })),
  }
}

function feedbackPayload(summary: ClientTrainingSummary): Record<string, unknown> {
  return {
    headline: summary.headline,
    achievements: summary.achievements,
    consistency: summary.consistency,
    encouragement: summary.encouragement,
    goalAlignment: summary.goalAlignment ?? '',
    nextSteps: summary.nextSteps ?? [],
  }
}

export function createYandexMainRepository(
  apiBaseUrl: string,
  sessionToken: string,
  actor: SessionActor,
): DataBackend {
  const queries = createYandexMainQueries(apiBaseUrl, sessionToken)
  let trainingDataPromise: Promise<YandexPilotTrainingData> | null = null
  let clientsPromise: Promise<Client[]> | null = null
  let connectionsPromise: Promise<z.infer<typeof connectionsSchema>> | null = null
  const invalidate = () => {
    trainingDataPromise = null
    clientsPromise = null
    connectionsPromise = null
  }
  const trainingData = async () => {
    trainingDataPromise ??= (async () => {
      const first = await yandexPilotRepository.listTrainingData(apiBaseUrl, sessionToken, 'read_write', { limit: 100, offset: 0 })
      const workouts = [...first.workouts]
      for (let offset = workouts.length; first.hasMoreWorkouts && offset < (first.totalWorkouts ?? Number.MAX_SAFE_INTEGER); offset = workouts.length) {
        const page = await yandexPilotRepository.listTrainingData(apiBaseUrl, sessionToken, 'read_write', { limit: 100, offset })
        workouts.push(...page.workouts)
        if (!page.hasMoreWorkouts || page.workouts.length === 0) break
      }
      return { ...first, workouts, hasMoreWorkouts: false, totalWorkouts: workouts.length }
    })()
    return trainingDataPromise
  }
  const clients = async () => {
    clientsPromise ??= readJson(queries, '/v1/clients', clientsSchema)
      .then((payload) => payload.clients.map(client))
    return clientsPromise
  }
  const connections = async () => {
    connectionsPromise ??= readJson(queries, '/v1/connections', connectionsSchema)
    return connectionsPromise
  }
  const commandVersion = async (path: string, method: 'POST' | 'PUT', body: object) => {
    const payload = await writeJson(queries, path, method, body, z.object({
      workout: z.object({ version: z.number().int().positive() }),
    }))
    invalidate()
    return payload.workout.version
  }
  const liveCommand = async (path: string, method: 'POST' | 'PUT' | 'DELETE', expectedVersion: number, body: object = {}) => {
    const payload = await writeJson(queries, path, method, {
      ...body, expectedVersion, operationId: crypto.randomUUID(),
    }, z.union([
      z.object({ workout: z.object({ version: z.number().int().positive() }) }),
      z.object({ exercise: z.object({ version: z.number().int().positive() }) }),
      z.object({ set: z.object({ version: z.number().int().positive() }) }),
      z.object({ block: z.object({ version: z.number().int().positive() }) }),
    ]))
    invalidate()
    if ('workout' in payload) return payload.workout.version
    if ('exercise' in payload) return payload.exercise.version
    if ('set' in payload) return payload.set.version
    return payload.block.version
  }

  return {
    source: 'yandex',
    clients: {
      async getMine() {
        if (actor.kind !== 'client') return null
        return (await clients()).find((item) => item.id === actor.clientId) ?? null
      },
      async resolveId(id) {
        if ((await clients()).some((item) => item.id === id)) return id
        throw new Error('Карточка клиента не найдена')
      },
      async list(includeArchived = false) {
        return (await clients()).filter((item) => includeArchived || item.archivedAt === null)
      },
      async listAttentionPreferences() {
        const data = await trainingData()
        return data.attentionPreferences.map((item) => ({
          clientId: item.clientId,
          snoozedUntil: item.snoozedUntil ?? undefined,
        }))
      },
      async get(id) {
        const result = (await clients()).find((item) => item.id === id)
        if (!result) throw new Error('Карточка клиента не найдена')
        return result
      },
      async create(input) {
        const payload = await writeJson(queries, '/v1/clients', 'POST', {
          fullName: input.fullName, gender: input.gender, ageYears: input.ageYears,
          ageUpdatedAt: input.ageUpdatedAt, heightCm: input.heightCm,
          goal: input.goal ?? null, note: input.note ?? null,
          initialWeightKg: input.initialWeightKg ?? null,
          initialWeightRecordedOn: input.initialWeightRecordedOn ?? null,
        }, z.object({ client: z.object({ id: uuid }) }))
        invalidate()
        return payload.client.id
      },
      async createQuick(fullName) {
        const payload = await writeJson(queries, '/v1/clients', 'POST', {
          fullName, gender: null, ageYears: null, ageUpdatedAt: null, heightCm: null,
          goal: null, note: null, initialWeightKg: null, initialWeightRecordedOn: null,
        }, z.object({ client: z.object({ id: uuid }) }))
        invalidate()
        return payload.client.id
      },
      async createQuickOwn(fullName) {
        return this.createQuick(fullName)
      },
      async createOwn(input) {
        return this.create(input)
      },
      async update(input) {
        await writeJson(queries, `/v1/clients/${input.id}`, 'PUT', {
          draft: { fullName: input.fullName, gender: input.gender, ageYears: input.ageYears,
            ageUpdatedAt: input.ageUpdatedAt, heightCm: input.heightCm, goal: input.goal ?? null },
          expectedVersion: input.version,
        }, z.object({ client: z.object({ id: uuid, version: z.number().int().positive() }) }))
        invalidate()
      },
      async updateOwn(input) { await this.update(input) },
      async updatePreferences(input) {
        await writeJson(queries, `/v1/clients/${input.clientId}/preferences`, 'PUT', {
          alias: input.alias, note: input.note ?? null, expectedVersion: input.version,
        }, z.object({ client: z.object({ membershipVersion: z.number().int().positive() }) }))
        invalidate()
      },
      async setArchived(item, archived) {
        const payload = await writeJson(queries, `/v1/clients/${item.id}/archive`, 'PUT', {
          archived, expectedVersion: item.version,
        }, z.object({ client: z.object({ version: z.number().int().positive() }) }))
        invalidate()
        return { ...item, archivedAt: archived ? new Date().toISOString() : null, version: payload.client.version }
      },
    },
    exercises: {
      system: SYSTEM_EXERCISE_CATALOG,
      parseWorkout: (text, systemCatalog) => yandexPilotRepository.parseWorkout(
        apiBaseUrl, sessionToken, text, systemCatalog, 'read_write',
      ),
      async suggestGoalCriteria(text, catalog, metrics) {
        const result = await response(() => queries.write('/v1/assistant/yandex/suggest-goal-criteria', 'POST', {
          kind: 'goal_criteria', text,
          systemCatalog: catalog.filter((item) => item.source === 'system' && isActiveCatalogExercise(item)),
          customMetrics: metrics,
        }))
        return validateGoalCriteriaSuggestion(await result.json(), catalog, metrics)
      },
      async list() { return (await trainingData()).customExercises.map(customExercise) },
      async create(_partitionOwnerId, value) {
        const payload = await writeJson(queries, '/v1/custom-exercises', 'POST', value,
          z.object({ exercise: z.object({ id: uuid, name: z.string(), muscleGroup: z.enum(['legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core', 'cardio', 'other']), inputKind: z.enum(['strength', 'distance', 'reps', 'duration']), archivedAt: z.iso.datetime().nullable(), version: z.number().int().positive() }) }))
        invalidate()
        return customExercise({ ...payload.exercise, createdBy: actor.userId })
      },
      async update(item, value) {
        const payload = await writeJson(queries, `/v1/custom-exercises/${item.id}`, 'PUT', {
          draft: value, expectedVersion: item.version,
        }, z.object({ exercise: z.object({ id: uuid, name: z.string(), muscleGroup: z.enum(['legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core', 'cardio', 'other']), inputKind: z.enum(['strength', 'distance', 'reps', 'duration']), archivedAt: z.iso.datetime().nullable(), version: z.number().int().positive() }) }))
        invalidate()
        return customExercise({ ...payload.exercise, createdBy: item.createdBy })
      },
      async setArchived(item, archived) {
        const payload = await writeJson(queries, `/v1/custom-exercises/${item.id}/archive`, 'PUT', {
          archived, expectedVersion: item.version,
        }, z.object({ exercise: z.object({ id: uuid, name: z.string(), muscleGroup: z.enum(['legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core', 'cardio', 'other']), inputKind: z.enum(['strength', 'distance', 'reps', 'duration']), archivedAt: z.iso.datetime().nullable(), version: z.number().int().positive() }) }))
        invalidate()
        return customExercise({ ...payload.exercise, createdBy: item.createdBy })
      },
    },
    progress: {
      async regularity(clientId) {
        const payload = await readJson(queries, `/v1/clients/${clientId}/progress/regularity`, regularitySchema)
        return payload.regularity.map((item) => ({ ...item, periodStart: localDate(item.periodStart), periodEnd: localDate(item.periodEnd) }))
      },
      async running(clientId, periodStart, periodEnd) {
        const payload = await readJson(queries, `/v1/clients/${clientId}/progress/running?from=${encodeURIComponent(periodStart)}&to=${encodeURIComponent(periodEnd)}`, runningSchema)
        return payload.sessions.map((item) => ({ ...item, workoutDate: localDate(item.workoutDate) }))
      },
      async list(clientId) {
        const payload = await readJson(queries, `/v1/clients/${clientId}/progress`, progressBundleSchema)
        return payload.entries.map((item): ProgressEntry => ({
          id: item.id, clientId: item.clientId, createdBy: item.createdBy,
          recordedOn: localDate(item.recordedOn), weightKg: item.weightKg ?? undefined,
          chestCm: item.chestCm ?? undefined, waistCm: item.waistCm ?? undefined,
          hipCm: item.hipCm ?? undefined, notes: item.notes ?? undefined,
          customMetrics: item.customMetrics, version: item.version,
        }))
      },
      async save(draft) {
        const path = draft.id === undefined ? '/v1/progress' : `/v1/progress/${draft.id}`
        const payload = await writeJson(queries, path, draft.id === undefined ? 'POST' : 'PUT', {
          draft: progressDraft(draft), expectedVersion: draft.version ?? null,
        }, z.object({ progress: z.object({ id: uuid }) }))
        invalidate()
        return payload.progress.id
      },
      async remove(entry) {
        await writeJson(queries, `/v1/progress/${entry.id}`, 'DELETE', {
          expectedVersion: entry.version,
        }, z.object({ progress: z.object({ version: z.number().int().positive() }) }))
        invalidate()
      },
      async listMetrics(clientId) {
        const payload = await readJson(queries, `/v1/clients/${clientId}/progress`, progressBundleSchema)
        return payload.customMetrics
      },
      async createMetric(clientId, name, unit) {
        const payload = await writeJson(queries, '/v1/progress-metrics', 'POST', {
          draft: { id: null, clientId, name, unit }, expectedVersion: null,
        }, z.object({ metric: z.object({ id: uuid, archivedAt: z.iso.datetime().nullable(), version: z.number().int().positive() }) }))
        invalidate()
        return { id: payload.metric.id, clientId, name, unit, archivedAt: payload.metric.archivedAt, version: payload.metric.version }
      },
      async setMetricArchived(metric, archived) {
        const payload = await writeJson(queries, `/v1/progress-metrics/${metric.id}/archive`, 'PUT', {
          archived, expectedVersion: metric.version,
        }, z.object({ metric: z.object({ archivedAt: z.iso.datetime().nullable(), version: z.number().int().positive() }) }))
        invalidate()
        return { ...metric, archivedAt: payload.metric.archivedAt, version: payload.metric.version }
      },
    },
    goals: {
      async get(clientId) {
        const payload = await readJson(queries, `/v1/clients/${clientId}/progress`, progressBundleSchema)
        return payload.goal === null ? null : mapGoal(payload.goal)
      },
      async save(input) {
        const path = input.id === undefined ? '/v1/goals' : `/v1/goals/${input.id}`
        const payload = await writeJson(queries, path, input.id === undefined ? 'POST' : 'PUT', {
          draft: goalDraft(input), expectedVersion: input.version ?? null,
        }, z.object({ goal: z.object({ id: uuid }) }))
        invalidate()
        return payload.goal.id
      },
      async archive(goalId, version) {
        await writeJson(queries, `/v1/goals/${goalId}/archive`, 'PUT', { expectedVersion: version }, z.object({ goal: z.object({ version: z.number().int().positive() }) }))
        invalidate()
      },
      async saveStage(input: SaveGoalStageInput) {
        const path = input.id === undefined ? '/v1/goal-stages' : `/v1/goal-stages/${input.id}`
        const payload = await writeJson(queries, path, input.id === undefined ? 'POST' : 'PUT', {
          draft: { id: input.id ?? null, goalId: input.goalId, title: input.title,
            startsOn: input.startsOn, endsOn: input.endsOn, position: input.position ?? 0 },
          expectedVersion: input.version ?? null,
        }, z.object({ stage: z.object({ id: uuid }) }))
        invalidate()
        return payload.stage.id
      },
      async deleteStage(stageId) {
        const current = await Promise.all((await clients()).map((item) => readJson(
          queries, `/v1/clients/${item.id}/progress`, progressBundleSchema,
        )))
        const stage = current.flatMap((bundle) => bundle.goal?.stages ?? []).find((item) => item.id === stageId)
        if (!stage) throw new RepositoryError('PT404', 'Этап не найден.')
        await writeEmpty(queries, `/v1/goal-stages/${stageId}`, 'DELETE', { expectedVersion: stage.version })
        invalidate()
      },
    },
    workouts: {
      async get(id) {
        const result = (await trainingData()).workouts.find((item) => item.id === id)
        if (!result) throw new RepositoryError('PT404', 'Тренировка не найдена.')
        return workout(result)
      },
      async listPage(from, to, clientId, offset = 0, pageSize = 50) {
        const all = (await trainingData()).workouts.map(workout).filter((item) =>
          (from === undefined || item.workoutDate >= from)
          && (to === undefined || item.workoutDate <= to)
          && (clientId === undefined || item.clientId === clientId))
        return {
          items: all.slice(offset, offset + pageSize),
          ...(offset + pageSize < all.length ? { nextOffset: offset + pageSize } : {}),
          totalCount: all.length,
        }
      },
      async list(from, to, clientId) {
        const page = await this.listPage(from, to, clientId, 0, Number.MAX_SAFE_INTEGER)
        return page.items
      },
      async listSummaries(clientId) {
        return (await this.list(undefined, undefined, clientId)).map((item): WorkoutSummary => ({ id: item.id, workoutDate: item.workoutDate, status: item.status }))
      },
      async findActive(clientId) {
        return (await this.listSummaries(clientId)).find((item) => item.status === 'in_progress') ?? null
      },
      async personalRecords(workoutId) {
        const item = await this.get(workoutId)
        const records: WorkoutPersonalRecord[] = []
        for (const exercise of item.exercises) {
          const page = await this.exerciseProgressPage(item.clientId, exercise.ref, null)
          const result = page.items.find((candidate) => candidate.workoutId === workoutId)
          if (!result) continue
          if (result.isPrimaryPr && result.primaryValue !== null) records.push({ exerciseRef: exercise.ref, exerciseName: exercise.name, inputKind: exercise.inputKind, metric: 'primary', primaryValue: result.primaryValue, weightKg: result.bestWeightKg, reps: result.repsAtBestWeight })
          if (result.isWeightPr && result.bestWeightKg !== null) records.push({ exerciseRef: exercise.ref, exerciseName: exercise.name, inputKind: exercise.inputKind, metric: 'weight', primaryValue: result.bestWeightKg, weightKg: result.bestWeightKg, reps: result.repsAtBestWeight })
          if (result.isWeightRepsPr && result.bestWeightReps !== null) records.push({ exerciseRef: exercise.ref, exerciseName: exercise.name, inputKind: exercise.inputKind, metric: 'weight_reps', primaryValue: result.bestWeightReps, weightKg: result.bestWeightKg, reps: result.repsAtBestWeight })
        }
        return records
      },
      async latestExerciseResults(clientId, exerciseRefs) {
        const refs = new Set(exerciseRefs)
        const result = new Map<string, { workoutDate: ReturnType<typeof localDate>; sets: WorkoutSetDraft[] }>()
        const completed = (await this.list(undefined, undefined, clientId)).filter((item) => item.status === 'done')
        for (const item of completed) for (const exercise of item.exercises) {
          if (!refs.has(exercise.ref) || result.has(exercise.ref)) continue
          result.set(exercise.ref, { workoutDate: item.workoutDate, sets: exercise.sets.filter((set) => set.confirmedAt !== null).map((set) => ({ position: set.position, ...set.fact })) })
        }
        return result
      },
      async exerciseProgressPage(clientId, exerciseRef, cursor): Promise<ExerciseProgressPage> {
        const query = new URLSearchParams({ limit: '20' })
        if (cursor) { query.set('beforeCompletedAt', cursor.completedAt); query.set('beforeWorkoutId', cursor.workoutId) }
        const payload = await readJson(queries, `/v1/clients/${clientId}/progress/exercises/${encodeURIComponent(exerciseRef)}?${query}`, exerciseProgressSchema)
        return {
          ...payload,
          items: payload.items.map((item) => ({ ...item, workoutDate: localDate(item.workoutDate), sets: item.sets.map((set) => ({ weightKg: set.weightKg ?? undefined, reps: set.reps ?? undefined, durationSec: set.durationSec ?? undefined, distanceKm: set.distanceKm ?? undefined, rpe: set.rpe ?? undefined })) })),
        }
      },
      async save(draft) {
        const body = workoutDraft(draft)
        const payload = await writeJson(queries, draft.id === undefined ? '/v1/workouts' : `/v1/workouts/${draft.id}`, draft.id === undefined ? 'POST' : 'PUT', body, z.object({ workout: z.object({ id: uuid }) }))
        invalidate(); return payload.workout.id
      },
      async saveCompleted(draft) {
        const payload = await writeJson(queries, draft.id === undefined ? '/v1/workouts/completed' : `/v1/workouts/${draft.id}/completed`, draft.id === undefined ? 'POST' : 'PUT', workoutDraft(draft), z.object({ workout: z.object({ id: uuid }) }))
        invalidate(); return payload.workout.id
      },
      async recordPlannedResult(draft) {
        if (!draft.id) throw new Error('Тренировка не выбрана')
        const payload = await writeJson(queries, `/v1/workouts/${draft.id}/result`, 'POST', workoutDraft(draft), z.object({ workout: z.object({ id: uuid }) }))
        invalidate(); return payload.workout.id
      },
      async start(item) { return liveCommand(`/v1/workouts/${item.id}/start`, 'POST', item.version) },
      async cancelPlanned(item) { return commandVersion(`/v1/workouts/${item.id}/cancel`, 'POST', { expectedVersion: item.version }) },
      async reschedule(item, date, startTime) { return commandVersion(`/v1/workouts/${item.id}/reschedule`, 'POST', { workoutDate: date, startTime, expectedVersion: item.version }) },
      async saveLiveSet(id, draft, version) { return liveCommand(`/v1/workout-sets/${id}/draft`, 'PUT', version, { draft: { weightKg: draft.weightKg ?? null, reps: draft.reps ?? null, durationMin: draft.durationMin ?? null, durationSec: draft.durationSec ?? null, distanceKm: draft.distanceKm ?? null, rpe: draft.rpe ?? null } }) },
      async confirmLiveSet(id, version) { return liveCommand(`/v1/workout-sets/${id}/confirm`, 'POST', version) },
      async appendLiveExercise(item, exercise: ExerciseSnapshot) { return liveCommand(`/v1/workouts/${item.id}/exercises`, 'POST', item.version, { exercise: { source: exercise.source, ref: exercise.ref, customExerciseId: exercise.customExerciseId ?? null, name: exercise.name, muscleGroup: exercise.muscleGroup, inputKind: exercise.inputKind } }) },
      async appendLiveSet(item, exerciseId) { return liveCommand(`/v1/workout-exercises/${exerciseId}/sets`, 'POST', item.version) },
      async removeLiveSet(item, setId) {
        const payload = await writeJson(queries, `/v1/workout-sets/${setId}`, 'DELETE', { expectedVersion: item.version, operationId: crypto.randomUUID() }, z.object({ set: z.object({ version: z.number().int().positive() }) }))
        invalidate(); return payload.set.version
      },
      async removeLiveExercise(item, exerciseId) { return liveCommand(`/v1/workouts/${item.id}/exercises/${exerciseId}`, 'DELETE', item.version) },
      async reorderLiveBlock(item, blockId, direction) { return liveCommand(`/v1/workouts/${item.id}/blocks/${blockId}/reorder`, 'POST', item.version, { direction }) },
      async setExerciseComment(item, exerciseId, comment) { return liveCommand(`/v1/workout-exercises/${exerciseId}/comment`, 'PUT', item.version, { comment }) },
      async setWorkoutReview(item, value) { return commandVersion(`/v1/workouts/${item.id}/review`, 'PUT', { reaction: value.reaction, review: value.review, expectedVersion: item.version }) },
      async setClientWorkoutComment(item, comment) { return commandVersion(`/v1/workouts/${item.id}/comment`, 'PUT', { comment, expectedVersion: item.version }) },
      async submitFeedback(item, value) { return commandVersion(`/v1/workouts/${item.id}/feedback`, 'PUT', { ...value, expectedVersion: item.version }) },
      async askQuestion(item, question) { return commandVersion(`/v1/workouts/${item.id}/question`, 'PUT', { question, expectedVersion: item.version }) },
      async answerQuestion(item, value) { return commandVersion(`/v1/workouts/${item.id}/question/answer`, 'PUT', { reaction: value.reaction ?? null, review: value.review, expectedVersion: item.version }) },
      async resolveQuestion(item) { return commandVersion(`/v1/workouts/${item.id}/question/resolve`, 'POST', { expectedVersion: item.version }) },
      async listTrainerAttention(): Promise<TrainerAttentionWorkout[]> {
        return (await trainingData()).attention.map((item) => ({ workoutId: item.workoutId, clientId: item.clientId, clientName: item.clientName, workoutDate: localDate(item.workoutDate), clientQuestion: item.clientQuestion ?? undefined, clientQuestionAskedAt: item.clientQuestionAskedAt ?? undefined, discomfort: item.discomfort, clientComment: item.clientComment ?? undefined, feedbackSubmittedAt: item.feedbackSubmittedAt, version: item.version }))
      },
      async snoozeClientAttention(clientId) {
        const payload = await writeJson(queries, `/v1/clients/${clientId}/attention/snooze`, 'POST', {}, z.object({ client: z.object({ snoozedUntil: z.iso.datetime() }) }))
        invalidate(); return payload.client.snoozedUntil
      },
      async replaceLiveExercise(item, exerciseId, exercise) { return liveCommand(`/v1/workouts/${item.id}/exercises/${exerciseId}`, 'PUT', item.version, { exercise: { source: exercise.source, ref: exercise.ref, customExerciseId: exercise.customExerciseId ?? null, name: exercise.name, muscleGroup: exercise.muscleGroup, inputKind: exercise.inputKind } }) },
      async finish(item) { return liveCommand(`/v1/workouts/${item.id}/finish`, 'POST', item.version) },
      async remove(item) { await writeJson(queries, `/v1/workouts/${item.id}`, 'DELETE', { expectedVersion: item.version }, z.object({ workout: z.object({ version: z.number().int().positive() }) })); invalidate() },
    },
    invitations: {
      async create(clientId, targetRole) {
        const payload = await writeJson(queries, '/v1/invitations', 'POST', { clientId, targetRole }, z.object({ invitation: z.object({ code: z.string() }) }))
        invalidate(); return payload.invitation.code
      },
      async claim(code) {
        const payload = await writeJson(queries, '/v1/invitations/claim', 'POST', { code: code.trim().toUpperCase() }, z.object({ clientId: uuid }))
        invalidate(); return payload.clientId
      },
      async reconnect(code) { return this.claim(code) },
      async list(clientId) { return (await connections()).invitations.filter((item) => item.clientId === clientId) },
      async listTrainers(clientId): Promise<TrainerMembership[]> {
        return (await connections()).memberships
          .filter((item) => item.clientId === clientId)
          .map((item) => ({
            trainerId: item.trainerId,
            firstName: item.firstName,
            lastName: item.lastName,
            joinedAt: item.joinedAt,
            isRoot: item.isRoot,
          }))
      },
      async revoke(invitationId) { await writeEmpty(queries, `/v1/invitations/${invitationId}`, 'DELETE'); invalidate() },
      async disconnectTrainer(clientId) { await writeEmpty(queries, `/v1/clients/${clientId}/memberships/me`, 'DELETE'); invalidate(); return { clientId, trainerId: null, status: 'disconnected' } },
      async removeTrainer(clientId, trainerId) { await writeEmpty(queries, `/v1/clients/${clientId}/trainers/${trainerId}`, 'DELETE'); invalidate() },
      async leave(clientId) { await writeEmpty(queries, `/v1/clients/${clientId}/memberships/me`, 'DELETE'); invalidate() },
    },
    trainingSummaries: {
      async firstCompletedWorkoutDate(clientId) {
        const first = (await trainingData()).workouts.filter((item) => item.clientId === clientId && item.status === 'done').at(-1)
        return first ? localDate(first.workoutDate) : null
      },
      async listForTrainer(clientId) {
        const payload = await readJson(queries, `/v1/clients/${clientId}/training-summaries`, z.object({ summaries: z.array(internalSummarySchema) }))
        return payload.summaries.map((item) => trainingSummaryFromRow({ id: item.id, client_id: item.client_id, period_start: item.period_start, period_end: item.period_end, trainer_summary: toJson(item.trainer_summary), client_summary: toJson(item.client_summary), display_metrics: toJson(item.display_metrics), generated_at: item.generated_at, version: item.version }, item.published === true))
      },
      async listForClient(clientId): Promise<PublishedTrainingSummary[]> {
        const payload = await readJson(queries, `/v1/clients/${clientId}/training-summaries`, z.object({ summaries: z.array(publishedSummarySchema) }))
        return payload.summaries.map((item) => publishedTrainingSummaryFromRow({ id: item.id, source_summary_id: item.source_summary_id, client_id: item.client_id, period_start: item.period_start, period_end: item.period_end, summary: toJson(item.summary), display_metrics: toJson(item.display_metrics), generated_at: item.generated_at, published_at: item.published_at }))
      },
      async generate(clientId, periodStart, periodEnd, force = false) {
        const payload = await writeJson(queries, `/v1/clients/${clientId}/training-summaries/generate`, 'POST', { client_id: clientId, period_start: periodStart, period_end: periodEnd, force }, z.object({ data: z.object({ generated_at: z.iso.datetime() }), cached: z.boolean() }))
        return { generatedAt: payload.data.generated_at, cached: payload.cached }
      },
      async publish(summary, clientCopy) { await writeEmpty(queries, `/v1/training-summaries/${summary.id}/publish`, 'POST', { clientSummary: feedbackPayload(clientCopy), expectedVersion: summary.version }) },
      async unpublish(summary) { await writeEmpty(queries, `/v1/training-summaries/${summary.id}/unpublish`, 'POST', { expectedVersion: summary.version }) },
    },
    appFeedback: {
      async submit(kind, message) {
        const payload = await writeJson(queries, '/v1/app-feedback', 'POST', { kind, message: message.trim(), ...currentAppFeedbackContext() }, z.object({ feedback: z.object({ id: uuid }) }))
        return payload.feedback.id
      },
    },
    pushNotifications: {
      async status() {
        const payload = await readJson(queries, '/v1/push-notifications/status', z.object({ status: z.object({ subscribed: z.boolean(), preferences: z.object({ workout_reminder: z.boolean(), workout_scheduled: z.boolean() }) }) }))
        return { subscribed: payload.status.subscribed, workoutReminderEnabled: payload.status.preferences.workout_reminder }
      },
      async enable() {
        const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
        if (!vapidPublicKey) throw new Error('Push-уведомления сейчас недоступны')
        const subscription = await subscribeToPush(vapidPublicKey)
        await writeEmpty(queries, '/v1/push-notifications/subscription', 'PUT', subscription)
        await writeEmpty(queries, '/v1/push-notifications/preferences/workout_reminder', 'PUT', { enabled: true })
      },
      async disable() {
        await writeEmpty(queries, '/v1/push-notifications/preferences/workout_reminder', 'PUT', { enabled: false })
        await unsubscribeFromPush()
        await writeEmpty(queries, '/v1/push-notifications/subscription', 'DELETE')
      },
    },
    realtime: {
      subscribeToClientChanges(_clientId, onChange, onReady) {
        onReady?.()
        const interval = window.setInterval(() => onChange({ table: 'clients', eventType: 'UPDATE', new: {}, old: {} }), 15_000)
        return () => window.clearInterval(interval)
      },
    },
  }
}
