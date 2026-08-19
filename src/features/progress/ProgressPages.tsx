import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useClientRealtime } from '../../app/use-client-realtime'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { findProgressDateConflict } from '../../data/repositories/progress-rules'
import { progressRepository } from '../../data/repositories/progress.repository'
import type { CustomMetric, ProgressEntry } from '../../shared/domain'
import { formatLocalDate, localDate, todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { CloseIcon } from '../../shared/icons'
import { AsyncView, Field, Page } from '../../shared/ui'
import { ProgressChart, type MetricKey, type MetricSelector } from './ProgressChart'
import { MEASURE_PRESETS, groupMetricRows, presetMetricNames } from './measure-presets'
import { TrainerTrainingSummaryCard } from './TrainingSummaryCard'
import { TrainerProgressOverviewCard } from './TrainerProgressOverviewCard'
import { WorkoutRegularityCard } from './WorkoutRegularityCard'
import { RunningProgressCard } from './RunningProgressCard'

const METRIC_TABS: Array<{ key: MetricKey; label: string; unit: string }> = [
  { key: 'weightKg', label: 'Вес', unit: 'кг' },
  { key: 'chestCm', label: 'Грудь', unit: 'см' },
  { key: 'waistCm', label: 'Талия', unit: 'см' },
  { key: 'hipCm', label: 'Бёдра', unit: 'см' },
]

function metricField(metric: CustomMetric, entry: ProgressEntry | null, placeholder?: string) {
  return <input name={`metric-${metric.id}`} type="number" step="0.001" placeholder={placeholder}
    defaultValue={entry?.customMetrics.find((value) => value.metricId === metric.id)?.value} />
}

export function ProgressPage() {
  const { clientId = '' } = useParams(); const queryClient = useQueryClient(); const { actor } = useAuth(); const [editing, setEditing] = useState<ProgressEntry | null>(null)
  const today = todayInTimeZone(actor?.timezone)
  useClientRealtime(clientId)
  const [selectedMetric, setSelectedMetric] = useState<string>('weightKg')
  const [windowEnd, setWindowEnd] = useState<LocalDate | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [metricSheetOpen, setMetricSheetOpen] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const tabsDragOriginRef = useRef<{ x: number; scrollLeft: number } | null>(null)
  const tabsDraggedRef = useRef(false)
  useEffect(() => { setSelectedMetric('weightKg'); setWindowEnd(null); setHistoryOpen(false); setMetricSheetOpen(false); setCreateError(null) }, [clientId])
  const client = useQuery({ queryKey: ['client', clientId], queryFn: () => clientsRepository.get(clientId) })
  const entries = useQuery({ queryKey: ['progress', clientId], queryFn: () => progressRepository.list(clientId) })
  const metrics = useQuery({ queryKey: ['metrics', clientId], queryFn: () => progressRepository.listMetrics(clientId) })
  const save = useMutation({ mutationFn: async (form: HTMLFormElement) => { const data = new FormData(form); const recordedOn = localDate(String(data.get('recordedOn'))); if (recordedOn > today) throw new Error('Нельзя добавить замер с будущей датой'); return progressRepository.save({ id: editing?.id, clientId, version: editing?.version, recordedOn, weightKg: numberValue(data.get('weightKg')), chestCm: numberValue(data.get('chestCm')), waistCm: numberValue(data.get('waistCm')), hipCm: numberValue(data.get('hipCm')), notes: String(data.get('notes') || '') || undefined, customMetrics: metrics.data?.filter((metric) => !metric.archivedAt).flatMap((metric) => { const value = numberValue(data.get(`metric-${metric.id}`)); return value === undefined ? [] : [{ metricId: metric.id, value }] }) ?? [] }) }, onSuccess: async () => { setEditing(null); await queryClient.invalidateQueries({ queryKey: ['progress', clientId] }); await queryClient.invalidateQueries({ queryKey: ['client', clientId] }) } })
  const remove = useMutation({ mutationFn: (entry: ProgressEntry) => progressRepository.remove(entry), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['progress', clientId] }) })
  const createMetric = useMutation({ mutationFn: ({ name, unit }: { name: string; unit: string | null }) => progressRepository.createMetric(actor!.userId, clientId, name, unit), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['metrics', clientId] }) })
  const archiveMetric = useMutation({ mutationFn: (metric: CustomMetric) => progressRepository.setMetricArchived(metric, !metric.archivedAt), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['metrics', clientId] }) })
  const loading = client.isLoading || entries.isLoading || metrics.isLoading; const error = client.error ?? entries.error ?? metrics.error
  const canManage = (entry: ProgressEntry) => actor?.role === 'client' || entry.createdBy === actor?.userId
  const filledCustomIds = new Set(entries.data?.flatMap((entry) => entry.customMetrics.map((item) => item.metricId)) ?? [])
  const overflowMetrics = (metrics.data ?? []).filter((metric) => filledCustomIds.has(metric.id))
  const activeBuiltin = METRIC_TABS.find((tab) => tab.key === selectedMetric)
  const activeCustom = !activeBuiltin ? overflowMetrics.find((metric) => metric.id === selectedMetric) : undefined
  const chartMetric: MetricSelector = activeBuiltin ? activeBuiltin.key : { customMetricId: selectedMetric }
  const chartLabel = activeBuiltin?.label ?? activeCustom?.name ?? METRIC_TABS[0]!.label
  const chartUnit = activeBuiltin?.unit ?? activeCustom?.unit ?? ''
  const latestEntry = entries.data?.[0]
  const latestEntrySummary = latestEntry
    ? entrySummaryParts(latestEntry, metrics.data ?? []).join(' · ') || 'Показатели не указаны'
    : 'Добавьте первый замер, когда появятся данные'
  function saveNewProgress(form: HTMLFormElement) {
    const data = new FormData(form)
    const recordedOn = localDate(String(data.get('recordedOn')))
    const conflict = findProgressDateConflict(entries.data ?? [], recordedOn)
    if (conflict) {
      setCreateError(`Замер за ${formatLocalDate(recordedOn)} уже существует. Открыли его для редактирования.`)
      setHistoryOpen(true)
      setEditing(conflict)
      return
    }
    setCreateError(null)
    save.mutate(form)
  }
  function handleTabsPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || !tabsRef.current) return
    tabsDragOriginRef.current = { x: event.clientX, scrollLeft: tabsRef.current.scrollLeft }
    tabsDraggedRef.current = false
  }
  function handleTabsPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const origin = tabsDragOriginRef.current
    if (!origin || !tabsRef.current) return
    const delta = event.clientX - origin.x
    if (Math.abs(delta) > 4) tabsDraggedRef.current = true
    tabsRef.current.scrollLeft = origin.scrollLeft - delta
  }
  function handleTabsPointerUp() { tabsDragOriginRef.current = null }
  function selectMetricTab(action: () => void) {
    if (tabsDraggedRef.current) { tabsDraggedRef.current = false; return }
    action()
  }
  return <Page className="progress-page" title={client.data ? `Прогресс · ${client.data.fullName}` : 'Прогресс'} back={`/clients/${clientId}`}><AsyncView loading={loading} error={error} onRetry={() => { void client.refetch(); void entries.refetch(); void metrics.refetch() }}>{client.data && <>
    <TrainerProgressOverviewCard clientId={clientId} />
    <details className="trainer-progress-details">
      <summary>
        <div>
          <p className="eyebrow">ТРЕНИРОВКИ</p>
          <h2>Подробный анализ</h2>
          <span>Ритм по неделе и месяцу, ИИ-анализ и беговая динамика</span>
        </div>
        <span className="trainer-details-open">Открыть</span>
        <span className="trainer-details-close">Свернуть</span>
      </summary>
      <div className="trainer-progress-details-content">
        <WorkoutRegularityCard clientId={clientId} />
        <TrainerTrainingSummaryCard clientId={clientId} />
        <RunningProgressCard clientId={clientId} />
      </div>
    </details>
    <details className="trainer-measurements">
      <summary>
        <div className="trainer-measurements-summary-copy">
          <p className="eyebrow">ЗАМЕРЫ И ПОКАЗАТЕЛИ</p>
          <h2>{latestEntry ? 'Последний замер' : 'Замеров пока нет'}</h2>
          <span>{latestEntry ? `${formatLocalDate(latestEntry.recordedOn)} · ${latestEntrySummary}` : latestEntrySummary}</span>
        </div>
        <div className="trainer-measurements-summary-meta">
          <strong>{entries.data?.length ?? 0}</strong>
          <span>в истории</span>
          <span className="trainer-measurements-open">Открыть</span>
          <span className="trainer-measurements-close">Свернуть</span>
        </div>
      </summary>
      <div className="trainer-measurements-content">
        {entries.data && entries.data.length > 0 && <>
          <div className="metric-tabs" ref={tabsRef}
            onPointerDown={handleTabsPointerDown} onPointerMove={handleTabsPointerMove} onPointerUp={handleTabsPointerUp} onPointerLeave={handleTabsPointerUp}>
            {METRIC_TABS.map((tab) => <button key={tab.key} type="button" className={`metric-tab${tab.key === selectedMetric ? ' active' : ''}`} onClick={() => selectMetricTab(() => setSelectedMetric(tab.key))}>{tab.label}</button>)}
            {overflowMetrics.length > 0 && <button type="button" className={`metric-tab${activeCustom ? ' active' : ''}`} onClick={() => selectMetricTab(() => setMetricSheetOpen(true))}>{activeCustom ? `⋯ ${activeCustom.name}` : '⋯'}</button>}
          </div>
          <ProgressChart entries={entries.data} metric={chartMetric} label={chartLabel} unit={chartUnit} windowEnd={windowEnd} onWindowChange={setWindowEnd} />
        </>}
        <ProgressForm entry={null} metrics={metrics.data ?? []} today={today} busy={save.isPending} errorMessage={createError ?? save.error?.message ?? null} onDateChange={() => { setCreateError(null); save.reset() }} onSubmit={saveNewProgress} />
        <section className="progress-history">
          <div className="workout-editor-heading">
            <h2>История замеров ({entries.data?.length ?? 0})</h2>
            {entries.data && entries.data.length > 0 && <button type="button" className="link" onClick={() => setHistoryOpen((value) => !value)}>{historyOpen ? 'Скрыть' : 'Показать'}</button>}
          </div>
          {historyOpen && <div className="cards">{entries.data?.map((entry) => editing?.id === entry.id
            ? <article className="card editing" key={entry.id}><ProgressForm entry={entry} metrics={metrics.data ?? []} today={today} busy={save.isPending} errorMessage={save.error?.message ?? null} onSubmit={(form) => save.mutate(form)} onCancel={() => setEditing(null)} /></article>
            : <article className="card" key={entry.id}><div><strong>{formatLocalDate(entry.recordedOn)}</strong><p>{entrySummaryParts(entry, metrics.data ?? []).join(' · ')}</p></div>{canManage(entry) && <div className="row-actions"><button className="link" onClick={() => setEditing(entry)}>Изменить</button><button className="link danger" onClick={() => remove.mutate(entry)}>Удалить</button></div>}</article>)}</div>}
        </section>
        <MetricsManager metrics={metrics.data ?? []} onCreate={(name, unit) => createMetric.mutate({ name, unit })} onArchive={(metric) => archiveMetric.mutate(metric)} />
      </div>
    </details>
    {metricSheetOpen && <MetricOverflowSheet metrics={overflowMetrics} onPick={(id) => { setSelectedMetric(id); setMetricSheetOpen(false) }} onClose={() => setMetricSheetOpen(false)} />}
  </>}</AsyncView></Page>
}

