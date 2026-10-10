import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { bmiLabel, splitClientWorkouts } from '../../data/repositories/workouts.repository'
import { ClientFirstRunIntro, PresetWorkoutPicker, TodayPage, WorkoutExercisesSummary, storeFirstWorkoutIntent, workoutCountLabel, type FirstWorkoutIntent } from '../workouts'
import type { Client, Gender } from '../../shared/domain'
import { currentStage, daysToTarget, stageProgress } from '../../shared/goal-rules'
import { formatLocalDate, formatLocalDateShort, localDate, normalizeTimeZone, todayInTimeZone } from '../../shared/local-date'
import { AsyncView, Field, OverflowMenu, Page, useConfirm } from '../../shared/ui'
import { clientSchema } from '../../shared/validation'
import { VoiceInputButton, VoiceNoteField, type VoiceInputPhase } from '../voice-input'
import { z } from 'zod'
import { useClientRealtime } from '../../app/use-client-realtime'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { AnalyticsIcon, ChevronRightIcon, HistoryIcon, KeyboardIcon, RecordIcon, ScheduleIcon } from '../../shared/icons'
import { InvitationShareButton } from '../auth/InvitationShareActions'
import { ChatStartButton } from '../chat'
import { YandexAccountLinkingCard } from '../auth'
import { isRepositoryConflict } from '../../data/repositories/error'
import { isFitLimeEnabled } from '../../app/fit-lime'
import { isTrainerScheduleV2Enabled } from '../../app/trainer-schedule-v2'
import { isTrainerFinancePilotEnabled } from '../../app/feature-flags'
import { QuickStartWorkout } from '../workouts/QuickStartWorkout'
import { InBodyProgressCard } from '../progress'
import { NutritionSummary } from '../nutrition'
import { EMPTY_ATHLETE_SPORT_PROFILE, SPORT_INTEREST_GROUPS, type AthleteSportProfile } from '../../shared/sport-interests'

export function MyClientPage() {
  const { clients: clientsRepository, workouts: workoutsRepository } = useDataBackend()
  const { actor, refresh } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [voicePhase, setVoicePhase] = useState<VoiceInputPhase>('idle')
  const query = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine() })
  const quickStart = useMutation({
    mutationFn: async (intent: FirstWorkoutIntent) => {
      if (!actor) throw new Error('Профиль пользователя не найден')
      const fullName = [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim()
      await clientsRepository.createQuickOwn(fullName)
      storeFirstWorkoutIntent(actor.userId, intent)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['my-client'] })
      await refresh()
    },
  })
  const beginFirstLive = useMutation({
    mutationFn: async () => {
      if (!actor) throw new Error('Профиль пользователя не найден')
      const fullName = [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim()
      const clientId = await clientsRepository.createQuickOwn(fullName)
      const started = await workoutsRepository.quickStart(clientId)
      return started.id
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['my-client'] })
      await refresh()
      navigate(`/workouts/${id}/live`, { state: { returnTo: '/me' } })
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: ['my-client'] })
      await refresh()
    },
  })
  useClientRealtime(query.data?.id)
  if (query.data) return <TodayPage clientMode />
  return <Page title="Кабинет" className="client-home-page">
    {actor && <YandexAccountLinkingCard actor={actor} />}
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      <ClientFirstRunIntro actions={<section className="client-home-self-training primary">
        <section className="quick-start-workout"><div className="quick-start-copy"><h2>Начать тренировку</h2><p>Тренировка начнётся сразу. Упражнения добавите по ходу.</p></div><button type="button" className="quick-start-button" disabled={beginFirstLive.isPending} onClick={() => beginFirstLive.mutate()}>{beginFirstLive.isPending ? 'Начинаем…' : 'Начать тренировку'}</button>{beginFirstLive.error && <p role="alert">Не удалось начать тренировку. Повторите попытку.</p>}</section>
        <div className="today-voice-hero-compact compose-workout-entry">
          <VoiceInputButton
            variant="hero"
            source="today_workout"
            idleLabel="Надиктовать тренировку"
            heroTitle="Составить тренировку"
            heroSubtitle="Голосом или вручную"
            onPhaseChange={setVoicePhase}
            onTranscript={(transcript) => quickStart.mutateAsync({ mode: 'voice', transcript })}
            secondaryAction={voicePhase === 'idle' ? <button type="button" className="today-voice-text-inline" aria-label="Ввести текстом" disabled={quickStart.isPending} onClick={() => quickStart.mutate({ mode: 'text' })}><KeyboardIcon /></button> : undefined}
          />
        </div>
        {quickStart.error && <p className="error" role="alert">{quickStart.error.message}</p>}
        <PresetWorkoutPicker onSelect={(presetId) => quickStart.mutate({ mode: 'preset', presetId })} pending={quickStart.isPending} />
      </section>} />
    </AsyncView>
    <NutritionSummary />
  </Page>
}

