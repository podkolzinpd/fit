import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '../../app/auth-context'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { progressRepository } from '../../data/repositories/progress.repository'
import type { CustomMetric, ProgressEntry } from '../../shared/domain'
import { formatLocalDate, localDate, todayLocalDate } from '../../shared/local-date'
import { AsyncView, Field, Page } from '../../shared/ui'

export function AnalyticsPage() {
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false) })
  return <Page title="Аналитика"><AsyncView loading={clients.isLoading} error={clients.error} empty={!clients.data?.length}>{clients.data?.map((client) => <Link className="card" key={client.id} to={`/progress/${client.id}`}><div><strong>{client.fullName}</strong><p>{client.currentWeightKg ? `Текущий вес: ${client.currentWeightKg} кг` : 'Нет замеров веса'}</p></div><span>→</span></Link>)}</AsyncView></Page>
}

export function ProgressPage() {
  const { clientId = '' } = useParams(); const queryClient = useQueryClient(); const { actor } = useAuth(); const [editing, setEditing] = useState<ProgressEntry | null>(null)
  const client = useQuery({ queryKey: ['client', clientId], queryFn: () => clientsRepository.get(clientId) })
  const entries = useQuery({ queryKey: ['progress', clientId], queryFn: () => progressRepository.list(clientId) })
  const metrics = useQuery({ queryKey: ['metrics', clientId], queryFn: () => progressRepository.listMetrics(clientId) })
  const save = useMutation({ mutationFn: async (form: HTMLFormElement) => { const data = new FormData(form); return progressRepository.save({ id: editing?.id, clientId, version: editing?.version, recordedOn: localDate(String(data.get('recordedOn'))), weightKg: numberValue(data.get('weightKg')), chestCm: numberValue(data.get('chestCm')), waistCm: numberValue(data.get('waistCm')), hipCm: numberValue(data.get('hipCm')), notes: String(data.get('notes') || '') || undefined, customMetrics: metrics.data?.filter((metric) => !metric.archivedAt).flatMap((metric) => { const value = numberValue(data.get(`metric-${metric.id}`)); return value === undefined ? [] : [{ metricId: metric.id, value }] }) ?? [] }) }, onSuccess: async () => { setEditing(null); await queryClient.invalidateQueries({ queryKey: ['progress', clientId] }); await queryClient.invalidateQueries({ queryKey: ['client', clientId] }) } })
  const remove = useMutation({ mutationFn: (entry: ProgressEntry) => progressRepository.remove(entry), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['progress', clientId] }) })
  const createMetric = useMutation({ mutationFn: ({ name, unit }: { name: string; unit: string | null }) => progressRepository.createMetric(actor!.userId, clientId, name, unit), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['metrics', clientId] }) })
  const archiveMetric = useMutation({ mutationFn: (metric: CustomMetric) => progressRepository.setMetricArchived(metric, !metric.archivedAt), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['metrics', clientId] }) })
  const loading = client.isLoading || entries.isLoading || metrics.isLoading; const error = client.error ?? entries.error ?? metrics.error
  const chart = [...(entries.data ?? [])].reverse().filter((entry) => entry.weightKg).map((entry) => ({ date: entry.recordedOn.slice(5), weight: entry.weightKg }))
  return <Page title={client.data ? `Прогресс · ${client.data.fullName}` : 'Прогресс'}><AsyncView loading={loading} error={error}>{client.data && <>
    {chart.length > 1 && <section className="chart"><h2>Вес</h2><ResponsiveContainer width="100%" height={220}><LineChart data={chart}><XAxis dataKey="date" /><YAxis domain={['dataMin - 2', 'dataMax + 2']} /><Tooltip /><Line type="monotone" dataKey="weight" stroke="#735cff" strokeWidth={3} /></LineChart></ResponsiveContainer></section>}
    <ProgressForm key={editing?.id ?? 'new'} entry={editing} metrics={metrics.data ?? []} busy={save.isPending} error={save.error} onSubmit={(form) => save.mutate(form)} onCancel={editing ? () => setEditing(null) : undefined} />
    <section><h2>История замеров</h2>{entries.data?.map((entry) => <article className="card" key={entry.id}><div><strong>{formatLocalDate(entry.recordedOn)}</strong><p>{[entry.weightKg && `${entry.weightKg} кг`, entry.chestCm && `грудь ${entry.chestCm}`, entry.waistCm && `талия ${entry.waistCm}`, entry.hipCm && `бёдра ${entry.hipCm}`].filter(Boolean).join(' · ')}</p></div><div className="row-actions"><button className="link" onClick={() => setEditing(entry)}>Изменить</button><button className="link danger" onClick={() => remove.mutate(entry)}>Удалить</button></div></article>)}</section>
    <MetricsManager metrics={metrics.data ?? []} onCreate={(name, unit) => createMetric.mutate({ name, unit })} onArchive={(metric) => archiveMetric.mutate(metric)} />
  </>}</AsyncView></Page>
}

function ProgressForm({ entry, metrics, busy, error, onSubmit, onCancel }: { entry: ProgressEntry | null; metrics: CustomMetric[]; busy: boolean; error: Error | null; onSubmit: (form: HTMLFormElement) => void; onCancel?: () => void }) {
  return <section><h2>{entry ? 'Изменить замер' : 'Новый замер'}</h2><form className="stack compact" onSubmit={(event) => { event.preventDefault(); onSubmit(event.currentTarget) }}><Field label="Дата"><input name="recordedOn" type="date" defaultValue={entry?.recordedOn ?? todayLocalDate()} required /></Field><div className="measure-grid"><Field label="Вес, кг"><input name="weightKg" type="number" step="0.1" defaultValue={entry?.weightKg} /></Field><Field label="Грудь, см"><input name="chestCm" type="number" step="0.1" defaultValue={entry?.chestCm} /></Field><Field label="Талия, см"><input name="waistCm" type="number" step="0.1" defaultValue={entry?.waistCm} /></Field><Field label="Бёдра, см"><input name="hipCm" type="number" step="0.1" defaultValue={entry?.hipCm} /></Field></div>{metrics.filter((metric) => !metric.archivedAt).map((metric) => <Field key={metric.id} label={`${metric.name}${metric.unit ? `, ${metric.unit}` : ''}`}><input name={`metric-${metric.id}`} type="number" step="0.001" defaultValue={entry?.customMetrics.find((value) => value.metricId === metric.id)?.value} /></Field>)}<Field label="Заметка"><textarea name="notes" defaultValue={entry?.notes} /></Field>{error && <p className="error">{error.message}</p>}<div className="actions">{onCancel && <button type="button" className="secondary" onClick={onCancel}>Отмена</button>}<button disabled={busy}>Сохранить замер</button></div></form></section>
}

function MetricsManager({ metrics, onCreate, onArchive }: { metrics: CustomMetric[]; onCreate: (name: string, unit: string | null) => void; onArchive: (metric: CustomMetric) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); onCreate(String(data.get('name')), String(data.get('unit') || '') || null); event.currentTarget.reset() }
  return <section><h2>Свои метрики</h2><form className="inline-form" onSubmit={(event) => void submit(event)}><input name="name" placeholder="Название" required /><input name="unit" placeholder="Единица" /><button>Добавить</button></form>{metrics.map((metric) => <div className="metric" key={metric.id}><span>{metric.name}{metric.unit ? `, ${metric.unit}` : ''}</span><button className="link danger" onClick={() => onArchive(metric)}>{metric.archivedAt ? 'Вернуть' : 'В архив'}</button></div>)}</section>
}

function numberValue(value: FormDataEntryValue | null) { return value ? Number(value) : undefined }
