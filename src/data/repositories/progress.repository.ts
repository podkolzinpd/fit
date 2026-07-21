import type { CustomMetric, ProgressDraft, ProgressEntry } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { progressQueries } from '../queries/progress.queries'
import { repositoryError } from './error'
import { roundMetric } from './progress-rules'
export { roundMetric } from './progress-rules'

export const progressRepository = {
  async list(clientId: string): Promise<ProgressEntry[]> {
    const [result, custom] = await Promise.all([progressQueries.list(clientId), progressQueries.listCustomValues(clientId)])
    if (result.error) throw repositoryError(result.error)
    if (custom.error) throw repositoryError(custom.error)
    return result.data.map((row) => ({
      id: row.id, clientId: row.client_id, recordedOn: localDate(row.recorded_on),
      weightKg: row.weight_kg ?? undefined, chestCm: row.chest_cm ?? undefined,
      waistCm: row.waist_cm ?? undefined, hipCm: row.hip_cm ?? undefined,
      notes: row.notes ?? undefined,
      customMetrics: custom.data.filter((value) => value.progress_id === row.id)
        .map((value) => ({ metricId: value.metric_id, value: Number(value.value) })),
      version: row.version,
    }))
  },
  async save(draft: ProgressDraft): Promise<string> {
    const result = await progressQueries.save({ ...draft,
      customMetrics: draft.customMetrics.map((metric) => ({ ...metric, value: roundMetric(metric.value) })),
    })
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
  async createMetric(trainerId: string, clientId: string, name: string, unit: string | null): Promise<CustomMetric> {
    const result = await progressQueries.createMetric(trainerId, clientId, name, unit)
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
