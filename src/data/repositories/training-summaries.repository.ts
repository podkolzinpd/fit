import type { Json } from '../database.types'
import type {
  ClientTrainingSummary,
  PublishedTrainingSummary,
  TrainerTrainingSummary,
  TrainingSummary,
  TrainingSummaryMetrics,
  TrainingProgressFact,
  TrainingProgressFactChange,
  TrainingProgressMetric,
  InputKind,
} from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { trainingSummaryQueries } from '../queries/training-summaries.queries'
import { repositoryError } from './error'
import { generationErrorMessage } from './training-summary-errors'

type InternalRows = NonNullable<
  Awaited<ReturnType<typeof trainingSummaryQueries.listInternal>>['data']
>
type PublishedRows = NonNullable<
  Awaited<ReturnType<typeof trainingSummaryQueries.listPublished>>['data']
>

function record(value: Json): Record<string, Json | undefined> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Суммаризация имеет некорректный формат')
  }
  return value
}

function stringValue(value: Json | undefined, field: string): string {
  if (typeof value !== 'string') throw new Error(`В суммаризации отсутствует поле ${field}`)
  return value
}

function stringArray(value: Json | undefined, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`В суммаризации отсутствует список ${field}`)
  }
  return value as string[]
}

function optionalString(value: Json | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function optionalStringArray(value: Json | undefined): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value as string[]
    : undefined
}

function trainerSummary(value: Json): TrainerTrainingSummary {
  const item = record(value)
  return {
    headline: stringValue(item.headline, 'headline'),
    progress: stringArray(item.progress, 'progress'),
    consistency: stringValue(item.consistency, 'consistency'),
    attention: stringArray(item.attention, 'attention'),
  }
}

function clientSummary(value: Json): ClientTrainingSummary {
  const item = record(value)
  return {
    headline: stringValue(item.headline, 'headline'),
    achievements: stringArray(item.achievements, 'achievements'),
    consistency: stringValue(item.consistency, 'consistency'),
    encouragement: stringValue(item.encouragement, 'encouragement'),
    goalAlignment: optionalString(item.goalAlignment),
    nextSteps: optionalStringArray(item.nextSteps),
  }
}

function numericValue(value: Json | undefined): number {
  return typeof value === 'number' ? value : 0
}

const progressMetrics = new Set<TrainingProgressMetric>([
  'max_weight', 'volume', 'total_reps', 'distance', 'duration', 'pace',
])
const inputKinds = new Set<InputKind>(['strength', 'distance', 'reps', 'duration'])

function progressFactChange(value: Json): TrainingProgressFactChange | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null
  const item = value as Record<string, Json | undefined>
  if (
    typeof item.metric !== 'string' || !progressMetrics.has(item.metric as TrainingProgressMetric) ||
    typeof item.from !== 'number' || typeof item.to !== 'number' ||
    typeof item.change_percent !== 'number' ||
    (typeof item.favorable !== 'boolean' && item.favorable !== null)
  ) return null
  return {
    metric: item.metric as TrainingProgressMetric,
    from: item.from,
    to: item.to,
    changePercent: item.change_percent,
    favorable: item.favorable,
  }
}

function progressFacts(value: Json | undefined): TrainingProgressFact[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((value): TrainingProgressFact[] => {
    if (!value || Array.isArray(value) || typeof value !== 'object') return []
    const item = value as Record<string, Json | undefined>
    const changes = Array.isArray(item.changes)
      ? item.changes.map(progressFactChange).filter((change): change is TrainingProgressFactChange => change !== null)
      : []
    if (
      typeof item.exercise_name !== 'string' || !item.exercise_name.trim() ||
      typeof item.kind !== 'string' || !inputKinds.has(item.kind as InputKind) ||
      typeof item.session_count !== 'number' || changes.length === 0
    ) return []
    return [{
      exerciseName: item.exercise_name.trim(),
      kind: item.kind as InputKind,
      sessionCount: item.session_count,
      changes,
    }]
  })
}

function metrics(value: Json): TrainingSummaryMetrics {
  const item = record(value)
  return {
    completedWorkouts: numericValue(item.completed_workouts),
    workoutsPerWeek: numericValue(item.workouts_per_week),
    activeWeeks: numericValue(item.active_weeks),
    longestGapDays: typeof item.longest_gap_days === 'number' ? item.longest_gap_days : null,
    progressFacts: progressFacts(item.progress_facts),
  }
}

function fromInternal(
  row: Pick<InternalRows[number],
    'id' | 'client_id' | 'period_start' | 'period_end' | 'trainer_summary'
    | 'client_summary' | 'display_metrics' | 'generated_at' | 'version'>,
  publishedSourceIds: ReadonlySet<string>,
): TrainingSummary {
  return {
    id: row.id,
    clientId: row.client_id,
    periodStart: localDate(row.period_start),
    periodEnd: localDate(row.period_end),
    trainer: trainerSummary(row.trainer_summary),
    client: clientSummary(row.client_summary),
    metrics: metrics(row.display_metrics),
    generatedAt: row.generated_at,
    version: row.version,
    published: publishedSourceIds.has(row.id),
  }
}

