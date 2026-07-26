import type { ProgressEntry } from '../../shared/domain'
import type { LocalDate } from '../../shared/local-date'

export function roundMetric(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000
}

export function findProgressDateConflict(
  entries: readonly ProgressEntry[],
  recordedOn: LocalDate,
  editingId?: string,
): ProgressEntry | undefined {
  return entries.find((entry) => entry.recordedOn === recordedOn && entry.id !== editingId)
}

type CustomMetricValueRow = {
  progress_id: string
  metric_id: string
  value: number
}

type CustomMetricValue = {
  metricId: string
  value: number
}

export function groupCustomMetricValues(
  rows: readonly CustomMetricValueRow[],
): Map<string, CustomMetricValue[]> {
  const byProgressId = new Map<string, CustomMetricValue[]>()

  for (const row of rows) {
    const values = byProgressId.get(row.progress_id)
    const value = { metricId: row.metric_id, value: Number(row.value) }
    if (values) values.push(value)
    else byProgressId.set(row.progress_id, [value])
  }

  return byProgressId
}