type ClientValues = z.input<typeof clientSchema>
type ClientProfileValues = ClientValues & { alias: string; privateNote: string }
const clientProfileSchema = clientSchema.extend({
  alias: z.string().max(120, 'Не больше 120 символов'),
  privateNote: z.string(),
})

export function ClientFormPage() {
  const { clients: clientsRepository } = useDataBackend()
  const { actor } = useAuth()
  const { clientId } = useParams(); const navigate = useNavigate(); const queryClient = useQueryClient()
  const fitLimePilot = isFitLimeEnabled(actor) && isTrainerScheduleV2Enabled(actor)
  const cancel = () => fitLimePilot ? navigate(clientId ? `/clients/${clientId}` : '/clients') : navigate(-1)
  useClientRealtime(clientId)
  const existing = useQuery({ queryKey: ['client', clientId], queryFn: () => clientsRepository.get(clientId ?? ''), enabled: Boolean(clientId) })
  if (clientId && (existing.isLoading || existing.error)) return <Page title="Карточка клиента"><AsyncView loading={existing.isLoading} error={existing.error} onRetry={() => void existing.refetch()} /></Page>
  if (clientId && existing.data) return <ClientForm existing={existing.data} onSaved={async () => {
    await queryClient.invalidateQueries({ queryKey: ['clients'] })
    await queryClient.invalidateQueries({ queryKey: ['client', clientId] })
    navigate(`/clients/${clientId}`)
  }} onCancel={cancel} />
  return <ClientForm onSaved={async (id) => { await queryClient.invalidateQueries({ queryKey: ['clients'] }); navigate(`/clients/${id}`) }} onCancel={cancel} />
}

export function MyClientEditPage() {
  const { clients: clientsRepository, progress: progressRepository, athleteSportProfile } = useDataBackend()
  const navigate = useNavigate(); const queryClient = useQueryClient()
  const { actor, refresh } = useAuth()
  const query = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine() })
  const sportQuery = useQuery({ queryKey: ['my-sport-profile'], queryFn: () => athleteSportProfile.getMine() })
  useClientRealtime(query.data?.id)
  const initialFullName = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ').trim()
  // "Начальный вес" — не отдельная колонка, а первая запись в client_progress
  // (см. create_own_client). Для уже существующей карточки предлагаем это
  // поле только пока замеров ещё не было — иначе непонятно, что оно перезапишет.
  const progressEntries = useQuery({
    queryKey: ['progress', query.data?.id],
    queryFn: () => progressRepository.list(query.data!.id),
    enabled: Boolean(query.data),
  })
  const stillResolvingWeightEligibility = Boolean(query.data) && progressEntries.isLoading
  return <AsyncView loading={query.isLoading || sportQuery.isLoading || stillResolvingWeightEligibility} error={query.error ?? sportQuery.error} onRetry={() => { void query.refetch(); void sportQuery.refetch() }}>
    {!query.isLoading && !sportQuery.isLoading && !stillResolvingWeightEligibility && <ClientForm
      existing={query.data ?? undefined}
      initialSport={sportQuery.data ?? EMPTY_ATHLETE_SPORT_PROFILE}
      initialFullName={initialFullName}
      createMode="self"
      canRecordInitialWeight={Boolean(query.data) && (progressEntries.data?.length ?? 0) === 0}
      onSaved={async () => {
        await queryClient.invalidateQueries({ queryKey: ['my-client'] })
        await queryClient.invalidateQueries({ queryKey: ['my-sport-profile'] })
        await queryClient.invalidateQueries({ queryKey: ['progress', query.data?.id] })
        await refresh()
        navigate('/me')
      }}
      onCancel={() => navigate(query.data ? '/me/profile' : '/me')}
    />}
  </AsyncView>
}

