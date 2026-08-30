import type { CustomMetric, ProgressDraft, ProgressEntry, RunningProgressFormat, RunningProgressSession, WorkoutRegularity, WorkoutRegularityPeriod } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { progressQueries } from '../queries/progress.queries'
import { RepositoryError, repositoryError } from './error'
import { groupCustomMetricValues, roundMetric } from './progress-rules'
export { roundMetric } from './progress-rules'

export const progressRepository = {
  async regularity(clientId: string): Promise<WorkoutRegularity[]> {
    const result = await progressQueries.regularity(clientId)
    if (result.error) throw repositoryError(result.error)
    return result.data.map((row) => ({
      period: row.period as WorkoutRegularityPeriod,
      periodStart: localDate(row.period_start),
      periodEnd: localDate(row.period_end),
      plannedCount: row.planned_count,
      completedCount: row.completed_count,
      completedPlannedCount: row.completed_planned_count,
      partialCount: row.partial_count,
      skippedCount: row.skipped_count,
      completionPercent: row.completion_percent ?? null,
    }))
  },
  async running(clientId: string, periodStart: string, periodEnd: string): Promise<RunningProgressSession[]> {
    const result = await progressQueries.running(clientId, periodStart, periodEnd)
    if (result.error) throw repositoryError(result.error)
    return result.data.map((row) => ({
      workoutId: row.workout_id,
      workoutDate: localDate(row.workout_date),
      format: row.running_format as RunningProgressFormat,
      distanceKm: row.distance_km ?? undefined,
      durationSec: row.duration_sec ?? undefined,
      paceSecPerKm: row.pace_sec_per_km ?? undefined,
      rpe: row.rpe ?? undefined,
    }))
  },
  async list(clientId: string): Promise<ProgressEntry[]> {
    const [result, custom] = await Promise.all([progressQueries.list(clientId), progressQueries.listCustomValues(clientId)])
    if (result.error) throw repositoryError(result.error)
    if (custom.error) throw repositoryError(custom.error)
    const customMetricsByProgressId = groupCustomMetricValues(custom.data)
    return result.data.map((row) => ({
      id: row.id, clientId: row.client_id, createdBy: row.created_by, recordedOn: localDate(row.recorded_on),
      weightKg: row.weight_kg ?? undefined, chestCm: row.chest_cm ?? undefined,
      waistCm: row.waist_cm ?? undefined, hipCm: row.hip_cm ?? undefined,
      notes: row.notes ?? undefined,
      customMetrics: customMetricsByProgressId.get(row.id) ?? [],
      version: row.version,
    }))
  },
  async save(draft: ProgressDraft): Promise<string> {
    const result = await progressQueries.save({ ...draft,
      customMetrics: draft.customMetrics.map((metric) => ({ ...metric, value: roundMetric(metric.value) })),
    })
    if (result.error?.code === '23505') {
      throw new RepositoryError(
        'progress_date_conflict',
        'Замер за эту дату уже существует. Измените существующий замер.',
      )
    }
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async remove(entry: ProgressEntry): Promise<void> {
    const result = await progressQueries.remove(entry.id, entry.version)
    if (result.error) throw repositoryError(result.error)
  },
  async listMetrics(clientId: string): Promise<CustomMetric[]> {
    const result = await progressQueries.listMetrics(clientId)
    if (result.error) throw repositoryError(result.error)
    return result.data.map((row) => ({ id: row.id, clientId: row.client_id, name: row.name,
      unit: row.unit, archivedAt: row.archived_at, version: row.version }))
  },
  async createMetric(clientId: string, name: string, unit: string | null): Promise<CustomMetric> {
    const result = await progressQueries.createMetric(clientId, name, unit)
    if (result.error) throw repositoryError(result.error)
    return { id: result.data.id, clientId: result.data.client_id, name: result.data.name,
      unit: result.data.unit, archivedAt: result.data.archived_at, version: result.data.version }
  },
  async setMetricArchived(metric: CustomMetric, archived: boolean): Promise<CustomMetric> {
    const result = await progressQueries.setMetricArchived(metric.id, metric.version, archived)
    if (result.error) throw repositoryError(result.error)
    return { ...metric, archivedAt: result.data.archived_at, version: result.data.version }
  },
}
