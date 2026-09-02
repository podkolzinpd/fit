import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { exercisesRepository } from '../../data/repositories/exercises.repository'
import { goalsRepository } from '../../data/repositories/goals.repository'
import { progressRepository } from '../../data/repositories/progress.repository'
import type { Client, ClientGoal, CustomMetric, ExerciseSnapshot, GoalCriterionMetric, GoalCriterionOperation, GoalStage, SaveGoalCriterionInput } from '../../shared/domain'
import { GOAL_CRITERION_METRICS, GOAL_CRITERION_OPERATIONS, goalCriterionTargetLabel, validateGoalCriterionInput } from '../../shared/goal-criterion-rules'
import { orderedStages, stageStatus } from '../../shared/goal-rules'
import { GOAL_STAGE_TITLE_MAX_LENGTH, GOAL_TITLE_MAX_LENGTH, titleLengthValidation } from '../../shared/goal-title-limits'
import { formatLocalDateShort, localDate, todayInTimeZone } from '../../shared/local-date'
import { AsyncView, Field, Page, Switch, useConfirm } from '../../shared/ui'
import { useExerciseCatalog } from '../exercises'
import { MetricsManager } from '../progress/MetricsManager'

const STATUS_LABEL: Record<string, string> = { done: 'завершён', current: 'идёт', upcoming: 'впереди' }

function confirmedCriteriaLabel(count: number): string {
  if (count === 1) return 'Критерий подтверждён'
  if (count >= 2 && count <= 4) return `${count} критерия подтверждены`
  return `${count} критериев подтверждено`
}

export function GoalPage() {
  const { clientId = '' } = useParams()
  const client = useQuery({ queryKey: ['client', clientId], queryFn: () => clientsRepository.get(clientId) })
  return <GoalWorkspace client={client.data} loading={client.isLoading} error={client.error}
    onRetry={() => void client.refetch()} back={`/clients/${clientId}`} />
}

export function MyGoalPage() {
  const mine = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine() })
  return <GoalWorkspace client={mine.data} loading={mine.isLoading} error={mine.error}
    onRetry={() => void mine.refetch()} back="/me/progress" self />
}

function GoalWorkspace({ client, loading, error, onRetry, back, self = false }: {
  client: Client | null | undefined
  loading: boolean
  error: Error | null
  onRetry: () => void
  back: string
  self?: boolean
}) {
  const { actor } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const clientId = client?.id ?? ''
  const goalQuery = useQuery({ queryKey: ['client-goal', clientId], queryFn: () => goalsRepository.get(clientId), enabled: Boolean(clientId) })
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['client-goal', clientId] })
    await queryClient.invalidateQueries({ queryKey: ['clients'] })
    await queryClient.invalidateQueries({ queryKey: ['my-client'] })
  }
  const today = todayInTimeZone(actor?.timezone)
  return <Page title={self ? 'Моя цель' : client?.fullName ?? 'Цель'} back={back} center>
    <AsyncView loading={loading || goalQuery.isLoading} error={error ?? goalQuery.error} empty={!loading && !client}
      onRetry={() => { onRetry(); void goalQuery.refetch() }}
      emptyTitle="Личная карточка не найдена" emptyDescription="Сначала создайте карточку, чтобы настроить цель.">
      {client && (goalQuery.data
        ? <GoalDetail goal={goalQuery.data} today={today} onChanged={invalidate}
            onArchived={async () => { await invalidate(); navigate(self ? '/me/progress' : `/clients/${clientId}`) }} />
        : <GoalCreate clientId={clientId} initialTitle={client.goal ?? ''}
            onCreated={invalidate} />
      )}
    </AsyncView>
  </Page>
}

type GoalFormValues = { title: string; targetDate: string }

function numberOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null
}

function localizedNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return Number.NaN
  const parsed = Number(value.trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function blankCriterion(position: number): SaveGoalCriterionInput {
  return { metric: 'weight', operation: 'track_only', targetValue: null, rangeMin: null, rangeMax: null, unit: 'кг', confirmationStatus: 'confirmed', position }
}

function CriterionEditor({ value, exercises, metrics, onChange, onRemove, onManageMetrics }: {
  value: SaveGoalCriterionInput; exercises: readonly ExerciseSnapshot[]; metrics: readonly CustomMetric[]
  onChange: (value: SaveGoalCriterionInput) => void; onRemove: () => void; onManageMetrics: () => void
}) {
  const definition = GOAL_CRITERION_METRICS[value.metric]
  const set = (patch: Partial<SaveGoalCriterionInput>) => onChange({ ...value, ...patch })
  const changeMetric = (metric: GoalCriterionMetric) => {
    const next = GOAL_CRITERION_METRICS[metric]
    onChange({ metric, operation: 'track_only', targetValue: null, rangeMin: null, rangeMax: null, unit: metric === 'exercise_best_result' ? 'кг' : next.unit,
      confirmationStatus: 'confirmed', position: value.position, regularityPeriod: metric === 'workout_regularity' ? 'week' : null,
      regularityMode: metric === 'workout_regularity' ? 'average' : null })
  }
  const availableExercises = definition.family === 'cardio'
    ? exercises.filter((exercise) => exercise.inputKind === 'distance' || exercise.inputKind === 'duration') : exercises
  return <section className="goal-criterion-item">
    <div className="goal-head"><strong>Критерий {(value.position ?? 0) + 1}</strong><button type="button" className="link danger" onClick={onRemove}>Удалить</button></div>
    <Field label="Показатель"><select value={value.metric} onChange={(event) => changeMetric(event.target.value as GoalCriterionMetric)}>{Object.entries(GOAL_CRITERION_METRICS).map(([metric, item]) => <option value={metric} key={metric}>{item.label}</option>)}</select></Field>
    {(definition.family === 'exercise' || definition.family === 'cardio') && <Field label="Упражнение"><select value={value.exerciseRef ?? ''} onChange={(event) => {
      const exercise = exercises.find((item) => item.ref === event.target.value)
      set(exercise ? { exerciseSource: exercise.source, exerciseRef: exercise.ref, exerciseName: exercise.name, customExerciseId: exercise.customExerciseId ?? null } : { exerciseSource: null, exerciseRef: null, exerciseName: null, customExerciseId: null })
    }}><option value="">Выберите из каталога</option>{availableExercises.map((exercise) => <option value={exercise.ref} key={`${exercise.source}:${exercise.ref}`}>{exercise.name}</option>)}</select></Field>}
    {definition.family === 'custom' && <div className="goal-custom-metric-field"><Field label="Показатель клиента"><select value={value.customMetricId ?? ''} onChange={(event) => {
      const metric = metrics.find((item) => item.id === event.target.value)
      set(metric ? { customMetricId: metric.id, customMetricName: metric.name, unit: metric.unit ?? 'ед.' } : { customMetricId: null, customMetricName: null })
    }}><option value="">Выберите показатель</option>{metrics.filter((metric) => !metric.archivedAt).map((metric) => <option value={metric.id} key={metric.id}>{metric.name}{metric.unit ? `, ${metric.unit}` : ''}</option>)}</select></Field><button type="button" className="link" onClick={onManageMetrics}>＋ Создать показатель</button></div>}
    {definition.family === 'regularity' && <div className="split"><Field label="Период"><select value={value.regularityPeriod ?? 'week'} onChange={(event) => set({ regularityPeriod: event.target.value as 'week' | 'month' })}><option value="week">Неделя</option><option value="month">Месяц</option></select></Field><Field label="Проверка"><select value={value.regularityMode ?? 'average'} onChange={(event) => set({ regularityMode: event.target.value as 'average' | 'each_period' })}><option value="average">В среднем</option><option value="each_period">В каждом периоде</option></select></Field></div>}
    {value.metric === 'exercise_best_result' && <Field label="Единица результата"><select value={value.unit} onChange={(event) => set({ unit: event.target.value })}><option value="кг">кг</option><option value="повт.">повт.</option><option value="км">км</option><option value="мин">мин</option><option value="кг·повт.">кг·повт.</option></select></Field>}
    <Field label="Способ оценки"><select value={value.operation} onChange={(event) => set({ operation: event.target.value as GoalCriterionOperation, targetValue: null, rangeMin: null, rangeMax: null })}>{Object.entries(GOAL_CRITERION_OPERATIONS).filter(([operation]) => operation !== 'change_by' || definition.family === 'standard').map(([operation, label]) => <option value={operation} key={operation}>{label}</option>)}</select></Field>
    {value.operation === 'maintain_range' && <div className="split"><Field label={`Минимум, ${value.unit}`}><input inputMode="decimal" value={value.rangeMin ?? ''} onChange={(event) => set({ rangeMin: numberOrNull(localizedNumber(event.target.value)) })} /></Field><Field label={`Максимум, ${value.unit}`}><input inputMode="decimal" value={value.rangeMax ?? ''} onChange={(event) => set({ rangeMax: numberOrNull(localizedNumber(event.target.value)) })} /></Field></div>}
    {value.operation !== 'maintain_range' && value.operation !== 'track_only' && <Field label={`${value.operation === 'change_by' ? 'Изменение' : 'Значение'}, ${value.unit}`}><input inputMode="decimal" value={value.targetValue ?? ''} onChange={(event) => set({ targetValue: numberOrNull(localizedNumber(event.target.value)) })} /></Field>}
    {value.metric === 'cardio_distance_time' && <Field label="Время, мин"><input inputMode="decimal" value={value.secondaryTargetValue ?? ''} onChange={(event) => set({ secondaryTargetValue: numberOrNull(localizedNumber(event.target.value)), secondaryUnit: 'мин' })} /></Field>}
  </section>
}

function GoalForm({ clientId, goal, initialTitle, onSaved, onCancel }: {
  clientId: string
  goal?: ClientGoal
  initialTitle?: string
  onSaved: () => Promise<void>
  onCancel?: () => void
}) {
  const titleCounterId = useId()
  const catalog = useExerciseCatalog()
  const queryClient = useQueryClient()
  const metrics = useQuery({ queryKey: ['progress-metrics', clientId], queryFn: () => progressRepository.listMetrics(clientId) })
  const existingCriteria = goal?.criteria ?? []
  const [criterionEnabled, setCriterionEnabled] = useState(existingCriteria.length > 0)
  const [criteria, setCriteria] = useState<SaveGoalCriterionInput[]>(existingCriteria.map((criterion) => ({ ...criterion, confirmationStatus: 'confirmed' })))
  const [criterionReviewed, setCriterionReviewed] = useState(false)
  const [suggestionPending, setSuggestionPending] = useState(false)
  const [suggestionMessage, setSuggestionMessage] = useState<string | null>(null)
  const [metricsOpen, setMetricsOpen] = useState(false)
  const createMetric = useMutation({ mutationFn: ({ name, unit }: { name: string; unit: string | null }) => progressRepository.createMetric(clientId, name, unit), onSuccess: async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['progress-metrics', clientId] }),
    queryClient.invalidateQueries({ queryKey: ['metrics', clientId] }),
  ]) })
  const archiveMetric = useMutation({ mutationFn: (metric: CustomMetric) => progressRepository.setMetricArchived(metric, !metric.archivedAt), onSuccess: async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['progress-metrics', clientId] }),
    queryClient.invalidateQueries({ queryKey: ['metrics', clientId] }),
  ]) })
  const defaults: GoalFormValues = {
    title: goal?.title ?? initialTitle ?? '',
    targetDate: goal?.targetDate ?? '',
  }
  const form = useForm<GoalFormValues>({ defaultValues: defaults })
  const titleValue = useWatch({ control: form.control, name: 'title' })
  const title = titleValue.trim()
  const criterionNeedsReview = Boolean(existingCriteria.some((criterion) => criterion.confirmationStatus !== 'confirmed') || (existingCriteria.length && title !== goal?.title))
  const suggestion = useMutation({
    mutationFn: async () => {
      const result = await exercisesRepository.suggestGoalCriteria(title, catalog.exercises, metrics.data ?? [])
      if (result.unsupportedReason) throw new Error(result.unsupportedReason)
      if (result.needsInput.length) throw new Error(result.needsInput.map((item) => item.message).join(' '))
      if (!result.criteria.length) throw new Error('Модель не предложила измеримый критерий. Настройте его вручную.')
      return result.criteria
    },
    onSuccess: (suggested) => { setCriteria(suggested); setCriterionEnabled(true); setSuggestionPending(true); setCriterionReviewed(false); setSuggestionMessage('Проверьте каждый критерий и подтвердите его перед сохранением.') },
  })
  const mutation = useMutation({
    mutationFn: (values: GoalFormValues) => {
      const submitted = criterionEnabled ? criteria.map((criterion, position) => ({ ...criterion, position })) : []
      if (suggestionPending && !criterionReviewed) throw new Error('Подтвердите предложенные критерии')
      for (const criterion of submitted) {
        const issue = validateGoalCriterionInput(criterion)
        if (issue) throw new Error(issue)
      }
      return goalsRepository.save({
        clientId, id: goal?.id, version: goal?.version,
        title: values.title.trim(), targetDate: values.targetDate ? localDate(values.targetDate) : null,
        criteria: criterionNeedsReview && !criterionReviewed ? undefined : submitted,
      })
    },
    onSuccess: () => void onSaved(),
  })
  const submitLabel = goal ? 'Сохранить' : 'Создать цель'
  return <form className={`stack${goal ? ' goal-block' : ''}`} onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate(values))(event)}>
    {!goal && <p className="muted">Оформите цель с датой и при желании настройте измеримый критерий.</p>}
    <Field label="Цель" error={form.formState.errors.title?.message}>
      <textarea rows={2} placeholder="Например: держать вес 59 кг"
        maxLength={GOAL_TITLE_MAX_LENGTH} aria-label="Цель" aria-describedby={titleCounterId}
        {...form.register('title', {
          required: 'Введите цель',
          validate: (value) => titleLengthValidation(value, 'Цель', GOAL_TITLE_MAX_LENGTH),
        })} />
      <small id={titleCounterId} className="goal-title-counter">{titleValue.length}/{GOAL_TITLE_MAX_LENGTH}</small>
    </Field>
    <Field label="Дата достижения"><input type="date" {...form.register('targetDate')} /></Field>
    <section className="goal-criterion-form">
      <div className="goal-criterion-form-head">
        <div><h2 id="goal-criterion-form-title">Как оценивать цель</h2><p>Настройка необязательна и работает без ИИ.</p></div>
        <Switch label="Автоматическая оценка" checked={criterionEnabled} onChange={(enabled) => {
          setCriterionEnabled(enabled)
          if (enabled && criteria.length === 0) setCriteria([blankCriterion(0)])
        }} disabled={mutation.isPending} />
      </div>
      {criterionEnabled ? <div className="goal-criterion-fields">
        <button type="button" className="secondary" disabled={!title || suggestion.isPending || catalog.loading || metrics.isLoading} onClick={() => suggestion.mutate()}>{suggestion.isPending ? 'Анализируем…' : 'Предложить критерии с ИИ'}</button>
        {(suggestion.error || suggestionMessage) && <p className={suggestion.error ? 'error' : 'muted'} role={suggestion.error ? 'alert' : undefined}>{suggestion.error?.message ?? suggestionMessage}</p>}
        {criteria.map((criterion, index) => <CriterionEditor key={criterion.id ?? `new-${index}`} value={criterion} exercises={catalog.exercises} metrics={metrics.data ?? []} onChange={(next) => setCriteria((current) => current.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => setCriteria((current) => current.filter((_, itemIndex) => itemIndex !== index).map((item, position) => ({ ...item, position })))} onManageMetrics={() => setMetricsOpen(true)} />)}
        {metricsOpen && <MetricsManager metrics={metrics.data ?? []} busy={createMetric.isPending || archiveMetric.isPending} error={createMetric.error ?? archiveMetric.error} onCreate={(name, unit) => createMetric.mutate({ name, unit })} onArchive={(metric) => archiveMetric.mutate(metric)} />}
        {criteria.length < 10 && <button type="button" className="secondary" onClick={() => setCriteria((current) => [...current, blankCriterion(current.length)])}>＋ Добавить критерий</button>}
        {(criterionNeedsReview || suggestionPending) && <label className="goal-criterion-confirm"><input type="checkbox" checked={criterionReviewed}
          onChange={(event) => setCriterionReviewed(event.currentTarget.checked)} />
          <span>Я проверил(а), что все критерии подходят к формулировке цели<small>ИИ только предлагает настройку. Progress рассчитывается обычным кодом.</small></span></label>}
        <p className="muted goal-criterion-hint">Progress рассчитает текущее положение, динамику периода и актуальность данных обычным кодом — без ИИ.</p>
      </div> : <p className="muted">Цель сохранится как текст без автоматической оценки.</p>}
    </section>
    {mutation.error && <p className="error" role="alert">{mutation.error.message}</p>}
    <div className="actions">{onCancel && <button type="button" className="secondary" disabled={mutation.isPending} onClick={onCancel}>Отмена</button>}<button className="primary" disabled={mutation.isPending} aria-busy={mutation.isPending}>{mutation.isPending ? 'Сохраняем…' : submitLabel}</button></div>
  </form>
}