function ClientForm({
  existing,
  initialSport,
  initialFullName,
  createMode = 'trainer',
  canRecordInitialWeight = false,
  embedded = false,
  onSaved,
  onCancel,
}: {
  existing?: Client
  initialSport?: AthleteSportProfile
  initialFullName?: string
  createMode?: 'trainer' | 'self'
  canRecordInitialWeight?: boolean
  embedded?: boolean
  onSaved: (id: string) => Promise<void>
  onCancel?: () => void
}) {
  const { clients: clientsRepository, athleteSportProfile } = useDataBackend()
  const { actor } = useAuth()
  const queryClient = useQueryClient()
  const today = todayInTimeZone(actor?.timezone)
  const fitLimeBack = createMode === 'trainer' && isFitLimeEnabled(actor) && isTrainerScheduleV2Enabled(actor)
    ? existing ? `/clients/${existing.id}` : '/clients'
    : undefined
  const showInitialWeight = !existing || canRecordInitialWeight
  const [selectedSports, setSelectedSports] = useState<string[]>(initialSport?.sports ?? [])
  const [sportSearch, setSportSearch] = useState('')
  const [sportBio, setSportBio] = useState(initialSport?.bio ?? '')
  const form = useForm<ClientProfileValues>({ resolver: zodResolver(clientProfileSchema), defaultValues: existing ? {
    fullName: existing.canonicalFullName, gender: existing.gender ?? undefined, ageYears: existing.ageYears ?? undefined, heightCm: existing.heightCm ?? undefined,
    goal: existing.goal ?? '', note: existing.note ?? '', alias: existing.fullName, privateNote: existing.note ?? '',
  } : { fullName: initialFullName, gender: undefined, ageYears: undefined, heightCm: undefined, alias: '', privateNote: '' } })
  const mutation = useMutation({ mutationFn: async (values: ClientProfileValues) => {
    const parsed = clientSchema.parse(values)
    if (existing) {
      const input = { id: existing.id, version: existing.version, fullName: parsed.fullName,
        gender: parsed.gender as Gender, ageYears: parsed.ageYears ?? null,
        ageUpdatedAt: parsed.ageYears === undefined ? null : existing.ageUpdatedAt ?? today,
        heightCm: parsed.heightCm ?? null, goal: parsed.goal, note: parsed.note }
      if (createMode === 'self') {
        await athleteSportProfile.saveOwn({ clientId: existing.id, expectedVersion: existing.version,
          client: { fullName: input.fullName, gender: input.gender, ageYears: input.ageYears,
            ageUpdatedAt: input.ageUpdatedAt, heightCm: input.heightCm, goal: input.goal,
            note: input.note, initialWeightKg: canRecordInitialWeight ? parsed.initialWeightKg : undefined,
            initialWeightRecordedOn: canRecordInitialWeight && parsed.initialWeightKg !== undefined ? today : undefined },
          sport: { sports: selectedSports, bio: sportBio.trim() || null } })
      }
      else {
        const alias = values.alias.trim() === existing.fullName && existing.fullName === existing.canonicalFullName
          ? parsed.fullName : values.alias.trim()
        const note = values.privateNote.trim() || undefined
        const profileChanged = parsed.fullName !== existing.canonicalFullName
          || (parsed.gender ?? null) !== existing.gender
          || (parsed.ageYears ?? null) !== existing.ageYears
          || (parsed.heightCm ?? null) !== existing.heightCm
          || (parsed.goal?.trim() || undefined) !== (existing.goal?.trim() || undefined)
          || (parsed.note?.trim() || undefined) !== (existing.note?.trim() || undefined)
        const preferencesChanged = alias !== existing.fullName
          || note !== (existing.note?.trim() || undefined)

        if (profileChanged) await clientsRepository.update(input)
        if (preferencesChanged) {
          await clientsRepository.updatePreferences({ clientId: existing.id, alias, note, version: existing.membershipVersion ?? 1 })
        }
      }
      return existing.id
    }
    const input = { fullName: parsed.fullName, gender: parsed.gender as Gender,
      ageYears: parsed.ageYears ?? null,
      ageUpdatedAt: parsed.ageYears === undefined ? null : today,
      heightCm: parsed.heightCm ?? null,
      goal: parsed.goal, note: parsed.note, initialWeightKg: parsed.initialWeightKg,
      initialWeightRecordedOn: parsed.initialWeightKg === undefined ? undefined : today }
    return createMode === 'self'
      ? athleteSportProfile.saveOwn({ clientId: null, expectedVersion: null, client: input,
        sport: { sports: selectedSports, bio: sportBio.trim() || null } })
      : clientsRepository.create(input)
  }, onSuccess: (id) => onSaved(id), onError: async (error) => {
    if (!existing || !isRepositoryConflict(error)) return
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
      queryClient.invalidateQueries({ queryKey: ['client', existing.id] }),
    ])
  } })
  const contents = <form className="stack client-profile-form" onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate(values))(event)}>
      <section className="client-form-section">
        <div className="client-form-section-head">
          <p className="eyebrow">ПРОФИЛЬ СПОРТСМЕНА</p>
          <h2>Основные данные</h2>
          <p>Эти данные помогают вести тренировки и отслеживать прогресс.</p>
        </div>
        <Field label="Имя" error={form.formState.errors.fullName?.message}><input {...form.register('fullName')} /></Field>
        <Field label="Пол"><select {...form.register('gender')}><option value="">Выберите</option><option value="female">Женский</option><option value="male">Мужской</option></select></Field>
        <div className="split"><Field label="Возраст"><input type="number" {...form.register('ageYears', { setValueAs: (value: unknown) => value === '' ? undefined : Number(value) })} /></Field><Field label="Рост, см"><input type="number" step="0.1" {...form.register('heightCm', { setValueAs: (value: unknown) => value === '' ? undefined : Number(value) })} /></Field></div>
        {showInitialWeight && <Field label="Начальный вес, кг" error={form.formState.errors.initialWeightKg?.message}><input type="number" step="0.1" {...form.register('initialWeightKg', { setValueAs: (value: unknown) => value === '' ? undefined : Number(value) })} /></Field>}
        <Field label="Цель"><textarea {...form.register('goal')} /></Field>
        {createMode === 'trainer' && <Controller
          control={form.control}
          name="note"
          render={({ field }) => <VoiceNoteField name={field.name} source="client_form" label="Общий комментарий" value={field.value ?? ''} onValueChange={field.onChange} />}
        />}
      </section>
      {createMode === 'self' && athleteSportProfile.supportsSportInterests && <section className="client-form-section athlete-sport-edit">
        <div className="client-form-section-head">
          <p className="eyebrow">ЛИЧНОЕ</p>
          <h2>Чем занимаюсь</h2>
          <p>Выберите любимые виды спорта. Пока они видны только вам.</p>
        </div>
        <Field label="Поиск по видам спорта"><input type="search" value={sportSearch} onChange={(event) => setSportSearch(event.target.value)} placeholder="Например, бег или йога" /></Field>
        {SPORT_INTEREST_GROUPS.map((group) => {
          const options = group.options.filter(([, label]) => label.toLowerCase().includes(sportSearch.trim().toLowerCase()))
          return options.length > 0 && <div className="athlete-sport-group" key={group.title}>
            <h3>{group.title}</h3>
            <div className="athlete-sport-options">{options.map(([id, label]) => <button key={id} type="button"
              className={selectedSports.includes(id) ? 'athlete-sport-option selected' : 'athlete-sport-option'}
              aria-pressed={selectedSports.includes(id)}
              onClick={() => setSelectedSports((current) => current.includes(id) ? current.filter((sport) => sport !== id) : [...current, id])}>{label}</button>)}</div>
          </div>
        })}
        {SPORT_INTEREST_GROUPS.every((group) => group.options.every(([, label]) => !label.toLowerCase().includes(sportSearch.trim().toLowerCase()))) && <p className="muted">Ничего не найдено</p>}
        <Field label="О себе в спорте"><textarea value={sportBio} maxLength={160} onChange={(event) => setSportBio(event.target.value)} placeholder="Пару слов о том, что вам нравится" /></Field>
        <p className="athlete-sport-count">{sportBio.length}/160</p>
      </section>}
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
      <div className="actions">{onCancel && <button type="button" className="secondary" disabled={mutation.isPending} onClick={onCancel}>Отмена</button>}<button className="primary" disabled={mutation.isPending} aria-busy={mutation.isPending}>{mutation.isPending ? 'Сохраняем…' : createMode === 'self' && !existing ? 'Сохранить профиль' : 'Сохранить'}</button></div>
    </form>
  const title = createMode === 'self' && !existing
    ? 'Профиль спортсмена'
    : existing ? createMode === 'self' ? 'Редактировать профиль' : 'Редактировать клиента' : 'Новый клиент'
  return embedded ? contents : <Page title={title} back={fitLimeBack} className={createMode === 'self' ? 'client-self-edit-page' : undefined}>{contents}</Page>
}

