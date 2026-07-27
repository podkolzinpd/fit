import type { CustomMetric } from '../../shared/domain'

// Готовые пресеты замеров для быстрого добавления (без ручного ввода названия).
// paired — парная метрика: создаём две («… (левое)» / «… (правое)»).
export const MEASURE_PRESETS: Array<{ id: string; base: string; unit: string; paired: boolean }> = [
  { id: 'belly', base: 'Живот (на уровне пупка)', unit: 'см', paired: false },
  { id: 'thigh', base: 'Бедро', unit: 'см', paired: true },
  { id: 'upper-arm', base: 'Плечо', unit: 'см', paired: true },
  { id: 'forearm', base: 'Предплечье', unit: 'см', paired: true },
  { id: 'calf', base: 'Икра', unit: 'см', paired: true },
]

export const PAIRED_SUFFIX = { left: ' (левое)', right: ' (правое)' } as const

// Имена метрик, которые создаст пресет (одно или два для парного).
export function presetMetricNames(preset: { base: string; paired: boolean }): string[] {
  return preset.paired
    ? [preset.base + PAIRED_SUFFIX.left, preset.base + PAIRED_SUFFIX.right]
    : [preset.base]
}

// Строки полей в форме замера: парные метрики («… (левое/правое)») сводим в одну
// строку с полями Л/П; остальные — как есть. Определяем пару по суффиксу имени.
export type MetricRow =
  | { kind: 'single'; metric: CustomMetric }
  | { kind: 'pair'; base: string; unit: string | null; left?: CustomMetric; right?: CustomMetric }

export function groupMetricRows(metrics: CustomMetric[]): MetricRow[] {
  const rows: MetricRow[] = []
  const pairs = new Map<string, Extract<MetricRow, { kind: 'pair' }>>()
  for (const metric of metrics) {
    const side = metric.name.endsWith(PAIRED_SUFFIX.left) ? 'left' : metric.name.endsWith(PAIRED_SUFFIX.right) ? 'right' : null
    if (!side) { rows.push({ kind: 'single', metric }); continue }
    const base = metric.name.slice(0, metric.name.length - PAIRED_SUFFIX[side].length)
    let row = pairs.get(base)
    if (!row) { row = { kind: 'pair', base, unit: metric.unit }; pairs.set(base, row); rows.push(row) }
    row[side] = metric
  }
  return rows
}