function GoalCreate({ clientId, initialTitle, onCreated }: {
  clientId: string; initialTitle: string; onCreated: () => Promise<void>
}) {
  return <GoalForm clientId={clientId} initialTitle={initialTitle} onSaved={onCreated} />
}

function GoalDetail({ goal, today, onChanged, onArchived }: {
  goal: ClientGoal; today: string; onChanged: () => Promise<void>; onArchived: () => Promise<void>
}) {
  const [editingGoal, setEditingGoal] = useState(false)
  const [addingStage, setAddingStage] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const archive = useMutation({
    mutationFn: () => goalsRepository.archive(goal.id, goal.version),
    onSuccess: () => void onArchived(),
  })
  const stages = orderedStages(goal)
  const criteria = goal.criteria
  return <div className="stack">
    {editingGoal
      ? <GoalForm clientId={goal.clientId} goal={goal} onSaved={async () => { await onChanged(); setEditingGoal(false) }} onCancel={() => setEditingGoal(false)} />
      : <section className="goal-block">
          <div className="goal-head"><h2>{goal.title}</h2><button type="button" className="link" onClick={() => setEditingGoal(true)}>Изменить</button></div>
          {goal.targetDate && <p className="muted">До {formatLocalDateShort(localDate(goal.targetDate))}</p>}
        </section>}

    {!editingGoal && <section className="goal-block goal-criterion-summary">
      <div className="goal-head"><h2>Как оценивается цель</h2><button type="button" className="link" onClick={() => setEditingGoal(true)}>{criteria.length ? 'Изменить' : 'Настроить'}</button></div>
      {criteria.length ? <>{criteria.map((criterion) => <p key={criterion.id}><strong>{GOAL_CRITERION_METRICS[criterion.metric].label}</strong> · {goalCriterionTargetLabel(criterion)}{criterion.exerciseName ? ` · ${criterion.exerciseName}` : ''}{criterion.customMetricName ? ` · ${criterion.customMetricName}` : ''}</p>)}
        <p className="muted">{criteria.every((criterion) => criterion.confirmationStatus === 'confirmed')
          ? confirmedCriteriaLabel(criteria.length)
          : 'После изменения цели критерии нужно подтвердить заново'}</p></>
        : <p className="muted">Автоматическая оценка не настроена. Цель сохранена как текст.</p>}
    </section>}

    <section className="goal-block">
      <div className="goal-head"><h2>Этапы</h2>{!addingStage && <button type="button" className="link" onClick={() => setAddingStage(true)}>＋ Добавить</button>}</div>
      {stages.length === 0 && !addingStage && <p className="muted">Этапов пока нет</p>}
      <div className="stage-list">
        {stages.map((stage) => <StageRow key={stage.id} stage={stage} today={today} targetDate={goal.targetDate} onChanged={onChanged} />)}
      </div>
      {addingStage && <StageForm goalId={goal.id} position={stages.length} targetDate={goal.targetDate}
        defaultStart={stages.length ? localDate(stages[stages.length - 1]!.endsOn) : localDate(today)}
        onSaved={async () => { await onChanged(); setAddingStage(false) }} onCancel={() => setAddingStage(false)} />}
    </section>

    <button className="danger secondary wide" disabled={archive.isPending}
      onClick={async () => { if (await confirm({ message: 'Архивировать цель? Её можно будет поставить заново.', confirmLabel: 'Архивировать', danger: true })) archive.mutate() }}>
      Архивировать цель
    </button>
    {archive.error && <p className="error">{archive.error.message}</p>}
    {confirmDialog}
  </div>
}

