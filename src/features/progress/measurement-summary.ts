import type { CustomMetric, ProgressEntry } from '../../shared/domain'

export interface MeasurementSummaryItem {
  label: string
  value: string
}

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

function valueWithUnit(value: number, unit: string) {
  return `${numberFormatter.format(value)} ${unit}`
}

export function measurementSummaryItems(entry: ProgressEntry, metrics: CustomMetric[]): MeasurementSummaryItem[] {
  return [
    entry.weightKg !== undefined && { label: 'Вес', value: valueWithUnit(entry.weightKg, 'кг') },
    entry.chestCm !== undefined && { label: 'Грудь', value: valueWithUnit(entry.chestCm, 'см') },
    entry.waistCm !== undefined && { label: 'Талия', value: valueWithUnit(entry.waistCm, 'см') },
    entry.hipCm !== undefined && { label: 'Бёдра', value: valueWithUnit(entry.hipCm, 'см') },
    ...entry.customMetrics.map(({ metricId, value }) => {
      const metric = metrics.find((item) => item.id === metricId)
      return metric && { label: metric.name, value: metric.unit ? valueWithUnit(value, metric.unit) : numberFormatter.format(value) }
    }),
  ].filter((item): item is MeasurementSummaryItem => Boolean(item))
}

export function measurementSummaryText(entry: ProgressEntry, metrics: CustomMetric[], limit = 4): string {
  const items = measurementSummaryItems(entry, metrics)
  const visible = items.slice(0, limit).map((item) => `${item.label.toLocaleLowerCase('ru-RU')} ${item.value}`)
  const hiddenCount = items.length - visible.length
  return `${visible.join(' · ')}${hiddenCount > 0 ? ` · ещё ${hiddenCount}` : ''}`
}
