import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { goalsRepository } from '../../data/repositories/goals.repository'
import { invitationsRepository } from '../../data/repositories/invitations.repository'
import { bmiLabel, computeClientStats, splitClientWorkouts, workoutsRepository } from '../../data/repositories/workouts.repository'
import { WorkoutExercisesSummary } from '../workouts'
import type { Client, Gender } from '../../shared/domain'
import { currentStage, daysToTarget, stageProgress } from '../../shared/goal-rules'
import { formatLocalDate, formatLocalDateShort, localDate, todayLocalDate } from '../../shared/local-date'
import { AsyncView, Field, Page, useConfirm } from '../../shared/ui'
import { clientSchema } from '../../shared/validation'
import { VoiceNoteField } from '../voice-input'
import { z } from 'zod'
import { useClientRealtime } from '../../app/use-client-realtime'
import { useAuth } from '../../app/auth-context'
import { ProfileIcon } from '../../shared/icons'
import { WearableHealthCard } from '../wearables'
import { isWearablesPilotEnabled } from '../../app/feature-flags'

export function ClientsPage() {
  const showArchived = localStorage.getItem('fit.showArchivedClients') === 'true'
  // Список — рабочая очередь тренера, поэтому при каждом входе показываем
  // актуальную активность, а не данные из короткого SPA-кэша.
  const query = useQuery({ queryKey: ['clients', showArchived], queryFn: () => clientsRepository.list(showArchived), refetchOnMount: 'always' })
  const [search, setSearch] = useState('')
  const clients = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('ru')
    return query.data
      ?.filter((client) => !normalizedSearch || client.fullName.toLocaleLowerCase('ru').includes(normalizedSearch))
      .sort((left, right) => (right.lastActivityAt ?? '').localeCompare(left.lastActivityAt ?? '')) ?? []
  }, [query.data, search])
  return <Page title="Клиенты" className="clients-page" action={<Link className="button" to="/clients/new">Добавить</Link>}>
    <AsyncView loading={query.isLoading} error={query.error} empty={!query.data?.length} onRetry={() => void query.refetch()}
      emptyTitle="Клиентов пока нет"
      emptyDescription="Нажмите «Добавить» сверху, чтобы создать первого клиента, планировать тренировки и отслеживать прогресс.">
      <label className="clients-search"><span className="sr-only">Поиск клиента</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по имени" autoComplete="off" /></label>
      {clients.length > 0 ? <div className="cards clients-list">{clients.map((client) => <Link className="card client-card" key={client.id} to={`/clients/${client.id}`}><span className="client-avatar" aria-hidden="true"><ProfileIcon /></span><div><strong>{client.fullName}</strong><p>{client.ageYears && client.heightCm ? `${client.ageYears} лет · ${client.heightCm} см · ИМТ ${bmiLabel(client.heightCm, client.currentWeightKg)}` : 'Нужно дополнить профиль'}{client.currentWeightKg ? ` · ${client.currentWeightKg} кг` : ''}</p></div>{client.archivedAt && <span className="badge">Архив</span>}<span className="client-card-arrow" aria-hidden="true">›</span></Link>)}</div> : <p className="clients-search-empty">По этому имени клиентов не найдено.</p>}
    </AsyncView>
  </Page>
}