function StageRow({ stage, today, targetDate, onChanged }: { stage: GoalStage; today: string; targetDate: string | null; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const remove = useMutation({ mutationFn: () => goalsRepository.deleteStage(stage.id), onSuccess: () => void onChanged() })
  if (editing) return <StageForm goalId={stage.goalId} stage={stage} position={stage.position} targetDate={targetDate}
    defaultStart={localDate(stage.startsOn)} onSaved={async () => { await onChanged(); setEditing(false) }} onCancel={() => setEditing(false)} />
  const status = stageStatus(stage, localDate(today))
  return <article className={`stage-row ${status}`}>
    <div>
      <strong>{stage.title}</strong>
      <p className="muted">{formatLocalDateShort(localDate(stage.startsOn))} — {formatLocalDateShort(localDate(stage.endsOn))} · {STATUS_LABEL[status]}</p>
    </div>
    <div className="stage-actions">
      <button type="button" className="link" onClick={() => setEditing(true)}>Изменить</button>
      <button type="button" className="link danger" disabled={remove.isPending}
        onClick={async () => { if (await confirm({ message: 'Удалить этап?', confirmLabel: 'Удалить', danger: true })) remove.mutate() }}>Удалить</button>
    </div>
    {remove.error && <p className="error">{remove.error.message}</p>}
    {confirmDialog}
  </article>
}

function StageForm({ goalId, stage, position, defaultStart, targetDate, onSaved, onCancel }: {
  goalId: string; stage?: GoalStage; position: number; defaultStart: string; targetDate: string | null
  onSaved: () => Promise<void>; onCancel: () => void
}) {
  const titleCounterId = useId()
  const form = useForm<{ title: string; startsOn: string; endsOn: string }>({
    defaultValues: {
      title: stage?.title ?? '', startsOn: stage?.startsOn ?? defaultStart, endsOn: stage?.endsOn ?? '',
    },
  })
  const mutation = useMutation({
    mutationFn: (values: { title: string; startsOn: string; endsOn: string }) => goalsRepository.saveStage({
      goalId, id: stage?.id, version: stage?.version, position,
      title: values.title.trim(), startsOn: localDate(values.startsOn), endsOn: localDate(values.endsOn),
    }),
    onSuccess: () => void onSaved(),
  })
  const titleValue = useWatch({ control: form.control, name: 'title' })
  return <form className="stack stage-form" onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate(values))(event)}>
    <Field label="Название этапа" error={form.formState.errors.title?.message}>
      <input placeholder="Например: Сушка" maxLength={GOAL_STAGE_TITLE_MAX_LENGTH} aria-label="Название этапа" aria-describedby={titleCounterId}
        {...form.register('title', {
          required: 'Введите название',
          validate: (value) => titleLengthValidation(value, 'Название этапа', GOAL_STAGE_TITLE_MAX_LENGTH),
        })} />
      <small id={titleCounterId} className="goal-title-counter">{titleValue.length}/{GOAL_STAGE_TITLE_MAX_LENGTH}</small>
    </Field>
    <div className="split">
      <Field label="Начало" error={form.formState.errors.startsOn?.message}><input type="date" {...form.register('startsOn', { required: 'Дата' })} /></Field>
      <Field label="Конец" error={form.formState.errors.endsOn?.message}>
        <input type="date" max={targetDate ?? undefined} {...form.register('endsOn', {
          required: 'Дата',
          validate: (value, values) => {
            if (values.startsOn && value < values.startsOn) return 'Конец раньше начала'
            if (targetDate && value > targetDate) return 'Позже даты цели'
            return true
          },
        })} />
      </Field>
    </div>
    {targetDate && <p className="muted stage-hint">Этап должен уложиться до даты цели ({formatLocalDateShort(localDate(targetDate))}).</p>}
    {mutation.error && <p className="error">{mutation.error.message}</p>}
    <div className="actions"><button type="button" className="secondary" onClick={onCancel}>Отмена</button><button className="primary" disabled={mutation.isPending}>{stage ? 'Сохранить' : 'Добавить этап'}</button></div>
  </form>
}
