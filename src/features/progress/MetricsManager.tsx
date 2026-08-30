import { type FormEvent, useState } from 'react'
import type { CustomMetric } from '../../shared/domain'
import { MEASURE_PRESETS, presetMetricNames } from './measure-presets'

export function MetricsManager({ metrics, busy = false, error, onCreate, onArchive }: {
  metrics: CustomMetric[]
  busy?: boolean
  error?: Error | null
  onCreate: (name: string, unit: string | null) => void
  onArchive: (metric: CustomMetric) => void
}) {
  const [preset, setPreset] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    onCreate(String(data.get('name')), String(data.get('unit') || '') || null)
    event.currentTarget.reset()
  }
  const existing = new Set(metrics.map((metric) => metric.name))
  const available = MEASURE_PRESETS.filter((option) => presetMetricNames(option).some((name) => !existing.has(name)))
  function addPreset() {
    const option = MEASURE_PRESETS.find((item) => item.id === preset)
    if (!option) return
    presetMetricNames(option).forEach((name) => { if (!existing.has(name)) onCreate(name, option.unit) })
    setPreset('')
  }
  return <section className="metrics-manager"><div className="measurement-section-heading"><p className="eyebrow">НАСТРОЙКА</p><h2>Показатели замера</h2><span>Добавьте параметры, которые важно отслеживать.</span></div>
    {available.length > 0 && <div className="metric-preset-row">
      <select aria-label="Готовый замер" value={preset} onChange={(event) => setPreset(event.target.value)}>
        <option value="">Выберите замер…</option>
        {available.map((option) => <option key={option.id} value={option.id}>{option.base}, {option.unit}{option.paired ? ' (Л + П)' : ''}</option>)}
      </select>
      <button type="button" className="secondary" disabled={!preset || busy} onClick={addPreset}>Добавить</button>
    </div>}
    <p className="muted metric-manual-hint">Или создайте свой показатель:</p>
    <form className="inline-form" onSubmit={(event) => void submit(event)}><input name="name" placeholder="Например, плечи" maxLength={80} required /><input name="unit" placeholder="Например, см" maxLength={24} /><button disabled={busy}>Добавить</button></form>
    {error && <p className="error" role="alert">{error.message}</p>}
    {metrics.map((metric) => <div className="metric" key={metric.id}><span>{metric.name}{metric.unit ? `, ${metric.unit}` : ''}</span><button type="button" className="link danger" disabled={busy} onClick={() => onArchive(metric)}>{metric.archivedAt ? 'Вернуть' : 'В архив'}</button></div>)}
  </section>
}
