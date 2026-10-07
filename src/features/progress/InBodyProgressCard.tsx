import type { InBodyMeasurement, ProgressEntry } from '../../shared/domain'
import { formatLocalDate } from '../../shared/local-date'
import { InBodyDetails } from './InBodyImport'

type Metric = { key: keyof InBodyMeasurement; label: string; unit: string; better: 'up' | 'down' | 'neutral' }

const PRIMARY_METRICS: readonly Metric[] = [
  { key: 'skeletalMuscleMassKg', label: 'Мышцы', unit: 'кг', better: 'up' },
  { key: 'bodyFatPercent', label: 'Жир', unit: '%', better: 'down' },
  { key: 'bodyFatMassKg', label: 'Жировая масса', unit: 'кг', better: 'down' },
  { key: 'totalBodyWaterL', label: 'Вода', unit: 'л', better: 'neutral' },
  { key: 'visceralFatAreaCm2', label: 'Висцеральный жир', unit: 'см²', better: 'down' },
]

function numeric(value: InBodyMeasurement, key: keyof InBodyMeasurement): number | undefined {
  const candidate = value[key]
  return typeof candidate === 'number' ? candidate : undefined
}

function formatted(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

export function InBodyProgressCard({ entries, compact = false, clientLime = false }: { entries: ProgressEntry[]; compact?: boolean; clientLime?: boolean }) {
  const measurements = entries.filter((entry) => entry.inBody !== undefined)
  const current = measurements[0]
  if (!current?.inBody) return null
  const previous = measurements[1]
  const metrics = PRIMARY_METRICS.flatMap((metric) => {
    const value = numeric(current.inBody!, metric.key)
    if (value === undefined) return []
    const previousValue = previous?.inBody ? numeric(previous.inBody, metric.key) : undefined
    return [{ ...metric, value, delta: previousValue === undefined ? undefined : value - previousValue }]
  })
  return <section className={`inbody-progress-card${compact ? ' compact' : ''}`} aria-labelledby="inbody-progress-card-title">
    <header><div><p className="eyebrow">СОСТАВ ТЕЛА</p><h2 id="inbody-progress-card-title">Актуальный InBody</h2></div><time dateTime={current.recordedOn}>{formatLocalDate(current.recordedOn)}</time></header>
    {metrics.length > 0 && <div className="inbody-progress-metrics">{metrics.map((metric) => {
      const improving = metric.delta !== undefined && metric.delta !== 0 && metric.better !== 'neutral'
        ? (metric.better === 'up' ? metric.delta > 0 : metric.delta < 0)
        : null
      return <div key={metric.key}><span>{metric.label}</span><strong>{formatted(metric.value)} {metric.unit}</strong><small className={improving === null ? '' : improving ? 'positive' : 'negative'}>{metric.delta === undefined ? 'Первый замер' : metric.delta === 0 ? 'Без изменений' : `${metric.delta > 0 ? '+' : '−'}${formatted(Math.abs(metric.delta))} ${metric.unit} к ${formatLocalDate(previous!.recordedOn)}`}</small></div>
    })}</div>}
    <InBodyDetails result={current.inBody} clientLime={clientLime} />
  </section>
}
