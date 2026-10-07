import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useDataBackend } from '../../app/data-backend-context'
import { useAuth } from '../../app/auth-context'
import { cloneWorkoutTemplate, workoutTemplateFromWorkout } from '../../data/repositories/workout-templates.repository'
import { replaceExercise } from '../../data/repositories/workouts.repository'
import type { ExerciseSnapshot, WorkoutExerciseDraft, WorkoutTemplateDraft } from '../../shared/domain'
import { formatLocalDate } from '../../shared/local-date'
import { AddIcon, CopyIcon, ScheduleIcon } from '../../shared/icons'
import { AsyncView, EmptyState, Field, OverflowMenu, Page, StatePanel, useConfirm } from '../../shared/ui'
import { ExercisePicker, useExerciseCatalog } from '../exercises'
import { QuickWorkoutEntry, WorkoutCta, WorkoutExerciseEditor, WorkoutHeader, type ParsedWorkoutExercise } from '../workouts'
import { VoiceNoteField } from '../voice-input'
import { readWorkoutTemplateDraft, removeWorkoutTemplateDraft, workoutTemplateDraftKey, writeWorkoutTemplateDraft } from './workout-template-draft'

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
  const { actor } = useAuth()
  if (!actor || actor.role !== 'trainer') return null
  return <WorkoutTemplates key={actor.userId} />
}

function WorkoutTemplates() {
  const { workoutTemplates } = useDataBackend()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirm, confirmDialog] = useConfirm()
  const pendingCopies = useRef(new Map<string, WorkoutTemplateDraft>())
  const query = useQuery({ queryKey: ['workout-templates'], queryFn: () => workoutTemplates.list() })
  const duplicate = useMutation({
    mutationFn: (template: NonNullable<typeof query.data>[number]) => {
      const key = `${template.id}:${template.version}`
      const draft = pendingCopies.current.get(key) ?? cloneWorkoutTemplate(template)
      pendingCopies.current.set(key, draft)
      return workoutTemplates.save(draft)
    },
    onSuccess: (_result, template) => {
      pendingCopies.current.delete(`${template.id}:${template.version}`)
      return queryClient.invalidateQueries({ queryKey: ['workout-templates'] })
    },
  })
  const archive = useMutation({
    mutationFn: (template: NonNullable<typeof query.data>[number]) => workoutTemplates.archive(template),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workout-templates'] }),
  })
  return <Page className="workout-templates-page" title="Шаблоны тренировок" back="/schedule"
    action={<div className="template-create-menu"><OverflowMenu label="Создать шаблон" trigger={<AddIcon />} items={[
      { label: 'Создать с нуля', onClick: () => navigate('/schedule/templates/new/editor') },
      { label: 'Из тренировки клиента', onClick: () => navigate('/schedule/templates/from-workout') },
    ]} /></div>}>
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
          <Link className="button secondary" to={`/workouts/new?template=${template.id}`}><ScheduleIcon />Назначить</Link></div>
      </article>)}</div> : <EmptyState title="Создайте первый шаблон" description="Соберите тренировку с нуля или сохраните готовый план клиента."
        action={<div className="template-empty-actions"><Link className="button primary" to="/schedule/templates/new/editor">Создать с нуля</Link><Link className="button secondary" to="/schedule/templates/from-workout"><CopyIcon />Из тренировки</Link></div>} />}
      {(duplicate.error || archive.error) && <p className="error" role="alert">{(duplicate.error ?? archive.error)?.message}</p>}
    </AsyncView>
    {confirmDialog}
  </Page>
}

export function WorkoutTemplateCreatePage() {
  return <Navigate to="/schedule/templates/new/editor" replace />
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
  return <Page className="workout-template-source-page" title="Выберите тренировку" back="/schedule/templates">
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
  const { actor } = useAuth()
  const { templateId } = useParams()
  const [params] = useSearchParams()
  const sourceWorkoutId = params.get('sourceWorkout') ?? ''
  if (!actor || actor.role !== 'trainer') return null
  const draftKey = workoutTemplateDraftKey(actor.userId, templateId, sourceWorkoutId)
  return <WorkoutTemplateEditor key={draftKey} templateId={templateId} sourceWorkoutId={sourceWorkoutId} draftKey={draftKey} />
}

