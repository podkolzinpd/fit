import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { goalsRepository } from '../../data/repositories/goals.repository'
import type { Client, ClientGoal, GoalCriterion, GoalCriterionMetric, GoalCriterionOperation, GoalStage, SaveGoalCriterionInput } from '../../shared/domain'
import { GOAL_CRITERION_METRICS, GOAL_CRITERION_OPERATIONS, goalCriterionTargetLabel, validateGoalCriterionInput } from '../../shared/goal-criterion-rules'
import { orderedStages, stageStatus } from '../../shared/goal-rules'
import { formatLocalDateShort, localDate, todayInTimeZone } from '../../shared/local-date'
import { AsyncView, Field, Page, Switch, useConfirm } from '../../shared/ui'

const STATUS_LABEL: Record<string, string> = { done: 'завершён', current: 'идёт', upcoming: 'впереди' }

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

type GoalFormValues = {
  title: string
  targetDate: string
  metric: GoalCriterionMetric
  operation: GoalCriterionOperation
  targetValue: number
  rangeMin: number
  rangeMax: number
}

function numberOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null
}

function criterionInput(values: GoalFormValues, existing?: GoalCriterion): SaveGoalCriterionInput {
  const operation = values.operation
  return {
    id: existing?.id,
    version: existing?.version,
    metric: values.metric,
    operation,
    targetValue: operation === 'maintain_range' || operation === 'track_only' ? null : numberOrNull(values.targetValue),
    rangeMin: operation === 'maintain_range' ? numberOrNull(values.rangeMin) : null,
    rangeMax: operation === 'maintain_range' ? numberOrNull(values.rangeMax) : null,
    unit: GOAL_CRITERION_METRICS[values.metric].unit,
    confirmationStatus: 'confirmed',
    position: existing?.position ?? 0,
  }
}

