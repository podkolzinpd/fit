import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { goalsRepository } from '../../data/repositories/goals.repository'
import { invitationsRepository } from '../../data/repositories/invitations.repository'
import { bmiLabel, computeClientStats, splitClientWorkouts, workoutsRepository } from '../../data/repositories/workouts.repository'
import { WorkoutExercisesSummary } from '../workouts'
import type { Client, Gender } from '../../shared/domain'
import { currentStage, daysToTarget, stageProgress } from '../../shared/goal-rules'
import { formatLocalDate, formatLocalDateShort, localDate, todayLocalDate } from '../../shared/local-date'
import { AsyncView, Field, Page } from '../../shared/ui'
import { clientSchema } from '../../shared/validation'
import { VoiceNoteField } from '../voice-input'
import type { z } from 'zod'
import { useClientRealtime } from '../../app/use-client-realtime'
import { useAuth } from '../../app/auth-context'

export function ClientsPage() {
  const showArchived = localStorage.getItem('fit.showArchivedClients') === 'true'
  const query = useQuery({ queryKey: ['clients', showArchived], queryFn: () => clientsRepository.list(showArchived) })
  return <Page title="Мои клиенты" action={<Link className="button" to="/clients/new">Добавить</Link>}>
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
  return <Page title="Мой кабинет" action={query.data && <Link className="button secondary" to="/me/edit">Изменить данные</Link>}>
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
  useClientRealtime(clientId)
  const existing = useQuery({ queryKey: ['client', clientId], queryFn: () => clientsRepository.get(clientId ?? ''), enabled: Boolean(clientId) })
  if (clientId && (existing.isLoading || existing.error)) return <Page title="Карточка клиента"><AsyncView loading={existing.isLoading} error={existing.error} onRetry={() => void existing.refetch()} /></Page>
  if (clientId && existing.data) return <TrainerClientPreferencesForm client={existing.data} onSaved={async () => {
    await queryClient.invalidateQueries({ queryKey: ['clients'] })
    await queryClient.invalidateQueries({ queryKey: ['client', clientId] })
    navigate(`/clients/${clientId}`)
  }} onCancel={() => navigate(-1)} />
  return <ClientForm onSaved={async (id) => { await queryClient.invalidateQueries({ queryKey: ['clients'] }); navigate(`/clients/${id}`) }} onCancel={() => navigate(-1)} />
}

export function MyClientEditPage() {
  const navigate = useNavigate(); const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine() })
  useClientRealtime(query.data?.id)
  return <AsyncView loading={query.isLoading} error={query.error} empty={!query.data} onRetry={() => void query.refetch()}>
    {query.data && <ClientForm existing={query.data} createMode="self" onSaved={async () => {
      await queryClient.invalidateQueries({ queryKey: ['my-client'] })
      navigate('/me')
    }} onCancel={() => navigate(-1)} />}
  </AsyncView>
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
      const input = { id: existing.id, version: existing.version, fullName: parsed.fullName,
        gender: parsed.gender as Gender, ageYears: parsed.ageYears, ageUpdatedAt: existing.ageUpdatedAt,
        heightCm: parsed.heightCm, goal: parsed.goal, note: parsed.note }
      if (createMode === 'self') await clientsRepository.updateOwn(input)
      else await clientsRepository.update(input)
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
      {createMode === 'trainer' && <Controller
        control={form.control}
        name="note"
        render={({ field }) => <VoiceNoteField name={field.name} source="client_form" label="Общий комментарий" value={field.value ?? ''} onValueChange={field.onChange} />}
      />}
      {mutation.error && <p className="error">{mutation.error.message}</p>}
      <div className="actions">{onCancel && <button type="button" className="secondary" onClick={onCancel}>Отмена</button>}<button disabled={mutation.isPending}>{createMode === 'self' && !existing ? 'Создать карточку' : 'Сохранить'}</button></div>
    </form>
  return embedded ? contents : <Page title={existing ? 'Редактировать клиента' : 'Новый клиент'}>{contents}</Page>
}

