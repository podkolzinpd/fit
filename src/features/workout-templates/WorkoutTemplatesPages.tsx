import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { cloneWorkoutTemplate, workoutTemplateFromWorkout } from '../../data/repositories/workout-templates.repository'
import { replaceExercise } from '../../data/repositories/workouts.repository'
import type { ExerciseSnapshot, WorkoutExerciseDraft, WorkoutTemplateDraft } from '../../shared/domain'
import { formatLocalDate, localDate, todayInTimeZone } from '../../shared/local-date'
import { AddIcon, CopyIcon, ScheduleIcon } from '../../shared/icons'
import { AsyncView, EmptyState, Field, OverflowMenu, Page, StatePanel, useConfirm } from '../../shared/ui'
import { ExercisePicker, useExerciseCatalog } from '../exercises'
import { QuickWorkoutEntry } from '../workouts/QuickWorkoutEntry'
import { WorkoutExerciseEditor } from '../workouts/WorkoutExerciseEditor'
import type { ParsedWorkoutExercise } from '../workouts/quick-workout-entry'

function exerciseWord(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'упражнений'
  if (last === 1) return 'упражнение'
  if (last >= 2 && last <= 4) return 'упражнения'
  return 'упражнений'
}

function setWord(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'подходов'
  if (last === 1) return 'подход'
  if (last >= 2 && last <= 4) return 'подхода'
  return 'подходов'
}

function templateMeta(exercises: readonly WorkoutExerciseDraft[]) {
  const sets = exercises.reduce((total, exercise) => total + exercise.sets.length, 0)
  return `${exercises.length} ${exerciseWord(exercises.length)} · ${sets} ${setWord(sets)}`
}

export function WorkoutTemplatesPage() {
  const { workoutTemplates } = useDataBackend()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirm, confirmDialog] = useConfirm()
  const query = useQuery({ queryKey: ['workout-templates'], queryFn: () => workoutTemplates.list() })
  const duplicate = useMutation({
    mutationFn: (template: NonNullable<typeof query.data>[number]) => workoutTemplates.save(cloneWorkoutTemplate(template)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workout-templates'] }),
  })
  const archive = useMutation({
    mutationFn: (template: NonNullable<typeof query.data>[number]) => workoutTemplates.archive(template),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workout-templates'] }),
  })
  return <Page className="workout-templates-page" title="Шаблоны тренировок" back="/schedule"
    action={<Link className="button primary template-new-button" to="/schedule/templates/new"><AddIcon />Создать</Link>}>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {query.data?.length ? <div className="template-list">{query.data.map((template) => <article className="template-card" key={template.id}>
        <div className="template-card-head">
          <div><h2>{template.name}</h2><p>{templateMeta(template.exercises)}</p></div>
          <OverflowMenu label={`Действия с шаблоном ${template.name}`} items={[
            { label: 'Редактировать', onClick: () => navigate(`/schedule/templates/${template.id}/edit`) },
            { label: 'Создать копию', disabled: duplicate.isPending, onClick: () => duplicate.mutate(template) },
            { label: 'Удалить', danger: true, disabled: archive.isPending, onClick: () => { void confirm({ message: `Удалить шаблон «${template.name}»? Уже назначенные тренировки не изменятся.`, confirmLabel: 'Удалить', danger: true }).then((ok) => ok && archive.mutate(template)) } },
          ]} />
        </div>
        <p className="template-exercise-preview">{template.exercises.slice(0, 3).map((exercise) => exercise.name).join(' · ')}{template.exercises.length > 3 ? ` · ещё ${template.exercises.length - 3}` : ''}</p>
        <div className="template-card-footer"><span>Обновлён {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(template.updatedAt))}</span>
          <Link className="button secondary" to={`/schedule/templates/${template.id}/assign`}><ScheduleIcon />Назначить</Link></div>
      </article>)}</div> : <EmptyState title="Создайте первый шаблон" description="Соберите тренировку с нуля или сохраните готовый план клиента."
        action={<div className="template-empty-actions"><Link className="button primary" to="/schedule/templates/new">Создать с нуля</Link><Link className="button secondary" to="/schedule/templates/from-workout"><CopyIcon />Из тренировки</Link></div>} />}
      {(duplicate.error || archive.error) && <p className="error" role="alert">{(duplicate.error ?? archive.error)?.message}</p>}
    </AsyncView>
    {confirmDialog}
  </Page>
}