// update_client пишет goal и note одной транзакцией с optimistic-lock (version).
// Поэтому обе формы (цель / заметка) сохраняют через один хелпер и всегда
// передают текущее значение соседнего поля — чтобы правка одного не затирала другое.
function useSaveClient(client: Client, onDone: () => void) {
  const { clients: clientsRepository } = useDataBackend()
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
  const { goals: goalsRepository } = useDataBackend()
  const { actor } = useAuth()
  const goalQuery = useQuery({ queryKey: ['client-goal', client.id], queryFn: () => goalsRepository.get(client.id) })
  const [editingText, setEditingText] = useState(false)
  const form = useForm<{ goal: string }>({ defaultValues: { goal: client.goal ?? '' } })
  const mutation = useSaveClient(client, () => setEditingText(false))
  const startEditing = () => { form.reset({ goal: client.goal ?? '' }); setEditingText(true) }

  // Цель как сущность (client_goals) — приоритетна: заголовок + дата + текущий этап.
  const goal = goalQuery.data
  if (goal) {
    const today = todayInTimeZone(actor?.timezone)
    const days = daysToTarget(goal, today)
    const stage = currentStage(goal, today)
    const progress = stageProgress(goal, today)
    return <section className="goal-block">
      <div className="goal-head"><h2>Цель</h2><Link className="link" to={`/clients/${client.id}/goal`}><span>Открыть</span><ChevronRightIcon /></Link></div>
      <p className="goal-title">{goal.title}</p>
      {goal.targetDate && <p className="goal-deadline">До {formatLocalDateShort(localDate(goal.targetDate))}{days !== null ? ` · ${targetHint(days)}` : ''}</p>}
      {progress && progress.total > 0 && <p className="goal-stage-line">
        {stage ? <><span>Этап {progress.index} из {progress.total}</span><span className="goal-stage-title">«{stage.title}»</span></> : <span>{progress.total} {progress.total === 1 ? 'этап' : 'этапа'}, между периодами</span>}
      </p>}
    </section>
  }

  // Легаси-текст цели (clients.goal): показываем + inline-правку, предлагаем оформить.
  if (editingText) return <section className="goal-block">
    <form className="stack" onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate({ goal: values.goal }))(event)}>
      <Field label="Цель"><textarea rows={3} placeholder="Например: похудеть к отпуску, −8 кг" {...form.register('goal')} /></Field>
      {mutation.error && <p className="error">{mutation.error.message}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={() => setEditingText(false)}>Отмена</button><button className="primary" disabled={mutation.isPending}>Сохранить</button></div>
    </form>
  </section>
  return <section className="goal-block">
    <div className="goal-head"><h2>Цель</h2><button type="button" className="link" onClick={startEditing}>{client.goal ? 'Изменить' : '＋ Добавить'}</button></div>
    {client.goal ? <p>{client.goal}</p> : <p className="muted">Цель пока не задана</p>}
    {/* Периодизация: оформить цель с датой и этапами (Заход 2). */}
    <Link className="goal-stages-hint" to={`/clients/${client.id}/goal`}>
      <div><strong>Разбить путь на этапы</strong><p>Периоды с датами: набор, сушка, поддержка — со сроком к цели</p></div>
      <span className="button secondary">Добавить этапы</span>
    </Link>
  </section>
}

