import { useState } from 'react'
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
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  function addManual() {
    if (!name.trim()) return
    onCreate(name, unit || null)
    setName('')
    setUnit('')
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
    <div className="inline-form" role="group" aria-label="Новый показатель"><input name="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Название" aria-label="Название показателя" maxLength={80} required /><input name="unit" value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Единица" aria-label="Единица измерения" maxLength={24} /><button type="button" disabled={busy || !name.trim()} onClick={addManual}>Добавить</button></div>
    {error && <p className="error" role="alert">{error.message}</p>}
    {metrics.map((metric) => <div className="metric" key={metric.id}><span>{metric.name}{metric.unit ? `, ${metric.unit}` : ''}</span><button type="button" className="link danger" disabled={busy} onClick={() => onArchive(metric)}>{metric.archivedAt ? 'Вернуть' : 'В архив'}</button></div>)}
  </section>
}