export function WorkoutTemplateCreatePage() {
  return <Page className="workout-template-create-page" title="Новый шаблон" back="/schedule/templates">
    <p className="template-create-intro">Выберите, с чего начать. В шаблон попадёт только план — без клиента и результатов.</p>
    <div className="template-source-grid">
      <Link className="template-source-card" to="/schedule/templates/new/editor"><span className="template-source-icon"><AddIcon /></span><strong>Создать с нуля</strong><span>Добавить упражнения и подходы вручную</span></Link>
      <Link className="template-source-card" to="/schedule/templates/from-workout"><span className="template-source-icon"><CopyIcon /></span><strong>Из тренировки клиента</strong><span>Взять готовую структуру плана</span></Link>
    </div>
  </Page>
}

export function WorkoutTemplateSourcePage() {
  const { workouts } = useDataBackend()
  const query = useQuery({ queryKey: ['workouts', 'template-source'], queryFn: () => workouts.list() })
  const [clientId, setClientId] = useState('')
  const clients = useMemo(() => {
    const unique = new Map<string, string>()
    for (const workout of query.data ?? []) unique.set(workout.clientId, workout.clientName)
    return [...unique.entries()].sort((left, right) => left[1].localeCompare(right[1], 'ru'))
  }, [query.data])
  const visible = (query.data ?? []).filter((workout) => !clientId || workout.clientId === clientId).slice(0, 40)
  return <Page className="workout-template-source-page" title="Выберите тренировку" back="/schedule/templates/new">
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {query.data?.length ? <>
        <Field label="Клиент"><select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Все клиенты</option>{clients.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></Field>
        <div className="template-source-workouts">{visible.map((workout) => <Link className="template-source-workout" key={workout.id} to={`/schedule/templates/new/editor?sourceWorkout=${workout.id}`}>
          <span><strong>{workout.clientName}</strong><small>{formatLocalDate(workout.workoutDate)} · {templateMeta(workout.exercises)}</small></span><span>Выбрать</span>
        </Link>)}</div>
      </> : <EmptyState title="Нет тренировок для основы" description="Создайте шаблон с нуля — тренировку клиента можно сохранить позже." action={<Link className="button primary" to="/schedule/templates/new/editor">Создать с нуля</Link>} />}
    </AsyncView>
  </Page>
}

function blankExercise(exercise: ExerciseSnapshot, position: number): WorkoutExerciseDraft {
  return { ...exercise, position, blockId: crypto.randomUUID(), blockType: 'single', blockRounds: 1, sets: [{ position: 0 }] }
}

export function WorkoutTemplateEditorPage() {
  const { exercises: exercisesRepository, workoutTemplates, workouts } = useDataBackend()
  const { templateId } = useParams()
  const [params] = useSearchParams()
  const sourceWorkoutId = params.get('sourceWorkout') ?? ''
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const catalog = useExerciseCatalog()
  const templateQuery = useQuery({ queryKey: ['workout-template', templateId], queryFn: () => workoutTemplates.get(templateId!), enabled: Boolean(templateId) })
  const sourceQuery = useQuery({ queryKey: ['workout', sourceWorkoutId], queryFn: () => workouts.get(sourceWorkoutId), enabled: Boolean(sourceWorkoutId) })
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [exercises, setExercises] = useState<WorkoutExerciseDraft[]>([])
  const [ready, setReady] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  useEffect(() => {
    if (ready || templateQuery.isLoading || sourceQuery.isLoading) return
    const initial = templateQuery.data ?? (sourceQuery.data ? workoutTemplateFromWorkout(sourceQuery.data) : null)
    if (initial) { setName(initial.name); setNotes(initial.notes ?? ''); setExercises(initial.exercises) }
    setReady(true)
  }, [ready, sourceQuery.data, sourceQuery.isLoading, templateQuery.data, templateQuery.isLoading])
  const save = useMutation({
    mutationFn: (draft: WorkoutTemplateDraft) => workoutTemplates.save(draft),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['workout-templates'] }); navigate('/schedule/templates', { replace: true }) },
  })
  function closePicker() { setPickerOpen(false); setPickerSearch(''); setReplaceIndex(null) }
  function pick(selected: ExerciseSnapshot) {
    setExercises((current) => replaceIndex === null
      ? [...current, blankExercise(selected, current.length)]
      : replaceExercise(current, replaceIndex, selected))
    closePicker()
  }
  function pickMany(selected: ExerciseSnapshot[]) {
    setExercises((current) => [...current, ...selected.map((exercise, index) => blankExercise(exercise, current.length + index))])
    closePicker()
  }
  function quickAdd(items: ParsedWorkoutExercise[]) {
    setExercises((current) => [...current, ...items.map((item, index) => ({
      ...blankExercise(item.exercise, current.length + index),
      ...item.structure,
      sets: item.hasValues ? item.sets : [{ position: 0 }],
    }))])
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !exercises.length) return
    save.mutate({ id: templateQuery.data?.id ?? crypto.randomUUID(), name: name.trim(), notes: notes.trim() || undefined, exercises, version: templateQuery.data?.version })
  }
  const error = templateQuery.error ?? sourceQuery.error
  return <Page className="workout-template-editor-page workout-form-page" title={templateId ? 'Редактировать шаблон' : 'Новый шаблон'} back="/schedule/templates">
    <AsyncView loading={!ready} error={error} onRetry={() => { void templateQuery.refetch(); void sourceQuery.refetch() }}>
      <form className="stack workout-template-form" onSubmit={submit}>
        <section className="workout-form-section template-basics"><Field label="Название"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Силовая · всё тело" maxLength={80} required /></Field>
          <Field label="Заметка для спортсмена · необязательно"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Общие подсказки к тренировке" /></Field></section>
        <section className="workout-form-section workout-form-exercises"><div className="workout-form-section-head workout-form-exercise-heading"><h2>Упражнения</h2><span>{templateMeta(exercises)}</span></div>
          <QuickWorkoutEntry catalog={catalog.exercises} parseWorkout={(text, systemCatalog) => exercisesRepository.parseWorkout(text, systemCatalog)} onAdd={quickAdd} compact={exercises.length > 0} onOpenCatalog={exercises.length === 0 ? (search) => { setPickerSearch(search); setPickerOpen(true) } : undefined} />
          {!exercises.length && <p className="workout-empty-hint">Добавьте хотя бы одно упражнение — голосом, текстом или из каталога.</p>}
          <WorkoutExerciseEditor exercises={exercises} onChange={setExercises} onOpenPicker={() => setPickerOpen(true)} onReplaceExercise={(index) => { setReplaceIndex(index); setPickerOpen(true) }} hideEmptyAddAction collapseInitialExercises={Boolean(templateId || sourceWorkoutId)} initialExercisesReady={ready} />
        </section>
        {save.error && <p className="error" role="alert">{save.error.message}</p>}
        <button className="primary wide template-save" type="submit" disabled={save.isPending || !name.trim() || !exercises.length}>{save.isPending ? 'Сохраняем…' : 'Сохранить шаблон'}</button>
      </form>
      {pickerOpen && <ExercisePicker catalog={catalog} initialSearch={pickerSearch} multiple={replaceIndex === null} onPick={pick} onPickMany={pickMany} onClose={closePicker} techniqueActionLabel={replaceIndex === null ? 'Добавить упражнение' : 'Заменить упражнение'} />}
    </AsyncView>
  </Page>
}

