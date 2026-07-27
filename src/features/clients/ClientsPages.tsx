import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { invitationsRepository } from '../../data/repositories/invitations.repository'
import { bmiLabel, computeClientStats, splitClientWorkouts, workoutsRepository } from '../../data/repositories/workouts.repository'
import { WorkoutExercisesSummary } from '../workouts'
import type { Client, Gender } from '../../shared/domain'
import { formatLocalDate, todayLocalDate } from '../../shared/local-date'
import { AsyncView, Field, Page } from '../../shared/ui'
import { clientSchema } from '../../shared/validation'
import { VoiceNoteField } from '../voice-input'
import type { z } from 'zod'

export function ClientsPage() {
  const [showArchived, setShowArchived] = useState(false)
  const query = useQuery({ queryKey: ['clients', showArchived], queryFn: () => clientsRepository.list(showArchived) })
  return <Page title="Мои клиенты" action={<Link className="button" to="/clients/new">Добавить</Link>}>
    <label className="toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Показывать архив</label>
    <AsyncView loading={query.isLoading} error={query.error} empty={!query.data?.length} onRetry={() => void query.refetch()}>
      <div className="cards">{query.data?.map((client) => <Link className="card client-card" key={client.id} to={`/clients/${client.id}`}><span className={`client-avatar tone-${client.fullName.length % 4}`}>{client.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><div><strong>{client.fullName}</strong><p>{client.ageYears} лет · {client.heightCm} см{client.currentWeightKg ? ` · ${client.currentWeightKg} кг` : ''} · ИМТ {bmiLabel(client.heightCm, client.currentWeightKg)}</p></div>{client.archivedAt && <span className="badge">Архив</span>}</Link>)}</div>
    </AsyncView>
  </Page>
}

export function MyClientPage() {
  const query = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine() })
  const invite = useMutation({ mutationFn: (clientId: string) => invitationsRepository.create(clientId, 'trainer') })
  return <Page title="Мой кабинет">
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {query.data ? <div className="stack">
        <section className="summary">
          <div><span>Возраст</span><strong>{query.data.ageYears}</strong></div>
          <div><span>Рост</span><strong>{query.data.heightCm} см</strong></div>
          <div><span>Вес</span><strong>{query.data.currentWeightKg ? `${query.data.currentWeightKg} кг` : '—'}</strong></div>
        </section>
        <section><h2>{query.data.fullName}</h2>{query.data.goal && <><h3>Цель</h3><p>{query.data.goal}</p></>}</section>
        <button className="secondary" disabled={invite.isPending} onClick={() => invite.mutate(query.data!.id)}>Пригласить тренера</button>
        {invite.data && <div className="card"><strong>Код для тренера: {invite.data}</strong><p>Код действует 7 дней и используется один раз.</p></div>}
        {invite.error && <p className="error">{invite.error.message}</p>}
      </div> : <div className="state">
        <h2>Карточка ещё не подключена</h2>
        <p>Попросите тренера привязать ваш аккаунт. Приглашения по коду появятся следующим этапом.</p>
      </div>}
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
      <Field label="Цель"><textarea {...form.register('goal')} /></Field>
      <Controller
        control={form.control}
        name="note"
        render={({ field }) => <VoiceNoteField name={field.name} label="Заметка тренера" value={field.value ?? ''} onValueChange={field.onChange} />}
      />
      {mutation.error && <p className="error">{mutation.error.message}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={onCancel}>Отмена</button><button disabled={mutation.isPending}>Сохранить</button></div>
    </form>
  </Page>
}

export function ClientDetailPage() {
  const { clientId = '' } = useParams(); const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['client', clientId], queryFn: () => clientsRepository.get(clientId) })
  const stats = useQuery({ queryKey: ['client-stats', clientId], queryFn: async () => computeClientStats(await workoutsRepository.listSummaries(clientId), todayLocalDate()) })
  const workouts = useQuery({ queryKey: ['workouts', clientId, 'upcoming'], queryFn: () => workoutsRepository.list(undefined, undefined, clientId) })
  const upcoming = workouts.data ? splitClientWorkouts(workouts.data, todayLocalDate()).upcoming : []
  const archive = useMutation({ mutationFn: (client: Client) => clientsRepository.setArchived(client, !client.archivedAt), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['clients'] }); await query.refetch() } })
  const invite = useMutation({ mutationFn: () => invitationsRepository.create(clientId, 'client') })
  return <Page title={query.data?.fullName ?? 'Клиент'} center back="/clients" action={query.data && <Link className="button secondary" to={`/clients/${clientId}/edit`}>Изменить</Link>}>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>{query.data && <>
      <section className="summary"><div><span>Возраст</span><strong>{query.data.ageYears}</strong></div><div><span>Рост</span><strong>{query.data.heightCm} см</strong></div><div><span>Вес</span><strong>{query.data.currentWeightKg ? `${query.data.currentWeightKg} кг` : '—'}</strong></div></section>
      {stats.data && <>
        {stats.data.needsAttention && <p className="attention">⚠ Давно не тренировался</p>}
        <section className="summary stats stats-3">
          <div><span>Тренировок</span><strong>{stats.data.doneCount}</strong></div>
          <div><span>Выполнено</span><strong>{stats.data.completionPercent === null ? '—' : `${stats.data.completionPercent}%`}</strong></div>
          <div><span>ИМТ</span><strong>{bmiLabel(query.data.heightCm, query.data.currentWeightKg)}</strong></div>
        </section>
      </>}
      <div className="client-actions">
        <div className="client-actions-row">
          <Link className="button" to={`/workouts/new?client=${clientId}`}>＋ Запланировать</Link>
          <Link className="button secondary" to={`/clients/${clientId}/workouts`}>История</Link>
        </div>
        <Link className="button secondary wide" to={`/progress/${clientId}`}>Замеры и аналитика</Link>
      </div>
      {query.data.goal && <section><h2>Цель</h2><p>{query.data.goal}</p></section>}{query.data.note && <section><h2>Заметка</h2><p>{query.data.note}</p></section>}
      {upcoming.length > 0 && <section><h2>Предстоит</h2><div className="cards">{upcoming.map((workout) => <Link className="card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}{workout.startTime ? ` · ${workout.startTime.slice(0, 5)}` : ''}</strong><WorkoutExercisesSummary workout={workout} /></div><span className={`badge ${workout.status}`}>{workout.status === 'in_progress' ? 'Идёт' : 'План'}</span></Link>)}</div></section>}
      <div className="page-actions">
        {query.data.hasAccount === false && <button className="secondary wide" disabled={invite.isPending} onClick={() => invite.mutate()}>Пригласить клиента</button>}
        {invite.data && <div className="card"><strong>Код клиента: {invite.data}</strong><p>Передайте код клиенту. Он действует 7 дней и используется один раз.</p></div>}
        {invite.error && <p className="error">{invite.error.message}</p>}
        <button className="danger secondary wide" disabled={archive.isPending} onClick={() => archive.mutate(query.data!)}>{query.data.archivedAt ? 'Вернуть из архива' : 'Архивировать клиента'}</button>
      </div>
    </>}</AsyncView>
  </Page>
}