function ClientNoteBlock({ client }: { client: Client }) {
  const [editing, setEditing] = useState(false)
  const form = useForm<{ note: string }>({ defaultValues: { note: client.note ?? '' } })
  const mutation = useSaveClient(client, () => setEditing(false))
  const startEditing = () => { form.reset({ note: client.note ?? '' }); setEditing(true) }
  if (editing) return <section className="goal-block client-note-block">
    <form className="stack" onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate({ note: values.note }))(event)}>
      <Controller control={form.control} name="note" render={({ field }) =>
        <VoiceNoteField name={field.name} source="client_form" label="Заметка" value={field.value} onValueChange={field.onChange} />
      } />
      {mutation.error && <p className="error">{mutation.error.message}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={() => setEditing(false)}>Отмена</button><button className="primary" disabled={mutation.isPending}>Сохранить</button></div>
    </form>
  </section>
  return <section className="goal-block client-note-block">
    <div className="goal-head"><h2>Заметка</h2><button type="button" className="link" onClick={startEditing}>{client.note ? 'Изменить' : '＋ Добавить'}</button></div>
    {client.note ? <p>{client.note}</p> : <p className="muted">Заметок пока нет</p>}
  </section>
}

function ClientDetailSourceState({ label, loading, error, onRetry }: {
  label: string; loading: boolean; error: unknown; onRetry: () => void
}) {
  if (error) return <div className="client-detail-source-state is-error" role="alert">
    <span>Не удалось загрузить {label}</span>
    <button type="button" className="secondary" onClick={onRetry}>Повторить</button>
  </div>
  if (loading) return <p className="client-detail-source-state" role="status">Загружаем {label}…</p>
  return null
}

