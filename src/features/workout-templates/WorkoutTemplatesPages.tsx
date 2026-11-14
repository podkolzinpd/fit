import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useDataBackend } from '../../app/data-backend-context'
import { useAuth } from '../../app/auth-context'
import { isFitLimeEnabled } from '../../app/fit-lime'
import { isCoachWorkoutRedesignEnabled } from '../../app/coach-workout-redesign'
import { readCoachCalendarRoute } from '../../app/coach-calendar-navigation'
import { cloneWorkoutTemplate, workoutTemplateFromWorkout } from '../../data/repositories/workout-template-rules'
import { replaceExercise } from '../../data/repositories/workout-rules'
import type { ExerciseSnapshot, WorkoutExerciseDraft, WorkoutTemplateDraft } from '../../shared/domain'
import { formatLocalDate } from '../../shared/local-date'
import { AddIcon, CopyIcon, ScheduleIcon } from '../../shared/icons'
import { filterWorkoutTemplates, WorkoutTemplateSearch, WorkoutTemplateSearchEmpty } from '../../shared/workout-template-search'
import { AsyncView, EmptyState, Field, InlineRequestError, OverflowMenu, Page, useConfirm } from '../../shared/ui'
import { ExercisePicker, useExerciseCatalog } from '../exercises'
import { LoadMoreButton, safeWorkoutReturnTo, readWorkoutFormDraft, type WorkoutNavigationState, readTemplatePlanContext, returnToTemplatePlan, applyCreatedTemplate, templateReturnSteps, type TemplatePlanContext, QuickWorkoutEntry, WorkoutCta, WorkoutExerciseEditor, WorkoutHeader, workoutDisplayTitle, workoutExerciseBrief, type ParsedWorkoutExercise } from '../workouts'
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
  const { actor } = useAuth()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('q') ?? ''
  function updateSearch(value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('q', value)
    else next.delete('q')
    setSearchParams(next, { replace: true, state: location.state as unknown })
  }
  const context = readTemplatePlanContext((location.state as { templatePlanContext?: unknown } | null)?.templatePlanContext, actor!.userId)
  const [returnError, setReturnError] = useState<string | null>(null)
  const calendarBack = isCoachWorkoutRedesignEnabled(actor) ? readCoachCalendarRoute(actor?.userId) ?? '/today' : '/schedule'
  const calendarParams = new URLSearchParams(calendarBack.split('?')[1])
  const assignmentDate = calendarParams.get('date') ?? calendarParams.get('anchor')
  const { workoutTemplates } = useDataBackend()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirm, confirmDialog] = useConfirm()
  const pendingCopies = useRef(new Map<string, WorkoutTemplateDraft>())
  const query = useQuery({ queryKey: ['workout-templates'], queryFn: () => workoutTemplates.list(), staleTime: 0, refetchOnMount: 'always' })
  const visible = filterWorkoutTemplates(query.data ?? [], search)
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
  return <Page className="workout-templates-page" title="Шаблоны тренировок" back={context?.returnTo ?? calendarBack} onBack={context ? () => returnToTemplatePlan(context, navigate) : undefined}
    action={<div className="template-create-menu"><OverflowMenu label="Создать шаблон" trigger={<AddIcon />} items={[
      { label: 'Создать с нуля', onClick: () => navigate('/schedule/templates/new/editor', { state: context ? { templatePlanContext: context } : undefined }) },
      { label: 'Из тренировки клиента', onClick: () => navigate('/schedule/templates/from-workout', { state: context ? { templatePlanContext: context } : undefined }) },
    ]} /></div>}>
    <AsyncView loading={query.isLoading || Boolean(context && query.isFetching)} error={query.error} onRetry={() => void query.refetch()}>
      {Boolean(query.data?.length || search) && <WorkoutTemplateSearch value={search} onChange={updateSearch} />}
      {query.data?.length ? visible.length ? <div className="template-list">{visible.map((template) => <article className="template-card" key={template.id}>
        <div className="template-card-head">
          <div><h2>{template.name}</h2><p>{templateMeta(template.exercises)}</p></div>
          <OverflowMenu label={`Действия с шаблоном ${template.name}`} items={[
            { label: 'Редактировать', onClick: () => navigate(`/schedule/templates/${template.id}/edit`, { state: { templateLibrarySearch: search, ...(context ? { templateLibraryReturn: { context, index: (window.history.state as { idx?: number } | null)?.idx } } : {}) } }) },
            { label: 'Создать копию', disabled: duplicate.isPending, onClick: () => duplicate.mutate(template) },
            { label: 'Удалить', danger: true, disabled: archive.isPending, onClick: () => { void confirm({ message: `Удалить шаблон «${template.name}»? Уже назначенные тренировки не изменятся.`, confirmLabel: 'Удалить', danger: true }).then((ok) => ok && archive.mutate(template)) } },
          ]} />
        </div>
        <p className="template-exercise-preview">{template.exercises.slice(0, 3).map((exercise) => exercise.name).join(' · ')}{template.exercises.length > 3 ? ` · ещё ${template.exercises.length - 3}` : ''}</p>
        <div className="template-card-footer"><span>Обновлён {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(template.updatedAt))}</span>
          {context ? <button type="button" className="secondary" onClick={() => { try { applyCreatedTemplate(context, template); returnToTemplatePlan(context, navigate) } catch (error) { setReturnError(error instanceof Error ? error.message : 'Не удалось добавить шаблон') } }}>Добавить в план</button> : <Link className="button secondary" to={`/workouts/new?${new URLSearchParams({ template: template.id, ...(assignmentDate ? { date: assignmentDate } : {}) })}`} state={{ returnTo: calendarBack }}><ScheduleIcon />Назначить</Link>}</div>
      </article>)}</div> : <WorkoutTemplateSearchEmpty /> : <EmptyState title="Создайте первый шаблон" description="Соберите тренировку с нуля или сохраните готовый план клиента."
        action={<div className="template-empty-actions"><Link className="button primary" to="/schedule/templates/new/editor" state={context ? { templatePlanContext: context } : undefined}>Создать с нуля</Link><Link className="button secondary" to="/schedule/templates/from-workout" state={context ? { templatePlanContext: context } : undefined}><CopyIcon />Из тренировки</Link></div>} />}
      {returnError && <p role="alert" className="error">{returnError}</p>}
      {(duplicate.error || archive.error) && <InlineRequestError error={(duplicate.error ?? archive.error)!} />}
    </AsyncView>
    {confirmDialog}
  </Page>
}