// update_client пишет goal и note одной транзакцией с optimistic-lock (version).
// Поэтому обе формы (цель / заметка) сохраняют через один хелпер и всегда
// передают текущее значение соседнего поля — чтобы правка одного не затирала другое.
function useSaveClient(client: Client, onDone: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: { goal?: string; note?: string }) => clientsRepository.update({
      id: client.id, version: client.version, fullName: client.fullName, gender: client.gender,
      ageYears: client.ageYears, ageUpdatedAt: client.ageUpdatedAt, heightCm: client.heightCm,
      goal: (patch.goal ?? client.goal ?? '').trim() || undefined,
      note: (patch.note ?? client.note ?? '').trim() || undefined,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      await queryClient.invalidateQueries({ queryKey: ['client', client.id] })
      onDone()
    },
  })
}

// «Осталось N дней» / «срок сегодня» / «просрочено N дней» по target_date.
function targetHint(days: number): string {
  if (days === 0) return 'срок сегодня'
  if (days < 0) return `просрочено ${-days} дн.`
  return `осталось ${days} дн.`
}

function ClientGoalBlock({ client }: { client: Client }) {
  const goalQuery = useQuery({ queryKey: ['client-goal', client.id], queryFn: () => goalsRepository.get(client.id) })
  const [editingText, setEditingText] = useState(false)
  const form = useForm<{ goal: string }>({ defaultValues: { goal: client.goal ?? '' } })
  const mutation = useSaveClient(client, () => setEditingText(false))
  const startEditing = () => { form.reset({ goal: client.goal ?? '' }); setEditingText(true) }

  // Цель как сущность (client_goals) — приоритетна: заголовок + дата + текущий этап.
  const goal = goalQuery.data
  if (goal) {
    const today = todayLocalDate()
    const days = daysToTarget(goal, today)
    const stage = currentStage(goal, today)
    const progress = stageProgress(goal, today)
    return <section className="goal-block">
      <div className="goal-head"><h2>Цель</h2><Link className="link" to={`/clients/${client.id}/goal`}>Открыть →</Link></div>
      <p>{goal.title}</p>
      {goal.targetDate && <p className="muted">До {formatLocalDateShort(localDate(goal.targetDate))}{days !== null ? ` · ${targetHint(days)}` : ''}</p>}
      {progress && progress.total > 0 && <p className="goal-stage-line">
        {stage ? `Этап ${progress.index} из ${progress.total} · «${stage.title}»` : `${progress.total} ${progress.total === 1 ? 'этап' : 'этапа'}, между периодами`}
      </p>}
    </section>
  }

  // Легаси-текст цели (clients.goal): показываем + inline-правку, предлагаем оформить.
  if (editingText) return <section className="goal-block">
    <form className="stack" onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate({ goal: values.goal }))(event)}>
      <Field label="Цель"><textarea rows={3} placeholder="Например: похудеть к отпуску, −8 кг" {...form.register('goal')} /></Field>
      {mutation.error && <p className="error">{mutation.error.message}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={() => setEditingText(false)}>Отмена</button><button disabled={mutation.isPending}>Сохранить</button></div>
    </form>
  </section>
  return <section className="goal-block">
    <div className="goal-head"><h2>Цель</h2><button type="button" className="link" onClick={startEditing}>{client.goal ? 'Изменить' : '＋ Добавить'}</button></div>
    {client.goal ? <p>{client.goal}</p> : <p className="muted">Цель пока не задана</p>}
    {/* Периодизация: оформить цель с датой и этапами (Заход 2). */}
    <Link className="goal-stages-hint" to={`/clients/${client.id}/goal`}>
      <div><strong>Разбить путь на этапы</strong><p>Периоды с датами: набор, сушка, поддержка — со сроком к цели</p></div>
      <span className="button secondary">Оформить</span>
    </Link>
  </section>
}

function ClientNoteBlock({ client }: { client: Client }) {
  const [editing, setEditing] = useState(false)
  const form = useForm<{ note: string }>({ defaultValues: { note: client.note ?? '' } })
  const mutation = useSaveClient(client, () => setEditing(false))
  const startEditing = () => { form.reset({ note: client.note ?? '' }); setEditing(true) }
  if (editing) return <section className="goal-block">
    <form className="stack" onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate({ note: values.note }))(event)}>
      <Controller control={form.control} name="note" render={({ field }) =>
        <VoiceNoteField name={field.name} source="client_form" label="Заметка" value={field.value} onValueChange={field.onChange} />
      } />
      {mutation.error && <p className="error">{mutation.error.message}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={() => setEditing(false)}>Отмена</button><button disabled={mutation.isPending}>Сохранить</button></div>
    </form>
  </section>
  return <section className="goal-block">
    <div className="goal-head"><h2>Заметка</h2><button type="button" className="link" onClick={startEditing}>{client.note ? 'Изменить' : '＋ Добавить'}</button></div>
    {client.note ? <p>{client.note}</p> : <p className="muted">Заметок пока нет</p>}
  </section>
}