export function ClientDetailPage() {
  const {
    clients: clientsRepository,
    invitations: invitationsRepository,
    workouts: workoutsRepository,
    progress: progressRepository,
  } = useDataBackend()
  const { clientId = '' } = useParams(); const queryClient = useQueryClient()
  const { actor } = useAuth(); const navigate = useNavigate()
  const fitLimePilot = isFitLimeEnabled(actor) && isTrainerScheduleV2Enabled(actor)
  const financePilot = actor?.role === 'trainer' && isTrainerFinancePilotEnabled(actor.userId)
  const today = todayInTimeZone(actor?.timezone)
  useClientRealtime(clientId)
  const query = useQuery({ queryKey: ['client', clientId], queryFn: () => clientsRepository.get(clientId) })
  useEffect(() => {
    if (query.data?.id && query.data.id !== clientId) navigate(`/clients/${query.data.id}`, { replace: true })
  }, [clientId, navigate, query.data?.id])
  const stats = useQuery({ queryKey: ['client-stats', clientId, today], queryFn: () => workoutsRepository.clientStats(clientId, today) })
  const workouts = useQuery({ queryKey: ['workouts', clientId, 'upcoming'], queryFn: () => workoutsRepository.list(undefined, undefined, clientId) })
  const progress = useQuery({ queryKey: ['progress', clientId], queryFn: () => progressRepository.list(clientId) })
  const upcoming = workouts.data ? splitClientWorkouts(workouts.data, today).upcoming : []
  const archive = useMutation({ mutationFn: (client: Client) => clientsRepository.setArchived(client, !client.archivedAt), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['clients'] }); await query.refetch() } })
  const invitations = useQuery({ queryKey: ['client-invitations', clientId], queryFn: () => invitationsRepository.list(clientId) })
  const revoke = useMutation({ mutationFn: (invitationId: string) => invitationsRepository.revoke(invitationId), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-invitations', clientId] }) })
  const trainers = useQuery({ queryKey: ['client-trainers', clientId], queryFn: () => invitationsRepository.listTrainers(clientId) })
  const currentMembership = trainers.data?.find((trainer) => trainer.trainerId === actor?.userId)
  const leave = useMutation({ mutationFn: () => invitationsRepository.leave(clientId), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['clients'] }); navigate('/clients') } })
  const [confirm, confirmDialog] = useConfirm()
  const changeArchive = async (client: Client) => {
    if (fitLimePilot && !client.archivedAt && !await confirm({ message: `Переместить карточку «${client.fullName}» в архив? Её можно восстановить позже.`, confirmLabel: 'В архив', danger: true })) return
    archive.mutate(client)
  }
  return <Page title={query.data?.fullName ?? 'Клиент'} className="client-detail-page" back="/clients" action={query.data && <OverflowMenu label="Действия с профилем спортсмена" items={[
    { label: 'Редактировать профиль', onClick: () => navigate(`/clients/${clientId}/edit`) },
  ]} />}>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>{query.data && <>
      <section className="client-detail-snapshot" aria-label="Сводка по спортсмену">
        <p className="client-detail-vitals">
          <span><span className="sr-only">Возраст: </span>{query.data.ageYears ? `${query.data.ageYears} лет` : 'Возраст не указан'}</span>
          <span><span className="sr-only">Рост: </span>{query.data.heightCm ? `${query.data.heightCm} см` : 'Рост не указан'}</span>
          <span><span className="sr-only">Вес: </span>{query.data.currentWeightKg ? `${query.data.currentWeightKg.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} кг` : 'Вес не указан'}</span>
          <span>ИМТ {bmiLabel(query.data.heightCm, query.data.currentWeightKg).replace('.', ',')}</span>
        </p>
        {fitLimePilot && <ClientDetailSourceState label="статистику тренировок" loading={stats.isLoading} error={stats.error} onRetry={() => void stats.refetch()} />}
        {stats.data && <div className="client-detail-activity">
          <p><strong>{workoutCountLabel(stats.data.doneCount)}</strong><span>проведено за всё время</span></p>
          <p>{stats.data.completionPercent === null
            ? <><strong>Нет данных</strong><span>о выполнении тренировок</span></>
            : <><strong>{stats.data.completionPercent}%</strong><span>прошедших тренировок выполнено</span></>}</p>
        </div>}
      </section>
      {progress.data && <InBodyProgressCard entries={progress.data} compact />}
      <ClientDetailSourceState label="данные InBody" loading={progress.isLoading} error={progress.error} onRetry={() => void progress.refetch()} />
      {stats.data?.needsAttention && <p className="attention">Давно не тренировался</p>}
      <div className="client-detail-actions">
        {query.data.hasAccount && actor?.role === 'trainer' && <ChatStartButton clientId={clientId} trainerId={actor.userId} className="secondary wide client-detail-message" />}
        {actor?.role === 'trainer' && !query.data.archivedAt && <QuickStartWorkout role="trainer" clientId={clientId} workouts={workouts.data} loading={workouts.isLoading} error={workouts.error} onRetry={() => void workouts.refetch()} returnTo={`/clients/${clientId}`} compact />}
        <Link className="client-detail-plan" to={`/workouts/new?client=${clientId}`}>
          <ScheduleIcon />
          <span>Запланировать тренировку</span>
          <ChevronRightIcon className="client-detail-chevron" />
        </Link>
        <nav className="client-detail-routes" aria-label="Разделы спортсмена">
          <Link to={`/clients/${clientId}/workouts`}><HistoryIcon /><span>История тренировок</span></Link>
          <Link to={`/progress/${clientId}`}><AnalyticsIcon /><span>Прогресс и замеры</span></Link>
          {financePilot && <Link to={`/clients/${clientId}/finance`}><RecordIcon /><span>Абонементы и оплаты</span></Link>}
        </nav>
      </div>
      <ClientGoalBlock client={query.data} />
      {query.data.hasAccount && !query.data.archivedAt && <NutritionSummary clientId={clientId} />}
      {fitLimePilot && <ClientDetailSourceState label="ближайшие тренировки" loading={workouts.isLoading} error={workouts.error} onRetry={() => void workouts.refetch()} />}
      {upcoming.length > 0 && <section className="client-detail-upcoming"><h2>Предстоит</h2><div className="cards">{upcoming.map((workout) => <Link className="card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}{workout.startTime ? ` · ${workout.startTime.slice(0, 5)}` : ''}</strong><WorkoutExercisesSummary workout={workout} />{workout.stageTitle && <p className="stage-tag">🎯 {workout.stageTitle}</p>}</div><span className={`badge ${workout.status}`}>{workout.status === 'in_progress' ? 'Идёт' : 'План'}</span></Link>)}</div></section>}
      {fitLimePilot && workouts.isSuccess && upcoming.length === 0 && <p className="client-detail-source-state">Ближайших тренировок нет</p>}
      <ClientNoteBlock client={query.data} />
      <div className="page-actions">
        {fitLimePilot && <ClientDetailSourceState label="приглашения и права доступа" loading={invitations.isLoading || trainers.isLoading} error={invitations.error ?? trainers.error} onRetry={() => { void invitations.refetch(); void trainers.refetch() }} />}
        {query.data.hasAccount === false && <InvitationShareButton clientId={clientId} targetRole="client" label="Пригласить клиента" className="secondary wide" />}
        {invitations.data?.map((item) => <article className="card" key={item.id}><div><strong>Активное приглашение клиента</strong><p>Действует до {new Date(item.expiresAt).toLocaleDateString('ru-RU', { timeZone: normalizeTimeZone(actor?.timezone) })}</p></div><button className="link danger" disabled={revoke.isPending} aria-busy={revoke.isPending} onClick={async () => { if (await confirm({ message: 'Отозвать это приглашение? Ссылка, QR-код и код больше не будут работать.', confirmLabel: 'Отозвать', danger: true })) revoke.mutate(item.id) }}>{revoke.isPending ? 'Отзываем…' : 'Отозвать'}</button></article>)}
        {revoke.error && <p className="error">{revoke.error.message}</p>}
        {currentMembership && !currentMembership.isRoot && <button className="danger secondary wide" disabled={leave.isPending} aria-busy={leave.isPending} onClick={async () => { if (await confirm({ message: 'Покинуть пространство клиента? Доступ к тренировкам и прогрессу будет закрыт.', confirmLabel: 'Покинуть', danger: true })) leave.mutate() }}>{leave.isPending ? 'Покидаем пространство…' : 'Покинуть пространство клиента'}</button>}
        {leave.error && <p className="error">{leave.error.message}</p>}
        {currentMembership?.isRoot && <button className="danger secondary wide" disabled={archive.isPending} aria-busy={archive.isPending} onClick={() => void changeArchive(query.data!)}>{archive.isPending ? 'Обновляем…' : query.data.archivedAt ? 'Вернуть из архива' : 'Архивировать клиента'}</button>}
        {fitLimePilot && archive.error && <p className="client-detail-source-state is-error" role="alert">Не удалось обновить архив. Повторите действие.</p>}
        {fitLimePilot && archive.isSuccess && <p className="client-detail-source-state" role="status">Изменение архива сохранено</p>}
      </div>
      {confirmDialog}
    </>}</AsyncView>
  </Page>
}