export function WorkoutTemplateCreatePage() {
  return <Navigate to="/schedule/templates/new/editor" replace />
}

export function WorkoutTemplateSourcePage() {
  const { actor } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const context = actor ? readTemplatePlanContext((location.state as { templatePlanContext?: unknown } | null)?.templatePlanContext, actor.userId) : undefined
  const { workouts, clients: clientsRepository } = useDataBackend()
  const [clientId, setClientId] = useState('')
  const clients = useQuery({ queryKey: ['clients', true], queryFn: () => clientsRepository.list(true) })
  const query = useInfiniteQuery({
    queryKey: ['workouts', 'template-source', clientId], initialPageParam: 0,
    queryFn: ({ pageParam }) => workouts.listPage(undefined, undefined, clientId || undefined, pageParam, 20),
    getNextPageParam: page => page.nextOffset,
  })
  const visible = query.data?.pages.flatMap(page => page.items).filter(workout => workout.exercises.length > 0) ?? []
  const state = context ? { templatePlanContext: context } : undefined
  return <Page className="workout-template-source-page" title="Выберите тренировку" back="/schedule/templates" onBack={context ? () => navigate('/schedule/templates', { state }) : undefined}>
    <Field label="Клиент"><select value={clientId} onChange={event => setClientId(event.target.value)}><option value="">Все клиенты</option>{clients.data?.map(client => <option value={client.id} key={client.id}>{client.fullName}</option>)}</select></Field>
    <AsyncView loading={query.isLoading || clients.isLoading} error={query.error ?? clients.error} onRetry={() => { void query.refetch(); void clients.refetch() }}>
      {visible.length > 0 ? <div className="template-source-workouts">{visible.map(workout => <Link className="template-source-workout" key={workout.id} to={`/schedule/templates/new/editor?sourceWorkout=${workout.id}`} state={state}>
        <span className="template-source-copy"><strong>{workoutDisplayTitle(workout)}</strong><small>{workout.clientName} · {formatLocalDate(workout.workoutDate)}</small>{workout.trainerReview && <span className="workout-source-review"><span className="workout-source-review-label">Отзыв тренера</span>{workout.trainerReview}</span>}<span className="template-source-exercises">{workoutExerciseBrief(workout.exercises)}</span></span><span>Выбрать</span>
      </Link>)}</div> : query.hasNextPage ? <p role="status">В этой части истории нет тренировок с упражнениями. Загрузите следующую.</p> : <EmptyState title="Нет тренировок для основы" description="Создайте шаблон с нуля — тренировку клиента можно сохранить позже." action={<Link className="button primary" to="/schedule/templates/new/editor" state={state}>Создать с нуля</Link>} />}
      <LoadMoreButton hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onLoadMore={() => void query.fetchNextPage()} />
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
  const location = useLocation()
  const context = actor ? readTemplatePlanContext((location.state as { templatePlanContext?: unknown } | null)?.templatePlanContext, actor.userId) : undefined
  const libraryOrigin = (location.state as { templateLibraryReturn?: { context?: unknown; index?: number } } | null)?.templateLibraryReturn
  const libraryContext = actor ? readTemplatePlanContext(libraryOrigin?.context, actor.userId) : undefined
  const libraryReturn = libraryContext ? { context: libraryContext, index: libraryOrigin?.index } : undefined
  const librarySearchValue = (location.state as { templateLibrarySearch?: unknown } | null)?.templateLibrarySearch
  const librarySearch = typeof librarySearchValue === 'string' ? librarySearchValue : ''
  const origin = location.state as { templateWorkoutReturnTo?: unknown; templateWorkoutReturnState?: WorkoutNavigationState; templateWorkoutReturnHistoryIndex?: number } | null
  const returnTo = safeWorkoutReturnTo(origin?.templateWorkoutReturnTo)
  const workoutReturn = sourceWorkoutId && returnTo?.split('?')[0] === `/workouts/${sourceWorkoutId}` ? { to: returnTo, state: origin?.templateWorkoutReturnState, index: origin?.templateWorkoutReturnHistoryIndex } : undefined
  if (!actor || actor.role !== 'trainer') return null
  const draftKey = workoutTemplateDraftKey(actor.userId, templateId, sourceWorkoutId) + (context ? `.plan:${context.draftKey}` : '')
  return <WorkoutTemplateEditor key={draftKey} templateId={templateId} sourceWorkoutId={sourceWorkoutId} draftKey={draftKey} context={context} libraryReturn={libraryReturn} librarySearch={librarySearch} workoutReturn={workoutReturn} />
}

