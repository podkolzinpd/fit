import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router-dom'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { goalsRepository } from '../../data/repositories/goals.repository'
import type { ClientGoal, GoalStage } from '../../shared/domain'
import { orderedStages, stageStatus } from '../../shared/goal-rules'
import { formatLocalDateShort, localDate, todayLocalDate } from '../../shared/local-date'
import { AsyncView, Field, Page } from '../../shared/ui'

const STATUS_LABEL: Record<string, string> = { done: 'завершён', current: 'идёт', upcoming: 'впереди' }

export function GoalPage() {
  const { clientId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const client = useQuery({ queryKey: ['client', clientId], queryFn: () => clientsRepository.get(clientId) })
  const goalQuery = useQuery({ queryKey: ['client-goal', clientId], queryFn: () => goalsRepository.get(clientId) })
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['client-goal', clientId] })
    await queryClient.invalidateQueries({ queryKey: ['clients'] })
  }
  const today = todayLocalDate()
  return <Page title={client.data?.fullName ?? 'Цель'} back={`/clients/${clientId}`} center>
    <AsyncView loading={goalQuery.isLoading || client.isLoading} error={goalQuery.error} onRetry={() => void goalQuery.refetch()}>
      {goalQuery.data
        ? <GoalDetail goal={goalQuery.data} today={today} onChanged={invalidate}
            onArchived={async () => { await invalidate(); navigate(`/clients/${clientId}`) }} />
        : <GoalCreate clientId={clientId} initialTitle={client.data?.goal ?? ''}
            onCreated={invalidate} />}
    </AsyncView>
  </Page>
}

function GoalCreate({ clientId, initialTitle, onCreated }: {
  clientId: string; initialTitle: string; onCreated: () => Promise<void>
}) {
  const form = useForm<{ title: string; targetDate: string }>({ defaultValues: { title: initialTitle, targetDate: '' } })
  const mutation = useMutation({
    mutationFn: (values: { title: string; targetDate: string }) => goalsRepository.save({
      clientId, title: values.title.trim(), targetDate: values.targetDate ? localDate(values.targetDate) : null,
    }),
    onSuccess: () => void onCreated(),
  })
  return <form className="stack" onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate(values))(event)}>
    <p className="muted">Оформите цель с датой и разбейте путь на этапы.</p>
    <Field label="Цель" error={form.formState.errors.title?.message}>
      <textarea rows={2} placeholder="Например: похудеть к отпуску, −8 кг"
        {...form.register('title', { required: 'Введите цель' })} />
    </Field>
    <Field label="Дата достижения"><input type="date" {...form.register('targetDate')} /></Field>
    {mutation.error && <p className="error">{mutation.error.message}</p>}
    <div className="actions"><button disabled={mutation.isPending}>Создать цель</button></div>
  </form>
}

function GoalDetail({ goal, today, onChanged, onArchived }: {
  goal: ClientGoal; today: string; onChanged: () => Promise<void>; onArchived: () => Promise<void>
}) {
  const [editingGoal, setEditingGoal] = useState(false)
  const [addingStage, setAddingStage] = useState(false)
  const archive = useMutation({
    mutationFn: () => goalsRepository.archive(goal.id, goal.version),
    onSuccess: () => void onArchived(),
  })
  const stages = orderedStages(goal)
  return <div className="stack">
    {editingGoal
      ? <GoalEditForm goal={goal} onSaved={async () => { await onChanged(); setEditingGoal(false) }} onCancel={() => setEditingGoal(false)} />
      : <section className="goal-block">
          <div className="goal-head"><h2>{goal.title}</h2><button type="button" className="link" onClick={() => setEditingGoal(true)}>Изменить</button></div>
          {goal.targetDate && <p className="muted">До {formatLocalDateShort(localDate(goal.targetDate))}</p>}
        </section>}

    <section className="goal-block">
      <div className="goal-head"><h2>Этапы</h2>{!addingStage && <button type="button" className="link" onClick={() => setAddingStage(true)}>＋ Добавить</button>}</div>
      {stages.length === 0 && !addingStage && <p className="muted">Этапов пока нет</p>}
      <div className="stage-list">
        {stages.map((stage) => <StageRow key={stage.id} stage={stage} today={today} onChanged={onChanged} />)}
      </div>
      {addingStage && <StageForm goalId={goal.id} position={stages.length}
        defaultStart={stages.length ? localDate(stages[stages.length - 1]!.endsOn) : localDate(today)}
        onSaved={async () => { await onChanged(); setAddingStage(false) }} onCancel={() => setAddingStage(false)} />}
    </section>

    <button className="danger secondary wide" disabled={archive.isPending}
      onClick={() => { if (window.confirm('Архивировать цель? Её можно будет поставить заново.')) archive.mutate() }}>
      Архивировать цель
    </button>
    {archive.error && <p className="error">{archive.error.message}</p>}
  </div>
}

function GoalEditForm({ goal, onSaved, onCancel }: { goal: ClientGoal; onSaved: () => Promise<void>; onCancel: () => void }) {
  const form = useForm<{ title: string; targetDate: string }>({
    defaultValues: { title: goal.title, targetDate: goal.targetDate ?? '' },
  })
  const mutation = useMutation({
    mutationFn: (values: { title: string; targetDate: string }) => goalsRepository.save({
      clientId: goal.clientId, id: goal.id, version: goal.version,
      title: values.title.trim(), targetDate: values.targetDate ? localDate(values.targetDate) : null,
    }),
    onSuccess: () => void onSaved(),
  })
  return <form className="stack goal-block" onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate(values))(event)}>
    <Field label="Цель" error={form.formState.errors.title?.message}>
      <textarea rows={2} {...form.register('title', { required: 'Введите цель' })} />
    </Field>
    <Field label="Дата достижения"><input type="date" {...form.register('targetDate')} /></Field>
    {mutation.error && <p className="error">{mutation.error.message}</p>}
    <div className="actions"><button type="button" className="secondary" onClick={onCancel}>Отмена</button><button disabled={mutation.isPending}>Сохранить</button></div>
  </form>
}

function StageRow({ stage, today, onChanged }: { stage: GoalStage; today: string; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const remove = useMutation({ mutationFn: () => goalsRepository.deleteStage(stage.id), onSuccess: () => void onChanged() })
  if (editing) return <StageForm goalId={stage.goalId} stage={stage} position={stage.position}
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
        onClick={() => { if (window.confirm('Удалить этап?')) remove.mutate() }}>Удалить</button>
    </div>
    {remove.error && <p className="error">{remove.error.message}</p>}
  </article>
}

function StageForm({ goalId, stage, position, defaultStart, onSaved, onCancel }: {
  goalId: string; stage?: GoalStage; position: number; defaultStart: string
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
      <Field label="Конец" error={form.formState.errors.endsOn?.message}><input type="date" {...form.register('endsOn', { required: 'Дата' })} /></Field>
    </div>
    {mutation.error && <p className="error">{mutation.error.message}</p>}
    <div className="actions"><button type="button" className="secondary" onClick={onCancel}>Отмена</button><button disabled={mutation.isPending}>{stage ? 'Сохранить' : 'Добавить этап'}</button></div>
  </form>
}
