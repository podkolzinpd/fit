import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ClientGoal, CustomMetric, ProgressEntry } from '../../shared/domain'
import { formatLocalDate, type LocalDate } from '../../shared/local-date'
import {
  buildMeasurementExplanation,
  buildMeasurementProgress,
  formatMeasurementDelta,
  formatMeasurementValue,
  measurementFreshnessLabel,
  measurementSufficiencyLabel,
  type MeasurementProgressMetric,
} from './measurement-progress'
import { ProgressChart, type MetricSelector } from './ProgressChart'

function selectorKey(selector: MetricSelector): string {
  return typeof selector === 'string' ? selector : `custom:${selector.customMetricId}`
}

function observationValue(metric: MeasurementProgressMetric, observation: MeasurementProgressMetric['latest']): string {
  return observation ? formatMeasurementValue(observation.value, metric.unit) : 'Нет точки'
}

export function MeasurementProgressSection({
  entries,
  customMetrics,
  goal,
  periodStart,
  periodEnd,
  today,
  role,
  clientId,
  loading,
  error,
  onRetry,
  llmCandidates = [],
}: {
  entries: readonly ProgressEntry[]
  customMetrics: readonly CustomMetric[]
  goal?: ClientGoal | null
  periodStart: LocalDate
  periodEnd: LocalDate
  today: LocalDate
  role: 'client' | 'trainer'
  clientId: string
  loading: boolean
  error: Error | null
  onRetry: () => void
  llmCandidates?: readonly string[]
}) {
  const progress = buildMeasurementProgress({ entries, customMetrics, goal, periodStart, periodEnd, today, llmCandidates })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const selected = progress.metrics.find((metric) => selectorKey(metric.selector) === selectedKey)
    ?? progress.primary
  const explanation = selected ? buildMeasurementExplanation(selected, llmCandidates) : null
  const measurementLink = role === 'client' ? '/me/progress#measurements' : `/progress/${clientId}?view=measurements`

  return <section className="client-progress-measurements-story" id="progress-measurements" aria-labelledby={`${role}-progress-measurements-title`}>
    <header>
      <div><span>Измерения</span><h3 id={`${role}-progress-measurements-title`}>Тренд по значениям</h3></div>
      <Link className="link" to={measurementLink}>{role === 'client' ? 'Управление' : 'Все замеры'}</Link>
    </header>
    {loading ? <p className="measurement-story-state" role="status">Собираем историю замеров…</p>
      : error ? <p className="measurement-story-state" role="alert">Не удалось загрузить замеры. <button type="button" className="link" onClick={onRetry}>Повторить</button></p>
      : !selected ? <div className="measurement-story-empty"><p>Добавь первый замер — здесь появятся значения, свежесть и график.</p><Link className="link" to={measurementLink}>Добавить замер</Link></div>
      : <>
        {progress.metrics.length > 1 && <div className="measurement-story-selector" role="tablist" aria-label="Показатель измерений">
          {progress.metrics.map((metric) => <button
            key={metric.factId}
            type="button"
            role="tab"
            aria-selected={metric.factId === selected.factId}
            onClick={() => setSelectedKey(selectorKey(metric.selector))}
          >{metric.label}{metric.goalRelated && <span>цель</span>}</button>)}
        </div>}
        <div className="measurement-story-current" data-fact-id={selected.factId}>
          <div><span>Сейчас</span><strong>{observationValue(selected, selected.latest)}</strong></div>
          <div><span>{selected.delta === null ? 'Динамика периода' : formatMeasurementDelta(selected.delta, selected.unit)}</span><small>{selected.latest ? formatLocalDate(selected.latest.date) : 'Дата отсутствует'}</small></div>
        </div>
        <ProgressChart
          entries={[...entries]}
          metric={selected.selector}
          label={selected.label}
          unit={selected.unit}
          windowEnd={null}
          onWindowChange={() => undefined}
          rangeStart={periodStart}
          rangeEnd={periodEnd}
          compact
        />
        <dl className="measurement-story-facts">
          <div><dt>Начало / конец</dt><dd>{observationValue(selected, selected.periodStart)} → {observationValue(selected, selected.periodEnd)}</dd></div>
          <div><dt>Минимум / максимум</dt><dd>{selected.min && selected.max ? `${formatMeasurementValue(selected.min.value, selected.unit)} / ${formatMeasurementValue(selected.max.value, selected.unit)}` : 'Недостаточно точек'}</dd></div>
          <div><dt>Связь с целью</dt><dd>{selected.goalRelated ? 'Связан с целью' : 'Только наблюдение'}</dd></div>
          <div><dt>Данные</dt><dd>{measurementFreshnessLabel(selected)} · {measurementSufficiencyLabel(selected)}</dd></div>
        </dl>
        {selected.hasNewerValueAfterPeriod && <p className="measurement-story-after-period">Самое свежее значение получено после выбранного периода; график и delta относятся только к периоду.</p>}
        {explanation && <div className="measurement-story-explanation" data-copy-source={explanation.source} data-fact-ids={explanation.factIds.join(',')}><p>{explanation.text}</p></div>}
      </>}
  </section>
}