function WorkoutTemplateEditor({ templateId, sourceWorkoutId, draftKey, context, workoutReturn, libraryReturn, librarySearch }: { templateId?: string; sourceWorkoutId: string; draftKey: string; context?: TemplatePlanContext; libraryReturn?: { context: TemplatePlanContext; index?: number }; librarySearch: string; workoutReturn?: { to: string; state?: WorkoutNavigationState; index?: number } }) {
  const { actor } = useAuth()
  const { exercises: exercisesRepository, workoutTemplates, workouts } = useDataBackend()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const catalog = useExerciseCatalog()
  const templateQuery = useQuery({ queryKey: ['workout-template', templateId], queryFn: () => workoutTemplates.get(templateId!), enabled: Boolean(templateId), staleTime: 0, refetchOnMount: 'always' })
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
  const submitting = useRef(false)
  const submittedRevision = useRef<string | null>(null)
  const [entryBusy, setEntryBusy] = useState(false)
  const [notesBusy, setNotesBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  useEffect(() => {
    if (ready || !storedDraft && templateQuery.isFetching || templateQuery.isLoading || sourceQuery.isLoading || templateQuery.error || sourceQuery.error) return
    const plan = context && !context.applyOnSave ? readWorkoutFormDraft(context.draftKey) : null
    const planCopy = plan ? cloneWorkoutTemplate({ name: plan.title?.trim() || 'Новый шаблон', notes: plan.notes, exercises: plan.exercises }) : null
    const initial = storedDraft ?? templateQuery.data ?? (sourceQuery.data ? workoutTemplateFromWorkout(sourceQuery.data) : planCopy ? { ...planCopy, name: plan!.title?.trim() || 'Новый шаблон' } : null)
    if (initial) { setName(initial.name); setNotes(initial.notes ?? ''); setExercises(initial.exercises) }
    setBaseVersion(initial?.version)
    setDirty(Boolean(storedDraft || planCopy))
    setReady(true)
  }, [ready, storedDraft, context, sourceQuery.data, sourceQuery.isLoading, sourceQuery.error, templateQuery.isFetching, templateQuery.data, templateQuery.isLoading, templateQuery.error])
  useEffect(() => {
    if (!ready || !dirty || finished.current) return
    setDraftStorageError(!writeWorkoutTemplateDraft(draftKey, { id: templateId ?? newTemplateId, name, notes, exercises, version: baseVersion }))
  }, [ready, dirty, draftKey, templateId, newTemplateId, name, notes, exercises, baseVersion])
  const save = useMutation({
    mutationFn: (draft: WorkoutTemplateDraft) => workoutTemplates.save(draft),
    onSuccess: async (savedId, savedDraft) => {
      if (active.current && context) applyCreatedTemplate(context, { ...savedDraft, id: savedId })
      finished.current = true
      if (JSON.stringify(readWorkoutTemplateDraft(draftKey)) === submittedRevision.current) removeWorkoutTemplateDraft(draftKey)
      if (!active.current) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workout-template', savedId], exact: true, refetchType: 'none' }),
        queryClient.invalidateQueries({ queryKey: ['workout-templates'] }),
      ])
      if (active.current) returnToOrigin(true)
    },
    onSettled: () => { submitting.current = false },
  })
  function returnToOrigin(replace = false) {
    if (context) { returnToTemplatePlan(context, navigate, replace); return }
    const steps = templateReturnSteps(workoutReturn?.index ?? libraryReturn?.index)
    if (steps) navigate(-steps)
    else navigate(workoutReturn?.to ?? `/schedule/templates${librarySearch ? `?${new URLSearchParams({ q: librarySearch })}` : ''}`, { replace, state: workoutReturn?.state ?? (libraryReturn ? { templatePlanContext: libraryReturn.context } : undefined) })
  }
  function closePicker() { setPickerOpen(false); setPickerSearch(''); setReplaceIndex(null) }
  const [confirmLeave, confirmLeaveDialog] = useConfirm()
  async function leaveForm() {
    if (submitting.current || entryBusy || notesBusy) return
    if (dirty) {
      const shouldLeave = await confirmLeave({ message: 'Выйти из шаблона? Несохранённые изменения будут удалены.', confirmLabel: 'Выйти', danger: true })
      if (!shouldLeave) return
    }
    finished.current = true
    removeWorkoutTemplateDraft(draftKey)
    returnToOrigin()
  }
  function pick(selected: ExerciseSnapshot) {
    if (submitting.current) return
    setExercises((current) => replaceIndex === null
      ? [...current, blankExercise(selected, current.length)]
      : replaceExercise(current, replaceIndex, selected))
    setDirty(true)
    closePicker()
  }
  function pickMany(selected: ExerciseSnapshot[]) {
    if (submitting.current) return
    setExercises((current) => [...current, ...selected.map((exercise, index) => blankExercise(exercise, current.length + index))])
    setDirty(true)
    closePicker()
  }
  function quickAdd(items: ParsedWorkoutExercise[]) {
    if (submitting.current) return false
    setExercises((current) => [...current, ...items.map((item, index) => ({
      ...blankExercise(item.exercise, current.length + index),
      ...item.structure,
      sets: item.hasValues ? item.sets : [{ position: 0 }],
    }))])
    setDirty(true)
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current || entryBusy || notesBusy || pickerOpen || !name.trim() || !exercises.length) return
    setDirty(true)
    const localRevision = { id: templateId ?? newTemplateId, name, notes, exercises, version: baseVersion }
    submittedRevision.current = JSON.stringify(localRevision)
    setDraftStorageError(!writeWorkoutTemplateDraft(draftKey, localRevision))
    submitting.current = true
    save.mutate({ id: templateId ?? newTemplateId, name: name.trim(), notes: notes.trim() || undefined, exercises, version: baseVersion })
  }
  const error = templateQuery.error ?? sourceQuery.error
  const pageTitle = templateId ? 'Редактировать шаблон' : 'Новый шаблон'
  const headerMeta = exercises.length > 0 ? templateMeta(exercises) : 'Сначала добавьте упражнения'
  return <Page className="workout-template-editor-page workout-form-page workout-focused-page" title={pageTitle} hideTitle back={-1} onBack={() => void leaveForm()}>
    <WorkoutHeader eyebrow="ШАБЛОН ТРЕНИРОВКИ" title={pageTitle} meta={headerMeta} state="planned" showStatus={false} />
    <AsyncView loading={!ready && !error} error={error} onRetry={() => { if (templateId) void templateQuery.refetch(); if (sourceWorkoutId) void sourceQuery.refetch() }}>
      <form className="stack workout-form workout-template-form" onSubmit={submit}>
        <fieldset disabled={save.isPending} style={{ display: 'contents' }}>
        <section className="workout-form-section template-basics"><Field label="Название шаблона"><input value={name} onChange={(event) => { setName(event.target.value); setDirty(true) }} placeholder="Например, Силовая · всё тело" maxLength={120} required /></Field>
          <details className="workout-notes" open={Boolean(notes)}>
            <summary>Заметка для спортсмена <span>Необязательно</span></summary>
            <VoiceNoteField disabled={save.isPending} onBusyChange={setNotesBusy} name="notes" source="workout_template_form" value={notes} onValueChange={(value) => { setNotes(value); setDirty(true) }} placeholder="Общие подсказки к тренировке" hideLabel />
          </details>
        </section>
        <section className="workout-form-section workout-form-exercises"><div className="workout-form-section-head workout-form-exercise-heading"><h2>Упражнения</h2><span>{templateMeta(exercises)}</span></div>
          <QuickWorkoutEntry disabled={save.isPending} onBusyChange={setEntryBusy} methods={isFitLimeEnabled(actor) ? { onExercise: () => { setReplaceIndex(null); setPickerSearch(''); setPickerOpen(true) } } : undefined} catalog={catalog.exercises} parseWorkout={(text, systemCatalog) => exercisesRepository.parseWorkout(text, systemCatalog)} onAdd={quickAdd} compact={exercises.length > 0} onOpenCatalog={exercises.length === 0 ? (search) => { setPickerSearch(search); setPickerOpen(true) } : undefined} />
          {!exercises.length && <p className="workout-empty-hint">Добавьте хотя бы одно упражнение — голосом, текстом или из каталога.</p>}
          <WorkoutExerciseEditor disabled={save.isPending} exercises={exercises} onChange={(next) => { if (!submitting.current) { setExercises(next); setDirty(true) } }} onOpenPicker={() => setPickerOpen(true)} onReplaceExercise={(index) => { setReplaceIndex(index); setPickerOpen(true) }} hideEmptyAddAction collapseInitialExercises={Boolean(templateId || sourceWorkoutId)} initialExercisesReady={ready} />
        </section>
        {save.error && <InlineRequestError error={save.error} />}
        {draftStorageError && <p className="error" role="alert">Не удалось сохранить черновик на устройстве. Не закрывайте экран до сохранения шаблона.</p>}
        <div className="actions workout-action-row"><WorkoutCta type="submit" pending={save.isPending} pendingLabel="Сохраняем…" disabled={entryBusy || notesBusy || pickerOpen || !name.trim() || !exercises.length}>{context?.applyOnSave ? 'Сохранить и добавить в план' : 'Сохранить шаблон'}</WorkoutCta></div>
        </fieldset>
        {(entryBusy || notesBusy) && <p role="status">Завершите ввод перед сохранением шаблона.</p>}
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