function WorkoutTemplateEditor({ templateId, sourceWorkoutId, draftKey }: { templateId?: string; sourceWorkoutId: string; draftKey: string }) {
  const { exercises: exercisesRepository, workoutTemplates, workouts } = useDataBackend()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const catalog = useExerciseCatalog()
  const templateQuery = useQuery({ queryKey: ['workout-template', templateId], queryFn: () => workoutTemplates.get(templateId!), enabled: Boolean(templateId) })
  const sourceQuery = useQuery({ queryKey: ['workout', sourceWorkoutId], queryFn: () => workouts.get(sourceWorkoutId), enabled: Boolean(sourceWorkoutId) })
  const [storedDraft] = useState(() => {
    const draft = readWorkoutTemplateDraft(draftKey)
    return templateId && draft?.id !== templateId ? null : draft
  })
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [exercises, setExercises] = useState<WorkoutExerciseDraft[]>([])
  const [newTemplateId] = useState(() => storedDraft?.id ?? crypto.randomUUID())
  const [baseVersion, setBaseVersion] = useState<number | undefined>()
  const [draftStorageError, setDraftStorageError] = useState(false)
  const finished = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const [ready, setReady] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  useEffect(() => {
    if (ready || templateQuery.isLoading || sourceQuery.isLoading || templateQuery.error || sourceQuery.error) return
    const initial = storedDraft ?? templateQuery.data ?? (sourceQuery.data ? workoutTemplateFromWorkout(sourceQuery.data) : null)
    if (initial) { setName(initial.name); setNotes(initial.notes ?? ''); setExercises(initial.exercises) }
    setBaseVersion(initial?.version)
    setDirty(Boolean(storedDraft))
    setReady(true)
  }, [ready, storedDraft, sourceQuery.data, sourceQuery.isLoading, sourceQuery.error, templateQuery.data, templateQuery.isLoading, templateQuery.error])
  useEffect(() => {
    if (!ready || !dirty || finished.current) return
    setDraftStorageError(!writeWorkoutTemplateDraft(draftKey, { id: templateId ?? newTemplateId, name, notes, exercises, version: baseVersion }))
  }, [ready, dirty, draftKey, templateId, newTemplateId, name, notes, exercises, baseVersion])
  const save = useMutation({
    mutationFn: (draft: WorkoutTemplateDraft) => workoutTemplates.save(draft),
    onSuccess: async () => {
      finished.current = true
      removeWorkoutTemplateDraft(draftKey)
      if (!active.current) return
      await queryClient.invalidateQueries({ queryKey: ['workout-templates'] })
      if (active.current) navigate('/schedule/templates', { replace: true })
    },
  })
  function closePicker() { setPickerOpen(false); setPickerSearch(''); setReplaceIndex(null) }
  const [confirmLeave, confirmLeaveDialog] = useConfirm()
  async function leaveForm() {
    if (save.isPending) return
    if (dirty) {
      const shouldLeave = await confirmLeave({ message: 'Выйти из шаблона? Несохранённые изменения будут удалены.', confirmLabel: 'Выйти', danger: true })
      if (!shouldLeave) return
    }
    finished.current = true
    removeWorkoutTemplateDraft(draftKey)
    navigate('/schedule/templates')
  }
  function pick(selected: ExerciseSnapshot) {
    setExercises((current) => replaceIndex === null
      ? [...current, blankExercise(selected, current.length)]
      : replaceExercise(current, replaceIndex, selected))
    setDirty(true)
    closePicker()
  }
  function pickMany(selected: ExerciseSnapshot[]) {
    setExercises((current) => [...current, ...selected.map((exercise, index) => blankExercise(exercise, current.length + index))])
    setDirty(true)
    closePicker()
  }
  function quickAdd(items: ParsedWorkoutExercise[]) {
    setExercises((current) => [...current, ...items.map((item, index) => ({
      ...blankExercise(item.exercise, current.length + index),
      ...item.structure,
      sets: item.hasValues ? item.sets : [{ position: 0 }],
    }))])
    setDirty(true)
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (save.isPending || !name.trim() || !exercises.length) return
    setDirty(true)
    setDraftStorageError(!writeWorkoutTemplateDraft(draftKey, { id: templateId ?? newTemplateId, name, notes, exercises, version: baseVersion }))
    save.mutate({ id: templateId ?? newTemplateId, name: name.trim(), notes: notes.trim() || undefined, exercises, version: baseVersion })
  }
  const error = templateQuery.error ?? sourceQuery.error
  const pageTitle = templateId ? 'Редактировать шаблон' : 'Новый шаблон'
  const headerMeta = exercises.length > 0 ? templateMeta(exercises) : 'Сначала добавьте упражнения'
  return <Page className="workout-template-editor-page workout-form-page workout-focused-page" title={pageTitle} hideTitle back={-1} onBack={() => void leaveForm()}>
    <WorkoutHeader eyebrow="ШАБЛОН ТРЕНИРОВКИ" title={pageTitle} meta={headerMeta} state="planned" showStatus={false} />
    <AsyncView loading={!ready && !error} error={error} onRetry={() => { if (templateId) void templateQuery.refetch(); if (sourceWorkoutId) void sourceQuery.refetch() }}>
      <form className="stack workout-form workout-template-form" onSubmit={submit}>
        <section className="workout-form-section template-basics"><Field label="Название шаблона"><input value={name} onChange={(event) => { setName(event.target.value); setDirty(true) }} placeholder="Например, Силовая · всё тело" maxLength={80} required /></Field>
          <details className="workout-notes" open={Boolean(notes)}>
            <summary>Заметка для спортсмена <span>Необязательно</span></summary>
            <VoiceNoteField name="notes" source="workout_template_form" value={notes} onValueChange={(value) => { setNotes(value); setDirty(true) }} placeholder="Общие подсказки к тренировке" hideLabel />
          </details>
        </section>
        <section className="workout-form-section workout-form-exercises"><div className="workout-form-section-head workout-form-exercise-heading"><h2>Упражнения</h2><span>{templateMeta(exercises)}</span></div>
          <QuickWorkoutEntry catalog={catalog.exercises} parseWorkout={(text, systemCatalog) => exercisesRepository.parseWorkout(text, systemCatalog)} onAdd={quickAdd} compact={exercises.length > 0} onOpenCatalog={exercises.length === 0 ? (search) => { setPickerSearch(search); setPickerOpen(true) } : undefined} />
          {!exercises.length && <p className="workout-empty-hint">Добавьте хотя бы одно упражнение — голосом, текстом или из каталога.</p>}
          <WorkoutExerciseEditor exercises={exercises} onChange={(next) => { setExercises(next); setDirty(true) }} onOpenPicker={() => setPickerOpen(true)} onReplaceExercise={(index) => { setReplaceIndex(index); setPickerOpen(true) }} hideEmptyAddAction collapseInitialExercises={Boolean(templateId || sourceWorkoutId)} initialExercisesReady={ready} />
        </section>
        {save.error && <p className="error" role="alert">{save.error.message}</p>}
        {draftStorageError && <p className="error" role="alert">Не удалось сохранить черновик на устройстве. Не закрывайте экран до сохранения шаблона.</p>}
        <div className="actions workout-action-row"><WorkoutCta type="submit" pending={save.isPending} pendingLabel="Сохраняем…" disabled={!name.trim() || !exercises.length}>Сохранить шаблон</WorkoutCta></div>
      </form>
      {pickerOpen && <ExercisePicker catalog={catalog} initialSearch={pickerSearch} multiple={replaceIndex === null} onPick={pick} onPickMany={pickMany} onClose={closePicker} techniqueActionLabel={replaceIndex === null ? 'Добавить упражнение' : 'Заменить упражнение'} />}
    </AsyncView>
    {confirmLeaveDialog}
  </Page>
}

export function WorkoutTemplateAssignPage() {
  const { templateId = '' } = useParams()
  return <Navigate to={`/workouts/new?template=${encodeURIComponent(templateId)}`} replace />
}

export function MissingWorkoutTemplatePage() {
  return <Page title="Шаблон недоступен" back="/schedule/templates"><StatePanel tone="info" title="Не удалось открыть шаблон" description="Возможно, он был удалён." /></Page>
}
