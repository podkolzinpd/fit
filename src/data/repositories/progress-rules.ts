export function roundMetric(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000
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
