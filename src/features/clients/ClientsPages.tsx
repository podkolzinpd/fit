import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { clientsRepository } from '../../data/repositories/clients.repository'
import type { Client, Gender } from '../../shared/domain'
import { todayLocalDate } from '../../shared/local-date'
import { AsyncView, Field, Page } from '../../shared/ui'
import { clientSchema } from '../../shared/validation'
import type { z } from 'zod'

export function ClientsPage() {
  const [showArchived, setShowArchived] = useState(false)
  const query = useQuery({ queryKey: ['clients', showArchived], queryFn: () => clientsRepository.list(showArchived) })
  return <Page title="Клиенты" action={<Link className="button" to="/clients/new">Добавить</Link>}>
    <label className="toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Показывать архив</label>
    <AsyncView loading={query.isLoading} error={query.error} empty={!query.data?.length} onRetry={() => void query.refetch()}>
      <div className="cards">{query.data?.map((client) => <Link className="card" key={client.id} to={`/clients/${client.id}`}><div><strong>{client.fullName}</strong><p>{client.ageYears} лет · {client.heightCm} см{client.currentWeightKg ? ` · ${client.currentWeightKg} кг` : ''}</p></div>{client.archivedAt && <span className="badge">Архив</span>}</Link>)}</div>
    </AsyncView>
  </Page>
}

import { useState } from 'react'

type ClientValues = z.input<typeof clientSchema>

export function ClientFormPage() {
  const { clientId } = useParams(); const navigate = useNavigate(); const queryClient = useQueryClient()
  const existing = useQuery({ queryKey: ['client', clientId], queryFn: () => clientsRepository.get(clientId ?? ''), enabled: Boolean(clientId) })
  if (clientId && (existing.isLoading || existing.error)) return <Page title="Карточка клиента"><AsyncView loading={existing.isLoading} error={existing.error} onRetry={() => void existing.refetch()} /></Page>
  return <ClientForm existing={existing.data} onSaved={async (id) => { await queryClient.invalidateQueries({ queryKey: ['clients'] }); navigate(`/clients/${id}`) }} onCancel={() => navigate(-1)} />
}

function ClientForm({ existing, onSaved, onCancel }: { existing?: Client; onSaved: (id: string) => Promise<void>; onCancel: () => void }) {
  const form = useForm<ClientValues>({ resolver: zodResolver(clientSchema), defaultValues: existing ? {
    fullName: existing.fullName, gender: existing.gender, ageYears: existing.ageYears, heightCm: existing.heightCm,
    goal: existing.goal ?? '', note: existing.note ?? '',
  } : { gender: 'female', ageYears: 30, heightCm: 170 } })
  const mutation = useMutation({ mutationFn: async (values: ClientValues) => {
    const parsed = clientSchema.parse(values)
    if (existing) {
      await clientsRepository.update({ id: existing.id, version: existing.version, fullName: parsed.fullName,
        gender: parsed.gender as Gender, ageYears: parsed.ageYears, ageUpdatedAt: existing.ageUpdatedAt,
        heightCm: parsed.heightCm, goal: parsed.goal, note: parsed.note })
      return existing.id
    }
    return clientsRepository.create({ fullName: parsed.fullName, gender: parsed.gender as Gender,
      ageYears: parsed.ageYears, ageUpdatedAt: todayLocalDate(), heightCm: parsed.heightCm,
      goal: parsed.goal, note: parsed.note, initialWeightKg: parsed.initialWeightKg,
      initialWeightRecordedOn: todayLocalDate() })
  }, onSuccess: (id) => void onSaved(id) })
  return <Page title={existing ? 'Редактировать клиента' : 'Новый клиент'}>
    <form className="stack" onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate(values))(event)}>
      <Field label="Имя" error={form.formState.errors.fullName?.message}><input {...form.register('fullName')} /></Field>
      <Field label="Пол"><select {...form.register('gender')}><option value="female">Женский</option><option value="male">Мужской</option></select></Field>
      <div className="split"><Field label="Возраст"><input type="number" {...form.register('ageYears')} /></Field><Field label="Рост, см"><input type="number" step="0.1" {...form.register('heightCm')} /></Field></div>
      {!existing && <Field label="Начальный вес, кг"><input type="number" step="0.1" {...form.register('initialWeightKg')} /></Field>}
      <Field label="Цель"><textarea {...form.register('goal')} /></Field><Field label="Заметка тренера"><textarea {...form.register('note')} /></Field>
      {mutation.error && <p className="error">{mutation.error.message}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={onCancel}>Отмена</button><button disabled={mutation.isPending}>Сохранить</button></div>
    </form>
  </Page>
}

export function ClientDetailPage() {
  const { clientId = '' } = useParams(); const navigate = useNavigate(); const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['client', clientId], queryFn: () => clientsRepository.get(clientId) })
  const archive = useMutation({ mutationFn: (client: Client) => clientsRepository.setArchived(client, !client.archivedAt), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['clients'] }); await query.refetch() } })
  return <Page title={query.data?.fullName ?? 'Клиент'} action={query.data && <Link className="button secondary" to={`/clients/${clientId}/edit`}>Изменить</Link>}>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>{query.data && <>
      <section className="summary"><div><span>Возраст</span><strong>{query.data.ageYears}</strong></div><div><span>Рост</span><strong>{query.data.heightCm} см</strong></div><div><span>Вес</span><strong>{query.data.currentWeightKg ? `${query.data.currentWeightKg} кг` : '—'}</strong></div></section>
      {query.data.goal && <section><h2>Цель</h2><p>{query.data.goal}</p></section>}{query.data.note && <section><h2>Заметка</h2><p>{query.data.note}</p></section>}
      <div className="menu"><Link to={`/workouts/new?client=${clientId}`}>＋ Запланировать тренировку</Link><Link to={`/clients/${clientId}/workouts`}>Тренировки и история</Link><Link to={`/progress/${clientId}`}>Замеры и аналитика</Link></div>
      <button className="danger secondary" disabled={archive.isPending} onClick={() => archive.mutate(query.data!)}>{query.data.archivedAt ? 'Вернуть из архива' : 'Архивировать клиента'}</button>
      <button className="link" onClick={() => navigate('/clients')}>← Все клиенты</button>
    </>}</AsyncView>
  </Page>
}