function TrainerClientPreferencesForm({ client, onSaved, onCancel }: {
  client: Client
  onSaved: () => Promise<void>
  onCancel: () => void
}) {
  const form = useForm<{ alias: string; note: string }>({ defaultValues: { alias: client.fullName, note: client.note ?? '' } })
  const mutation = useMutation({
    mutationFn: (values: { alias: string; note: string }) => clientsRepository.updatePreferences({
      clientId: client.id, alias: values.alias.trim(), note: values.note.trim() || undefined,
      version: client.membershipVersion ?? 1,
    }),
    onSuccess: () => void onSaved(),
  })
  return <Page title="Моё отображение клиента">
    <form className="stack" onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate(values))(event)}>
      <p className="muted">Эти настройки видны только вам и не меняют данные клиента.</p>
      <Field label="Имя в моём списке" error={form.formState.errors.alias?.message}>
        <input {...form.register('alias', { required: 'Введите имя', maxLength: { value: 120, message: 'Не больше 120 символов' } })} />
      </Field>
      <Controller control={form.control} name="note" render={({ field }) =>
        <VoiceNoteField name={field.name} source="client_form" label="Личная заметка" value={field.value} onValueChange={field.onChange} />
      } />
      {mutation.error && <p className="error">{mutation.error.message}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={onCancel}>Отмена</button><button disabled={mutation.isPending}>Сохранить</button></div>
    </form>
  </Page>
}

export function ClientDetailPage() {
  const { clientId = '' } = useParams(); const queryClient = useQueryClient()
  const { actor } = useAuth(); const navigate = useNavigate()
  useClientRealtime(clientId)
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
  return <Page title={query.data?.fullName ?? 'Клиент'} center back="/clients" action={query.data && <Link className="button secondary" to={`/clients/${clientId}/edit`}>Мои настройки</Link>}>
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
      <ClientGoalBlock client={query.data} />
      <ClientNoteBlock client={query.data} />
      {upcoming.length > 0 && <section><h2>Предстоит</h2><div className="cards">{upcoming.map((workout) => <Link className="card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}{workout.startTime ? ` · ${workout.startTime.slice(0, 5)}` : ''}</strong><WorkoutExercisesSummary workout={workout} />{workout.stageTitle && <p className="stage-tag">🎯 {workout.stageTitle}</p>}</div><span className={`badge ${workout.status}`}>{workout.status === 'in_progress' ? 'Идёт' : 'План'}</span></Link>)}</div></section>}
      <div className="page-actions">
        {query.data.hasAccount === false && <button className="secondary wide" disabled={invite.isPending} onClick={() => invite.mutate()}>Пригласить клиента</button>}
        {invite.data && <div className="card"><strong>Код клиента: {invite.data}</strong><p>Передайте код клиенту. Он действует 7 дней и используется один раз.</p></div>}
        {invitations.data?.map((item) => <article className="card" key={item.id}><div><strong>Активное приглашение клиента</strong><p>Действует до {new Date(item.expiresAt).toLocaleDateString('ru-RU')}</p></div><button className="link danger" disabled={revoke.isPending} onClick={() => { if (window.confirm('Отозвать это приглашение? Код больше нельзя будет использовать.')) revoke.mutate(item.id) }}>Отозвать</button></article>)}
        {invite.error && <p className="error">{invite.error.message}</p>}
        {revoke.error && <p className="error">{revoke.error.message}</p>}
        {currentMembership && !currentMembership.isRoot && <button className="danger secondary wide" disabled={leave.isPending} onClick={() => { if (window.confirm('Покинуть пространство клиента? Доступ к тренировкам и прогрессу будет закрыт.')) leave.mutate() }}>Покинуть пространство клиента</button>}
        {leave.error && <p className="error">{leave.error.message}</p>}
        {currentMembership?.isRoot && <button className="danger secondary wide" disabled={archive.isPending} onClick={() => archive.mutate(query.data!)}>{query.data.archivedAt ? 'Вернуть из архива' : 'Архивировать клиента'}</button>}
      </div>
    </>}</AsyncView>
  </Page>
}
