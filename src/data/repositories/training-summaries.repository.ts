import type { ClientTrainingSummary, TrainingSummary, TrainingSummaryTriggerReason, PublishedTrainingSummary } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { publishedTrainingSummaryFromRow, trainingSummaryFromInternalRow } from './training-summary-mappers'
import { trainingSummaryQueries } from '../queries/training-summaries.queries'
import { getResponseDiagnostics } from '../queries/request-diagnostics'
import { repositoryError } from './error'
import { trainingSummaryGenerationError } from './training-summary-errors'
import { attachRequestDiagnostics, getRequestDiagnostics, type RequestDiagnostics } from '../../shared/request-diagnostics'

export { publishedTrainingSummaryFromRow, trainingSummaryFromRow } from './training-summary-mappers'

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
    return internal.data.map((item) => trainingSummaryFromInternalRow(item, publishedSourceIds))
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
    triggerReason: TrainingSummaryTriggerReason = 'manual_refresh',
  ): Promise<{ generatedAt: string; cached: boolean }> {
    const result = await trainingSummaryQueries.generate(clientId, periodStart, periodEnd, force, triggerReason)
    if (result.error) throw await summaryGenerationError(result.error)
    const payload = result.data as {
      error?: string
      cached?: boolean
      data?: { generated_at?: unknown }
    } | null
    if (payload?.error) throw trainingSummaryGenerationError(payload.error)
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

async function mapSummaryGenerationError(error: unknown): Promise<Error> {
  if (error instanceof Error && error.message === 'authentication_required') {
    return trainingSummaryGenerationError('authentication_required')
  }
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
    if (code) return trainingSummaryGenerationError(code)
  }
  if (context && typeof context === 'object' && 'status' in context && context.status === 401) {
    return trainingSummaryGenerationError('authentication_required')
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
        if (code) return trainingSummaryGenerationError(code)
        if (typeof body.message === 'string') return new Error(body.message)
      }
    } catch {
      // Fall back to the standard Supabase error below.
    }
  }
  return repositoryError(error)
}

function summaryRequestDiagnostics(error: unknown): RequestDiagnostics | undefined {
  const direct = getRequestDiagnostics(error)
  if (direct !== null) return direct
  if (!error || typeof error !== 'object') return undefined
  const context = (error as { context?: unknown }).context
  return typeof Response !== 'undefined' && context instanceof Response
    ? getResponseDiagnostics(context)
    : undefined
}

async function summaryGenerationError(error: unknown): Promise<Error> {
  return attachRequestDiagnostics(
    await mapSummaryGenerationError(error),
    summaryRequestDiagnostics(error),
  )
}