export function MyClientPage() {
  const { actor, refresh } = useAuth()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine() })
  useClientRealtime(query.data?.id)
  const trainers = useQuery({ queryKey: ['client-trainers', query.data?.id], queryFn: () => invitationsRepository.listTrainers(query.data!.id), enabled: Boolean(query.data) })
  const invitations = useQuery({ queryKey: ['client-invitations', query.data?.id], queryFn: () => invitationsRepository.list(query.data!.id), enabled: Boolean(query.data) })
  const invite = useMutation({ mutationFn: (clientId: string) => invitationsRepository.create(clientId, 'trainer'), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-invitations', query.data?.id] }) })
  const revoke = useMutation({ mutationFn: (invitationId: string) => invitationsRepository.revoke(invitationId), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-invitations', query.data?.id] }) })
  const removeTrainer = useMutation({ mutationFn: (trainerId: string) => invitationsRepository.removeTrainer(query.data!.id, trainerId), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-trainers', query.data?.id] }) })
  const [confirm, confirmDialog] = useConfirm()
  return <Page title="Кабинет" className="client-home-page" action={query.data && <Link className="button secondary" to="/me/edit">Изменить данные</Link>}>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {query.data ? <div className="stack client-home-stack">
        <section className="client-home-hero">
          <p className="eyebrow">МОЙ ПРОФИЛЬ</p>
          <h2>{query.data.fullName}</h2>
          <p>{query.data.goal || 'Добавьте цель — тренировки и прогресс будут понятнее.'}</p>
        </section>
        <section className="summary client-home-summary" aria-label="Параметры профиля">
          <div><span>Возраст</span><strong>{query.data.ageYears ?? '—'}</strong></div>
          <div><span>Рост</span><strong>{query.data.heightCm ? `${query.data.heightCm} см` : '—'}</strong></div>
          <div><span>Вес</span><strong>{query.data.currentWeightKg ? `${query.data.currentWeightKg} кг` : '—'}</strong></div>
        </section>
        <section className="client-home-routes" aria-label="Разделы кабинета">
          <Link className="client-home-route primary" to="/me/workouts"><span>Тренировки</span><small>Планы и история занятий</small><b aria-hidden="true">›</b></Link>
          <Link className="client-home-route" to="/me/progress"><span>Прогресс</span><small>Замеры и динамика</small><b aria-hidden="true">›</b></Link>
        </section>
        {actor && isWearablesPilotEnabled(actor.userId) && <WearableHealthCard />}
        <section className="client-home-connections"><div className="client-home-section-head"><div><p className="eyebrow">СВЯЗЬ С ТРЕНЕРОМ</p><h2>Тренеры</h2></div><button className="secondary" disabled={invite.isPending} onClick={() => invite.mutate(query.data!.id)}>Пригласить тренера</button></div>
        {invite.data && <div className="card"><div><strong>Код для тренера: {invite.data}</strong><p>Действует 7 дней и используется один раз.</p></div></div>}
        {invite.error && <p className="error">{invite.error.message}</p>}
          {trainers.isLoading && <p className="muted">Загрузка тренеров…</p>}
          {trainers.error && <div><p className="error">{trainers.error.message}</p><button className="secondary" onClick={() => void trainers.refetch()}>Повторить</button></div>}
          {trainers.data?.length === 0 && <p className="muted">Подключённых тренеров нет</p>}
          {trainers.data?.map((trainer) => <article className="card" key={trainer.trainerId}><div><strong>{[trainer.firstName, trainer.lastName].filter(Boolean).join(' ') || 'Тренер'}</strong><p>{trainer.isRoot ? 'Основной тренер' : 'Подключённый тренер'}</p></div>{!trainer.isRoot && <button className="link danger" disabled={removeTrainer.isPending} onClick={async () => { if (await confirm({ message: 'Отключить этого тренера? Он потеряет доступ к вашим тренировкам и прогрессу.', confirmLabel: 'Отключить', danger: true })) removeTrainer.mutate(trainer.trainerId) }}>Отключить</button>}</article>)}
        {invitations.isLoading && <p className="muted">Загрузка приглашений…</p>}
        {invitations.data && invitations.data.length > 0 && <div className="client-home-invitations"><h3>Активные приглашения</h3>{invitations.data.map((item) => <article className="card" key={item.id}><div><strong>Приглашение для тренера</strong><p>Действует до {new Date(item.expiresAt).toLocaleDateString('ru-RU')}</p></div><button className="link danger" disabled={revoke.isPending} onClick={async () => { if (await confirm({ message: 'Отозвать это приглашение? Код больше нельзя будет использовать.', confirmLabel: 'Отозвать', danger: true })) revoke.mutate(item.id) }}>Отозвать</button></article>)}</div>}
        {invitations.error && <div><p className="error">{invitations.error.message}</p><button className="secondary" onClick={() => void invitations.refetch()}>Повторить</button></div>}
        {(removeTrainer.error || revoke.error) && <p className="error">{(removeTrainer.error ?? revoke.error)?.message}</p>}
        </section>
        {confirmDialog}
      </div> : <div className="client-onboarding">
        <section className="client-onboarding-hero">
          <p className="eyebrow">ЛИЧНЫЙ ПРОФИЛЬ</p>
          <h2>Создайте личную карточку</h2>
          <p>Она нужна для самостоятельных тренировок и замеров. Тренера можно пригласить позже.</p>
        </section>
        <ClientForm
          createMode="self"
          initialFullName={[actor?.firstName, actor?.lastName].filter(Boolean).join(' ')}
          embedded
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['my-client'] })
            await refresh()
          }}
        />
      </div>}
    </AsyncView>
  </Page>
}

type ClientValues = z.input<typeof clientSchema>
type ClientProfileValues = ClientValues & { alias: string; privateNote: string }
const clientProfileSchema = clientSchema.extend({
  alias: z.string().max(120, 'Не больше 120 символов'),
  privateNote: z.string(),
})

export function ClientFormPage() {
  const { clientId } = useParams(); const navigate = useNavigate(); const queryClient = useQueryClient()
  useClientRealtime(clientId)
  const existing = useQuery({ queryKey: ['client', clientId], queryFn: () => clientsRepository.get(clientId ?? ''), enabled: Boolean(clientId) })
  if (clientId && (existing.isLoading || existing.error)) return <Page title="Карточка клиента"><AsyncView loading={existing.isLoading} error={existing.error} onRetry={() => void existing.refetch()} /></Page>
  if (clientId && existing.data) return <ClientForm existing={existing.data} onSaved={async () => {
    await queryClient.invalidateQueries({ queryKey: ['clients'] })
    await queryClient.invalidateQueries({ queryKey: ['client', clientId] })
    navigate(`/clients/${clientId}`)
  }} onCancel={() => navigate(-1)} />
  return <ClientForm onSaved={async (id) => { await queryClient.invalidateQueries({ queryKey: ['clients'] }); navigate(`/clients/${id}`) }} onCancel={() => navigate(-1)} />
}

export function MyClientEditPage() {
  const navigate = useNavigate(); const queryClient = useQueryClient()
  const { refresh } = useAuth()
  const query = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine() })
  useClientRealtime(query.data?.id)
  return <AsyncView loading={query.isLoading} error={query.error} empty={!query.data} onRetry={() => void query.refetch()}>
    {query.data && <ClientForm existing={query.data} createMode="self" onSaved={async () => {
      await queryClient.invalidateQueries({ queryKey: ['my-client'] })
      await refresh()
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
  const form = useForm<ClientProfileValues>({ resolver: zodResolver(clientProfileSchema), defaultValues: existing ? {
    fullName: existing.fullName, gender: existing.gender ?? undefined, ageYears: existing.ageYears ?? undefined, heightCm: existing.heightCm ?? undefined,
    goal: existing.goal ?? '', note: existing.note ?? '', alias: existing.fullName, privateNote: existing.note ?? '',
  } : { fullName: initialFullName, gender: undefined, ageYears: undefined, heightCm: undefined, alias: '', privateNote: '' } })
  const mutation = useMutation({ mutationFn: async (values: ClientProfileValues) => {
    const parsed = clientSchema.parse(values)
    if (existing) {
      const input = { id: existing.id, version: existing.version, fullName: parsed.fullName,
        gender: parsed.gender as Gender, ageYears: parsed.ageYears, ageUpdatedAt: existing.ageUpdatedAt ?? todayLocalDate(),
        heightCm: parsed.heightCm, goal: parsed.goal, note: parsed.note }
      if (createMode === 'self') await clientsRepository.updateOwn(input)
      else {
        await clientsRepository.update(input)
        const alias = values.alias.trim() === existing.fullName && existing.fullName === existing.canonicalFullName
          ? parsed.fullName : values.alias.trim()
        await clientsRepository.updatePreferences({ clientId: existing.id, alias, note: values.privateNote.trim() || undefined, version: existing.membershipVersion ?? 1 })
      }
      return existing.id
    }
    const input = { fullName: parsed.fullName, gender: parsed.gender as Gender,
      ageYears: parsed.ageYears, ageUpdatedAt: todayLocalDate(), heightCm: parsed.heightCm,
      goal: parsed.goal, note: parsed.note, initialWeightKg: parsed.initialWeightKg,
      initialWeightRecordedOn: todayLocalDate() }
    return createMode === 'self' ? clientsRepository.createOwn(input) : clientsRepository.create(input)
  }, onSuccess: (id) => void onSaved(id) })
  const contents = <form className="stack client-profile-form" onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate(values))(event)}>
      <section className="client-form-section">
        <div className="client-form-section-head">
          <p className="eyebrow">ПРОФИЛЬ СПОРТСМЕНА</p>
          <h2>Основные данные</h2>
          <p>Эти данные помогают вести тренировки и отслеживать прогресс.</p>
        </div>
        <Field label="Имя" error={form.formState.errors.fullName?.message}><input {...form.register('fullName')} /></Field>
        <Field label="Пол"><select {...form.register('gender')}><option value="">Выберите</option><option value="female">Женский</option><option value="male">Мужской</option></select></Field>
        <div className="split"><Field label="Возраст"><input type="number" {...form.register('ageYears')} /></Field><Field label="Рост, см"><input type="number" step="0.1" {...form.register('heightCm')} /></Field></div>
        {!existing && <Field label="Начальный вес, кг"><input type="number" step="0.1" {...form.register('initialWeightKg')} /></Field>}
        <Field label="Цель"><textarea {...form.register('goal')} /></Field>
        {createMode === 'trainer' && <Controller
          control={form.control}
          name="note"
          render={({ field }) => <VoiceNoteField name={field.name} source="client_form" label="Общий комментарий" value={field.value ?? ''} onValueChange={field.onChange} />}
        />}
      </section>
      {existing && createMode === 'trainer' && <section className="client-form-section client-display-settings">
        <div className="client-form-section-head">
          <p className="eyebrow">ТОЛЬКО ДЛЯ ТРЕНЕРА</p>
          <h2>Мои настройки отображения</h2>
          <p>Они видны только вам и не меняют профиль спортсмена.</p>
        </div>
        <Field label="Имя в моём списке" error={form.formState.errors.alias?.message}><input {...form.register('alias', { required: 'Введите имя', maxLength: { value: 120, message: 'Не больше 120 символов' } })} /></Field>
        <Controller control={form.control} name="privateNote" render={({ field }) => <VoiceNoteField name={field.name} source="client_form" label="Личная заметка" value={field.value ?? ''} onValueChange={field.onChange} />} />
      </section>}
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
    mutationFn: (patch: { goal?: string; note?: string }) => {
      if (!client.gender || !client.ageYears || !client.heightCm || !client.ageUpdatedAt) throw new Error('Сначала дополните профиль клиента')
      return clientsRepository.update({
        id: client.id, version: client.version, fullName: client.fullName, gender: client.gender,
        ageYears: client.ageYears, ageUpdatedAt: client.ageUpdatedAt, heightCm: client.heightCm,
        goal: (patch.goal ?? client.goal ?? '').trim() || undefined,
        note: (patch.note ?? client.note ?? '').trim() || undefined,
      })
    },
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
  const [confirm, confirmDialog] = useConfirm()
  return <Page title={query.data?.fullName ?? 'Клиент'} className="client-detail-page" back="/clients" action={query.data && <Link className="button secondary" to={`/clients/${clientId}/edit`}>Редактировать профиль</Link>}>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>{query.data && <>
      <section className="client-detail-overview"><p className="eyebrow">ПРОФИЛЬ СПОРТСМЕНА</p><p>{query.data.goal || 'Цель ещё не задана — добавьте её, чтобы держать фокус тренировок.'}</p></section>
      <section className="summary client-detail-summary"><div><span>Возраст</span><strong>{query.data.ageYears ?? '—'}</strong></div><div><span>Рост</span><strong>{query.data.heightCm ? `${query.data.heightCm} см` : '—'}</strong></div><div><span>Вес</span><strong>{query.data.currentWeightKg ? `${query.data.currentWeightKg} кг` : '—'}</strong></div></section>
      {stats.data && <>
        {stats.data.needsAttention && <p className="attention">⚠ Давно не тренировался</p>}
        <section className="summary stats stats-3 client-detail-stats">
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
        <Link className="button secondary wide" to={`/progress/${clientId}`}>Замеры и прогресс</Link>
      </div>
      <ClientGoalBlock client={query.data} />
      <ClientNoteBlock client={query.data} />
      {upcoming.length > 0 && <section><h2>Предстоит</h2><div className="cards">{upcoming.map((workout) => <Link className="card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}{workout.startTime ? ` · ${workout.startTime.slice(0, 5)}` : ''}</strong><WorkoutExercisesSummary workout={workout} />{workout.stageTitle && <p className="stage-tag">🎯 {workout.stageTitle}</p>}</div><span className={`badge ${workout.status}`}>{workout.status === 'in_progress' ? 'Идёт' : 'План'}</span></Link>)}</div></section>}
      <div className="page-actions">
        {query.data.hasAccount === false && <button className="secondary wide" disabled={invite.isPending} onClick={() => invite.mutate()}>Пригласить клиента</button>}
        {invite.data && <div className="card"><strong>Код клиента: {invite.data}</strong><p>Передайте код клиенту. Он действует 7 дней и используется один раз.</p></div>}
        {invitations.data?.map((item) => <article className="card" key={item.id}><div><strong>Активное приглашение клиента</strong><p>Действует до {new Date(item.expiresAt).toLocaleDateString('ru-RU')}</p></div><button className="link danger" disabled={revoke.isPending} onClick={async () => { if (await confirm({ message: 'Отозвать это приглашение? Код больше нельзя будет использовать.', confirmLabel: 'Отозвать', danger: true })) revoke.mutate(item.id) }}>Отозвать</button></article>)}
        {invite.error && <p className="error">{invite.error.message}</p>}
        {revoke.error && <p className="error">{revoke.error.message}</p>}
        {currentMembership && !currentMembership.isRoot && <button className="danger secondary wide" disabled={leave.isPending} onClick={async () => { if (await confirm({ message: 'Покинуть пространство клиента? Доступ к тренировкам и прогрессу будет закрыт.', confirmLabel: 'Покинуть', danger: true })) leave.mutate() }}>Покинуть пространство клиента</button>}
        {leave.error && <p className="error">{leave.error.message}</p>}
        {currentMembership?.isRoot && <button className="danger secondary wide" disabled={archive.isPending} onClick={() => archive.mutate(query.data!)}>{query.data.archivedAt ? 'Вернуть из архива' : 'Архивировать клиента'}</button>}
      </div>
      {confirmDialog}
    </>}</AsyncView>
  </Page>
}
