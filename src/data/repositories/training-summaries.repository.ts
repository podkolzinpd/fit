import type { Json } from '../database.types'
import type {
  ClientTrainingSummary,
  PublishedTrainingSummary,
  TrainerTrainingSummary,
  TrainingSummary,
  TrainingSummaryMetrics,
} from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { trainingSummaryQueries } from '../queries/training-summaries.queries'
import { repositoryError } from './error'

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

function metrics(value: Json): TrainingSummaryMetrics {
  const item = record(value)
  return {
    completedWorkouts: numericValue(item.completed_workouts),
    workoutsPerWeek: numericValue(item.workouts_per_week),
    activeWeeks: numericValue(item.active_weeks),
    longestGapDays: typeof item.longest_gap_days === 'number' ? item.longest_gap_days : null,
  }
}

function fromInternal(
  row: InternalRows[number],
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

function fromPublished(row: PublishedRows[number]): PublishedTrainingSummary {
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
    return result.data.map(fromPublished)
  },
  async generate(
    clientId: string,
    periodStart: string,
    periodEnd: string,
    force = false,
  ): Promise<void> {
    const result = await trainingSummaryQueries.generate(clientId, periodStart, periodEnd, force)
    if (result.error) throw await summaryGenerationError(result.error)
    const payload = result.data as { error?: string } | null
    if (payload?.error) throw new Error(generationErrorMessage(payload.error))
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

function generationErrorMessage(code: string): string {
  if (code === 'no_completed_workouts') return 'За выбранный период нет завершённых тренировок.'
  if (code === 'source_row_limit_reached') return 'Для этого периода слишком много данных. Выберите меньший период.'
  if (code === 'yandex_cloud_invalid_summary') return 'Модель вернула неполную суммаризацию. Попробуйте ещё раз.'
  if (code === 'yandex_cloud_invalid_json') return 'Модель вернула ответ в неожиданном формате. Попробуйте ещё раз.'
  if (code === 'yandex_cloud_quality_check_failed') {
    return 'Модель не прошла автоматическую проверку качества. Попробуйте ещё раз.'
  }
  if (code.startsWith('yandex_cloud_error_')) {
    return 'YandexGPT временно не принял запрос. Проверьте настройки модели и повторите позже.'
  }
  if (code === 'yandex_cloud_unavailable' || code === 'yandex_cloud_timeout') {
    return 'YandexGPT временно недоступен. Попробуйте ещё раз через минуту.'
  }
  if (code === 'summary_save_failed' || code === 'summary_visibility_save_failed') {
    return 'Сводка сформирована, но не сохранилась в Supabase. Проверьте права таблиц и повторите.'
  }
  return 'Не удалось обновить ИИ-анализ.'
}