export function WorkoutTemplateAssignPage() {
  const { workoutTemplates, clients } = useDataBackend()
  const { templateId = '' } = useParams()
  const { actor } = useAuth()
  const navigate = useNavigate()
  const template = useQuery({ queryKey: ['workout-template', templateId], queryFn: () => workoutTemplates.get(templateId) })
  const clientsQuery = useQuery({ queryKey: ['clients', false], queryFn: () => clients.list(false) })
  const [clientId, setClientId] = useState('')
  const [date, setDate] = useState(() => todayInTimeZone(actor?.timezone))
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!clientId) return
    navigate(`/workouts/new?client=${clientId}&date=${date}&template=${templateId}`)
  }
  return <Page className="workout-template-assign-page" title="Назначить шаблон" back="/schedule/templates">
    <AsyncView loading={template.isLoading || clientsQuery.isLoading} error={template.error ?? clientsQuery.error} onRetry={() => { void template.refetch(); void clientsQuery.refetch() }}>
      {template.data && <form className="template-assign-card" onSubmit={submit}>
        <div className="template-assign-summary"><p className="eyebrow">ШАБЛОН</p><h2>{template.data.name}</h2><p>{templateMeta(template.data.exercises)}</p></div>
        <Field label="Клиент"><select value={clientId} onChange={(event) => setClientId(event.target.value)} required><option value="">Выберите клиента</option>{clientsQuery.data?.map((client) => <option value={client.id} key={client.id}>{client.fullName}</option>)}</select></Field>
        <Field label="Дата"><input type="date" value={date} min={localDate(todayInTimeZone(actor?.timezone))} onChange={(event) => setDate(localDate(event.target.value))} required /></Field>
        <button className="primary wide" type="submit" disabled={!clientId}>Продолжить к тренировке</button>
        <p className="template-assign-hint">Перед сохранением можно изменить упражнения и значения только для этого клиента.</p>
      </form>}
    </AsyncView>
  </Page>
}

export function MissingWorkoutTemplatePage() {
  return <Page title="Шаблон недоступен" back="/schedule/templates"><StatePanel tone="info" title="Не удалось открыть шаблон" description="Возможно, он был удалён." /></Page>
}