export function trainingSummaryFromRow(
  row: Pick<InternalRows[number],
    'id' | 'client_id' | 'period_start' | 'period_end' | 'trainer_summary'
    | 'client_summary' | 'display_metrics' | 'generated_at' | 'version'>,
  published: boolean,
): TrainingSummary {
  return fromInternal(row, published ? new Set([row.id]) : new Set())
}

export function publishedTrainingSummaryFromRow(row: PublishedRows[number]): PublishedTrainingSummary {
  return {
    id: row.id,
    sourceSummaryId: row.source_summary_id,
    clientId: row.client_id,
    periodStart: localDate(row.period_start),
    periodEnd: localDate(row.period_end),
    summary: clientSummary(row.summary),
    metrics: metrics(row.display_metrics),
    generatedAt: row.generated_at,
    publishedAt: row.published_at,
  }
}

export const trainingSummariesRepository = {
  async firstCompletedWorkoutDate(clientId: string) {
    const result = await trainingSummaryQueries.firstCompletedWorkoutDate(clientId)
    if (result.error) throw repositoryError(result.error)
    return result.data?.workout_date ? localDate(result.data.workout_date) : null
  },
  async listForTrainer(clientId: string): Promise<TrainingSummary[]> {
    const [internal, published] = await Promise.all([
      trainingSummaryQueries.listInternal(clientId),
      trainingSummaryQueries.listPublished(clientId),
    ])
    if (internal.error) throw repositoryError(internal.error)
    if (published.error) throw repositoryError(published.error)
    const publishedSourceIds = new Set(published.data.map((item) => item.source_summary_id))
    return internal.data.map((item) => fromInternal(item, publishedSourceIds))
  },
  async listForClient(clientId: string): Promise<PublishedTrainingSummary[]> {
    const result = await trainingSummaryQueries.listPublished(clientId)
    if (result.error) throw repositoryError(result.error)
    return result.data.map(publishedTrainingSummaryFromRow)
  },
  async generate(
    clientId: string,
    periodStart: string,
    periodEnd: string,
    force = false,
  ): Promise<{ generatedAt: string; cached: boolean }> {
    const result = await trainingSummaryQueries.generate(clientId, periodStart, periodEnd, force)
    if (result.error) throw await summaryGenerationError(result.error)
    const payload = result.data as {
      error?: string
      cached?: boolean
      data?: { generated_at?: unknown }
    } | null
    if (payload?.error) throw new Error(generationErrorMessage(payload.error))
    if (typeof payload?.data?.generated_at !== 'string') {
      throw new Error('Сервер не подтвердил обновление ИИ-анализа. Попробуйте ещё раз.')
    }
    return {
      generatedAt: payload.data.generated_at,
      cached: payload.cached === true,
    }
  },
  async publish(summary: TrainingSummary, clientCopy: ClientTrainingSummary): Promise<void> {
    const result = await trainingSummaryQueries.publish(summary.id, clientCopy, summary.version)
    if (result.error) throw repositoryError(result.error)
    if (!result.data?.length) throw new Error('Суммаризация не была опубликована')
  },
  async unpublish(summary: TrainingSummary): Promise<void> {
    const result = await trainingSummaryQueries.unpublish(summary.id, summary.version)
    if (result.error) throw repositoryError(result.error)
    if (result.data !== summary.version + 1) throw new Error('Суммаризация не была скрыта')
  },
}

async function summaryGenerationError(error: unknown): Promise<Error> {
  const context = error && typeof error === 'object' && 'context' in error
    ? (error as { context?: unknown }).context
    : undefined
  if (
    context && typeof context === 'object' &&
    'name' in context && context.name === 'AbortError'
  ) {
    return new Error('Обновление заняло слишком много времени. Попробуйте ещё раз через минуту.')
  }
  if (context && typeof context === 'object' && 'headers' in context) {
    const headers = (context as { headers?: { get?: (name: string) => string | null } }).headers
    const code = headers?.get?.('x-fit-error-code')
    if (code) return new Error(generationErrorMessage(code))
  }
  if (context && typeof context === 'object' && 'json' in context && typeof context.json === 'function') {
    try {
      const payload = await (context as { json: () => Promise<unknown> }).json()
      if (payload && typeof payload === 'object') {
        const body = payload as { error?: unknown; code?: unknown; message?: unknown }
        const code = typeof body.code === 'string'
          ? body.code
          : typeof body.error === 'string'
            ? body.error
            : undefined
        if (code) return new Error(generationErrorMessage(code))
        if (typeof body.message === 'string') return new Error(body.message)
      }
    } catch {
      // Fall back to the standard Supabase error below.
    }
  }
  return repositoryError(error)
}