function MetricOverflowSheet({ metrics, onPick, onClose }: { metrics: CustomMetric[]; onPick: (id: string) => void; onClose: () => void }) {
  return <div className="sheet-overlay" onClick={onClose}>
    <section className="exercise-picker" role="dialog" aria-modal="true" aria-label="Другие метрики" onClick={(event) => event.stopPropagation()}>
      <header className="picker-header"><h1>Другие метрики</h1><button type="button" className="picker-close" aria-label="Закрыть" onClick={onClose}><CloseIcon /></button></header>
      <div className="picker-list">{metrics.map((metric) => <button type="button" className="picker-item" key={metric.id} onClick={() => onPick(metric.id)}><span>{metric.name}</span>{metric.unit && <small>{metric.unit}</small>}</button>)}</div>
    </section>
  </div>
}

function ProgressForm({ entry, metrics, today, busy, errorMessage, onSubmit, onCancel, onDateChange }: { entry: ProgressEntry | null; metrics: CustomMetric[]; today: LocalDate; busy: boolean; errorMessage: string | null; onSubmit: (form: HTMLFormElement) => void; onCancel?: () => void; onDateChange?: () => void }) {
  return <section className="progress-form-card"><h2>{entry ? 'Изменить замер' : 'Новый замер'}</h2><form className="stack compact" onSubmit={(event) => { event.preventDefault(); onSubmit(event.currentTarget) }}><Field label="Дата"><input name="recordedOn" type="date" max={today} defaultValue={entry?.recordedOn ?? today} onChange={onDateChange} required /></Field><div className="measure-grid"><Field label="Вес, кг"><input name="weightKg" type="number" step="0.1" defaultValue={entry?.weightKg} /></Field><Field label="Грудь, см"><input name="chestCm" type="number" step="0.1" defaultValue={entry?.chestCm} /></Field><Field label="Талия, см"><input name="waistCm" type="number" step="0.1" defaultValue={entry?.waistCm} /></Field><Field label="Бёдра, см"><input name="hipCm" type="number" step="0.1" defaultValue={entry?.hipCm} /></Field></div>{groupMetricRows(metrics.filter((metric) => !metric.archivedAt)).map((row) => row.kind === 'single'
      ? <Field key={row.metric.id} label={`${row.metric.name}${row.metric.unit ? `, ${row.metric.unit}` : ''}`}>{metricField(row.metric, entry)}</Field>
      : <Field key={row.base} label={`${row.base}${row.unit ? `, ${row.unit}` : ''}`}><div className="measure-pair">{row.left && metricField(row.left, entry, 'Л')}{row.right && metricField(row.right, entry, 'П')}</div></Field>
    )}<Field label="Заметка"><textarea name="notes" defaultValue={entry?.notes} /></Field>{errorMessage && <p className="error" role="alert">{errorMessage}</p>}<div className="actions">{onCancel && <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Отмена</button>}<button disabled={busy} aria-busy={busy}>{busy ? 'Сохраняем…' : 'Сохранить замер'}</button></div></form></section>
}

