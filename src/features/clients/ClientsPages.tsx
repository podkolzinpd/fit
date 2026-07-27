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
import { useClientRealtime } from '../../app/use-client-realtime'
import { useAuth } from '../../app/auth-context'

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
  const { actor } = useAuth()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine() })
  useClientRealtime(query.data?.id)
  const trainers = useQuery({ queryKey: ['client-trainers', query.data?.id], queryFn: () => invitationsRepository.listTrainers(query.data!.id), enabled: Boolean(query.data) })
  const invitations = useQuery({ queryKey: ['client-invitations', query.data?.id], queryFn: () => invitationsRepository.list(query.data!.id), enabled: Boolean(query.data) })
  const invite = useMutation({ mutationFn: (clientId: string) => invitationsRepository.create(clientId, 'trainer'), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-invitations', query.data?.id] }) })
  const revoke = useMutation({ mutationFn: (invitationId: string) => invitationsRepository.revoke(invitationId), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-invitations', query.data?.id] }) })
  const removeTrainer = useMutation({ mutationFn: (trainerId: string) => invitationsRepository.removeTrainer(query.data!.id, trainerId), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-trainers', query.data?.id] }) })
  return <Page title="Мой кабинет">
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {query.data ? <div className="stack">
        <section className="summary">
          <div><span>Возраст</span><strong>{query.data.ageYears}</strong></div>
          <div><span>Рост</span><strong>{query.data.heightCm} см</strong></div>
          <div><span>Вес</span><strong>{query.data.currentWeightKg ? `${query.data.currentWeightKg} кг` : '—'}</strong></div>
        </section>
        <section><h2>{query.data.fullName}</h2>{query.data.goal && <><h3>Цель</h3><p>{query.data.goal}</p></>}</section>
        <div className="client-actions-row"><Link className="button" to="/me/workouts">Тренировки</Link><Link className="button secondary" to="/me/progress">Прогресс</Link></div>
        <button className="secondary" disabled={invite.isPending} onClick={() => invite.mutate(query.data!.id)}>Пригласить тренера</button>
        {invite.data && <div className="card"><strong>Код для тренера: {invite.data}</strong><p>Код действует 7 дней и используется один раз.</p></div>}
        {invite.error && <p className="error">{invite.error.message}</p>}
        <section><h2>Мои тренеры</h2>
          {trainers.isLoading && <p className="muted">Загрузка тренеров…</p>}
          {trainers.error && <div><p className="error">{trainers.error.message}</p><button className="secondary" onClick={() => void trainers.refetch()}>Повторить</button></div>}
          {trainers.data?.length === 0 && <p className="muted">Подключённых тренеров нет</p>}
          {trainers.data?.map((trainer) => <article className="card" key={trainer.trainerId}><div><strong>{[trainer.firstName, trainer.lastName].filter(Boolean).join(' ') || 'Тренер'}</strong><p>{trainer.isRoot ? 'Основной тренер' : 'Подключённый тренер'}</p></div>{!trainer.isRoot && <button className="link danger" disabled={removeTrainer.isPending} onClick={() => { if (window.confirm('Отключить этого тренера? Он потеряет доступ к вашим тренировкам и прогрессу.')) removeTrainer.mutate(trainer.trainerId) }}>Отключить</button>}</article>)}
        </section>
        {invitations.isLoading && <p className="muted">Загрузка приглашений…</p>}
        {invitations.data && invitations.data.length > 0 && <section><h2>Активные приглашения</h2>{invitations.data.map((item) => <article className="card" key={item.id}><div><strong>Для тренера</strong><p>Действует до {new Date(item.expiresAt).toLocaleDateString('ru-RU')}</p></div><button className="link danger" disabled={revoke.isPending} onClick={() => { if (window.confirm('Отозвать это приглашение? Код больше нельзя будет использовать.')) revoke.mutate(item.id) }}>Отозвать</button></article>)}</section>}
        {invitations.error && <div><p className="error">{invitations.error.message}</p><button className="secondary" onClick={() => void invitations.refetch()}>Повторить</button></div>}
        {(removeTrainer.error || revoke.error) && <p className="error">{(removeTrainer.error ?? revoke.error)?.message}</p>}
      </div> : <div className="stack">
        <div className="state">
          <h2>Создайте личную карточку</h2>
          <p>Она нужна для самостоятельных тренировок и замеров. Тренера можно пригласить позже.</p>
        </div>
        <ClientForm
          createMode="self"
          initialFullName={[actor?.firstName, actor?.lastName].filter(Boolean).join(' ')}
          embedded
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['my-client'] })
          }}
        />
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

function ClientForm({
  existing,
  initialFullName,
  createMode = 'trainer',
  embedded = false,
  onSaved,
  onCancel,
}: {
  existing?: Client
  initialFullName?: string
  createMode?: 'trainer' | 'self'
  embedded?: boolean
  onSaved: (id: string) => Promise<void>
  onCancel?: () => void
}) {
  const form = useForm<ClientValues>({ resolver: zodResolver(clientSchema), defaultValues: existing ? {
    fullName: existing.fullName, gender: existing.gender, ageYears: existing.ageYears, heightCm: existing.heightCm,
    goal: existing.goal ?? '', note: existing.note ?? '',
  } : { fullName: initialFullName, gender: 'female', ageYears: 30, heightCm: 170 } })
  const mutation = useMutation({ mutationFn: async (values: ClientValues) => {
    const parsed = clientSchema.parse(values)
    if (existing) {
      await clientsRepository.update({ id: existing.id, version: existing.version, fullName: parsed.fullName,
        gender: parsed.gender as Gender, ageYears: parsed.ageYears, ageUpdatedAt: existing.ageUpdatedAt,
        heightCm: parsed.heightCm, goal: parsed.goal, note: parsed.note })
      return existing.id
    }
    const input = { fullName: parsed.fullName, gender: parsed.gender as Gender,
      ageYears: parsed.ageYears, ageUpdatedAt: todayLocalDate(), heightCm: parsed.heightCm,
      goal: parsed.goal, note: parsed.note, initialWeightKg: parsed.initialWeightKg,
      initialWeightRecordedOn: todayLocalDate() }
    return createMode === 'self' ? clientsRepository.createOwn(input) : clientsRepository.create(input)
  }, onSuccess: (id) => void onSaved(id) })
  const contents = <form className="stack" onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate(values))(event)}>
      <Field label="Имя" error={form.formState.errors.fullName?.message}><input {...form.register('fullName')} /></Field>
      <Field label="Пол"><select {...form.register('gender')}><option value="female">Женский</option><option value="male">Мужской</option></select></Field>
      <div className="split"><Field label="Возраст"><input type="number" {...form.register('ageYears')} /></Field><Field label="Рост, см"><input type="number" step="0.1" {...form.register('heightCm')} /></Field></div>
      {!existing && <Field label="Начальный вес, кг"><input type="number" step="0.1" {...form.register('initialWeightKg')} /></Field>}
      <Field label="Цель"><textarea {...form.register('goal')} /></Field>
      <Controller
        control={form.control}
        name="note"
        render={({ field }) => <VoiceNoteField name={field.name} label="Общий комментарий" value={field.value ?? ''} onValueChange={field.onChange} />}
      />
      {mutation.error && <p className="error">{mutation.error.message}</p>}
      <div className="actions">{onCancel && <button type="button" className="secondary" onClick={onCancel}>Отмена</button>}<button disabled={mutation.isPending}>{createMode === 'self' ? 'Создать карточку' : 'Сохранить'}</button></div>
    </form>
  return embedded ? contents : <Page title={existing ? 'Редактировать клиента' : 'Новый клиент'}>{contents}</Page>
}

export function ClientDetailPage() {
  const { clientId = '' } = useParams(); const queryClient = useQueryClient()
  const { actor } = useAuth(); const navigate = useNavigate()
  const query = useQuery({ queryKey: ['client', clientId], queryFn: () => clientsRepository.get(clientId) })
  const stats = useQuery({ queryKey: ['client-stats', clientId], queryFn: async () => computeClientStats(await workoutsRepository.listSummaries(clientId), todayLocalDate()) })
  const workouts = useQuery({ queryKey: ['workouts', clientId, 'upcoming'], queryFn: () => workoutsRepository.list(undefined, undefined, clientId) })
  const upcoming = workouts.data ? splitClientWorkouts(workouts.data, todayLocalDate()).upcoming : []
  const archive = useMutation({ mutationFn: (client: Client) => clientsRepository.setArchived(client, !client.archivedAt), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['clients'] }); await query.refetch() } })
  const invitations = useQuery({ queryKey: ['client-invitations', clientId], queryFn: () => invitationsRepository.list(clientId) })
  const invite = useMutation({ mutationFn: () => invitationsRepository.create(clientId, 'client'), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-invitations', clientId] }) })
  const revoke = useMutation({ mutationFn: (invitationId: string) => invitationsRepository.revoke(invitationId), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-invitations', clientId] }) })
  const trainers = useQuery({ queryKey: ['client-trainers', clientId], queryFn: () => invitationsRepository.listTrainers(clientId) })
  const currentMembership = trainers.data?.find((trainer) => trainer.trainerId === actor?.userId)
  const leave = useMutation({ mutationFn: () => invitationsRepository.leave(clientId), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['clients'] }); navigate('/clients') } })
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
        {invitations.data?.map((item) => <article className="card" key={item.id}><div><strong>Активное приглашение клиента</strong><p>Действует до {new Date(item.expiresAt).toLocaleDateString('ru-RU')}</p></div><button className="link danger" disabled={revoke.isPending} onClick={() => { if (window.confirm('Отозвать это приглашение? Код больше нельзя будет использовать.')) revoke.mutate(item.id) }}>Отозвать</button></article>)}
        {invite.error && <p className="error">{invite.error.message}</p>}
        {revoke.error && <p className="error">{revoke.error.message}</p>}
        {currentMembership && !currentMembership.isRoot && <button className="danger secondary wide" disabled={leave.isPending} onClick={() => { if (window.confirm('Покинуть пространство клиента? Доступ к тренировкам и прогрессу будет закрыт.')) leave.mutate() }}>Покинуть пространство клиента</button>}
        {leave.error && <p className="error">{leave.error.message}</p>}
        <button className="danger secondary wide" disabled={archive.isPending} onClick={() => archive.mutate(query.data!)}>{query.data.archivedAt ? 'Вернуть из архива' : 'Архивировать клиента'}</button>
      </div>
    </>}</AsyncView>
  </Page>
}