function GoalForm({ clientId, goal, initialTitle, onSaved, onCancel }: {
  clientId: string
  goal?: ClientGoal
  initialTitle?: string
  onSaved: () => Promise<void>
  onCancel?: () => void
}) {
  const existingCriterion = goal?.criteria[0]
  const [criterionEnabled, setCriterionEnabled] = useState(Boolean(existingCriterion))
  const [criterionReviewed, setCriterionReviewed] = useState(false)
  const defaults: GoalFormValues = {
    title: goal?.title ?? initialTitle ?? '',
    targetDate: goal?.targetDate ?? '',
    metric: existingCriterion?.metric ?? 'weight',
    operation: existingCriterion?.operation ?? 'track_only',
    targetValue: existingCriterion?.targetValue ?? Number.NaN,
    rangeMin: existingCriterion?.rangeMin ?? Number.NaN,
    rangeMax: existingCriterion?.rangeMax ?? Number.NaN,
  }
  const form = useForm<GoalFormValues>({ defaultValues: defaults })
  const operation = useWatch({ control: form.control, name: 'operation' })
  const metric = useWatch({ control: form.control, name: 'metric' })
  const title = useWatch({ control: form.control, name: 'title' }).trim()
  const criterionNeedsReview = Boolean(existingCriterion
    && (existingCriterion.confirmationStatus !== 'confirmed' || title !== goal?.title))
  const criterionFieldsDisabled = criterionNeedsReview && !criterionReviewed
  const mutation = useMutation({
    mutationFn: (values: GoalFormValues) => {
      const criterion = criterionEnabled
        ? (criterionNeedsReview && !criterionReviewed ? undefined : criterionInput(values, existingCriterion))
        : null
      if (criterion) {
        const issue = validateGoalCriterionInput(criterion)
        if (issue) throw new Error(issue)
      }
      return goalsRepository.save({
        clientId, id: goal?.id, version: goal?.version,
        title: values.title.trim(), targetDate: values.targetDate ? localDate(values.targetDate) : null,
        criterion,
      })
    },
    onSuccess: () => void onSaved(),
  })
  const submitLabel = goal ? 'Сохранить' : 'Создать цель'
  return <form className={`stack${goal ? ' goal-block' : ''}`} onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate(values))(event)}>
    {!goal && <p className="muted">Оформите цель с датой и при желании настройте измеримый критерий.</p>}
    <Field label="Цель" error={form.formState.errors.title?.message}>
      <textarea rows={2} placeholder="Например: держать вес 59 кг"
        {...form.register('title', { required: 'Введите цель' })} />
    </Field>
    <Field label="Дата достижения"><input type="date" {...form.register('targetDate')} /></Field>
    <section className="goal-criterion-form">
      <div className="goal-criterion-form-head">
        <div><h2 id="goal-criterion-form-title">Как оценивать цель</h2><p>Настройка необязательна и работает без ИИ.</p></div>
        <Switch label="Автоматическая оценка" checked={criterionEnabled} onChange={setCriterionEnabled} disabled={mutation.isPending} />
      </div>
      {criterionEnabled ? <div className="goal-criterion-fields">
        <Field label="Показатель"><select disabled={criterionFieldsDisabled} {...form.register('metric')}>
          {Object.entries(GOAL_CRITERION_METRICS).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
        </select></Field>
        <Field label="Способ оценки"><select disabled={criterionFieldsDisabled} {...form.register('operation')}>
          {Object.entries(GOAL_CRITERION_OPERATIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></Field>
        {operation === 'maintain_range' && <div className="split">
          <Field label={`Минимум, ${GOAL_CRITERION_METRICS[metric].unit}`}><input disabled={criterionFieldsDisabled} type="number" step="0.1" {...form.register('rangeMin', { valueAsNumber: true })} /></Field>
          <Field label={`Максимум, ${GOAL_CRITERION_METRICS[metric].unit}`}><input disabled={criterionFieldsDisabled} type="number" step="0.1" {...form.register('rangeMax', { valueAsNumber: true })} /></Field>
        </div>}
        {operation !== 'maintain_range' && operation !== 'track_only' && <Field label={`${operation === 'change_by' ? 'Изменение' : 'Значение'}, ${GOAL_CRITERION_METRICS[metric].unit}`}>
          <input disabled={criterionFieldsDisabled} type="number" step="0.1" {...form.register('targetValue', { valueAsNumber: true })} />
        </Field>}
        {criterionNeedsReview && <label className="goal-criterion-confirm"><input type="checkbox" checked={criterionReviewed}
          onChange={(event) => setCriterionReviewed(event.currentTarget.checked)} />
          <span>Я проверил(а), что критерий подходит к формулировке цели<small>Без подтверждения цель сохранится, а критерий получит статус «Нужно проверить».</small></span></label>}
        <p className="muted goal-criterion-hint">Progress показывает настройку и наличие данных без оценки достижения цели.</p>
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
  const criterion = goal.criteria[0]
  return <div className="stack">
    {editingGoal
      ? <GoalForm clientId={goal.clientId} goal={goal} onSaved={async () => { await onChanged(); setEditingGoal(false) }} onCancel={() => setEditingGoal(false)} />
      : <section className="goal-block">
          <div className="goal-head"><h2>{goal.title}</h2><button type="button" className="link" onClick={() => setEditingGoal(true)}>Изменить</button></div>
          {goal.targetDate && <p className="muted">До {formatLocalDateShort(localDate(goal.targetDate))}</p>}
        </section>}

    {!editingGoal && <section className="goal-block goal-criterion-summary">
      <div className="goal-head"><h2>Как оценивается цель</h2><button type="button" className="link" onClick={() => setEditingGoal(true)}>{criterion ? 'Изменить' : 'Настроить'}</button></div>
      {criterion ? <><p><strong>{GOAL_CRITERION_METRICS[criterion.metric].label}</strong> · {goalCriterionTargetLabel(criterion)}</p>
        <p className="muted">{criterion.confirmationStatus === 'confirmed' ? 'Критерий подтверждён' : 'После изменения цели критерий нужно подтвердить заново'}</p></>
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
  return <form className="stack stage-form" onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate(values))(event)}>
    <Field label="Название этапа" error={form.formState.errors.title?.message}>
      <input placeholder="Например: Сушка" {...form.register('title', { required: 'Введите название' })} />
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