function MetricsManager({ metrics, onCreate, onArchive }: { metrics: CustomMetric[]; onCreate: (name: string, unit: string | null) => void; onArchive: (metric: CustomMetric) => void }) {
  const [preset, setPreset] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); onCreate(String(data.get('name')), String(data.get('unit') || '') || null); event.currentTarget.reset() }
  // Уже добавленные (в т.ч. в архиве) метрики — по имени, чтобы не плодить дубли.
  const existing = new Set(metrics.map((metric) => metric.name))
  const available = MEASURE_PRESETS.filter((option) => presetMetricNames(option).some((name) => !existing.has(name)))
  function addPreset() {
    const option = MEASURE_PRESETS.find((item) => item.id === preset)
    if (!option) return
    // Для парного создаём обе стороны; пропускаем уже существующие.
    presetMetricNames(option).forEach((name) => { if (!existing.has(name)) onCreate(name, option.unit) })
    setPreset('')
  }
  return <section className="metrics-manager"><h2>Свои метрики</h2>
    {available.length > 0 && <div className="metric-preset-row">
      <select aria-label="Готовый замер" value={preset} onChange={(event) => setPreset(event.target.value)}>
        <option value="">Выберите замер…</option>
        {available.map((option) => <option key={option.id} value={option.id}>{option.base}, {option.unit}{option.paired ? ' (Л + П)' : ''}</option>)}
      </select>
      <button type="button" className="secondary" disabled={!preset} onClick={addPreset}>Добавить</button>
    </div>}
    <p className="muted metric-manual-hint">Или своя:</p>
    <form className="inline-form" onSubmit={(event) => void submit(event)}><input name="name" placeholder="Название" required /><input name="unit" placeholder="Единица" /><button>Добавить</button></form>
    {metrics.map((metric) => <div className="metric" key={metric.id}><span>{metric.name}{metric.unit ? `, ${metric.unit}` : ''}</span><button className="link danger" onClick={() => onArchive(metric)}>{metric.archivedAt ? 'Вернуть' : 'В архив'}</button></div>)}
  </section>
}

function numberValue(value: FormDataEntryValue | null) { return value ? Number(value) : undefined }

function entrySummaryParts(entry: ProgressEntry, metrics: CustomMetric[]): string[] {
  const parts = [
    entry.weightKg !== undefined && `${entry.weightKg} кг`,
    entry.chestCm !== undefined && `грудь ${entry.chestCm}`,
    entry.waistCm !== undefined && `талия ${entry.waistCm}`,
    entry.hipCm !== undefined && `бёдра ${entry.hipCm}`,
    ...entry.customMetrics.map(({ metricId, value }) => {
      const metric = metrics.find((item) => item.id === metricId)
      return metric ? `${metric.name} ${value}${metric.unit ? ` ${metric.unit}` : ''}` : String(value)
    }),
  ]
  return parts.filter((part): part is string => Boolean(part)).slice(0, 4)
}
