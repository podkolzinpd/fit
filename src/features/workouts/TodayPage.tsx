import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { workoutsRepository, type PreviousExerciseResult } from '../../data/repositories/workouts.repository'
import type { ExerciseSnapshot, Workout, WorkoutDraft, WorkoutSetDraft } from '../../shared/domain'
import { localDate, todayLocalDate } from '../../shared/local-date'
import { isValidRpe } from '../../shared/rpe'
import { trackGoal } from '../../shared/yandex-metrika'
import { Page } from '../../shared/ui'
import { ExercisePicker, frequentExercisesForClient, useExerciseCatalog } from '../exercises'
import { VoiceNoteField } from '../voice-input'
import { useAuth } from '../../app/auth-context'
import { parseQuickWorkoutEntry, resolveQuickWorkoutLine, type ParsedWorkoutExercise } from './quick-workout-entry'
import { readTodayDraft, removeTodayDraft, todayDraftKey, writeTodayDraft } from './today-draft'
import { workoutDateForRecordMode, type WorkoutRecordMode } from './workout-entry-rules'

type Screen = 'compose' | 'review'
type RecordMode = WorkoutRecordMode

function setSummary(item: ParsedWorkoutExercise): string {
  const first = item.sets[0]
  if (!item.hasValues || !first) return 'без значений'
  if (first.durationSec !== undefined) return `${item.sets.length} × ${first.durationSec} сек`
  if (first.distanceKm !== undefined) return `${item.sets.length} × ${first.distanceKm} км`
  const value = [first.weightKg !== undefined ? `${first.weightKg} кг` : '', first.reps !== undefined ? `${first.reps} повт.` : ''].filter(Boolean).join(' × ')
  return `${item.sets.length} × ${value || 'значения'}`
}

function draftExercise(item: ParsedWorkoutExercise, position: number): WorkoutDraft['exercises'][number] {
  return {
    ...item.exercise,
    position,
    blockId: crypto.randomUUID(),
    blockType: 'single',
    blockRounds: 1,
    // Черновик мог быть создан до появления строгого ограничения RPE в БД.
    // Не даём старому значению сорвать сохранение всей тренировки.
    sets: (item.sets.length ? item.sets : [{ position: 0 }]).map((set) => ({
      ...set,
      ...(isValidRpe(set.rpe) ? {} : { rpe: undefined }),
    })),
  }
}

export function TodayPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { actor } = useAuth()
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false) })
  const today = todayLocalDate()
  const todayWorkouts = useQuery({ queryKey: ['today-workouts', today], queryFn: () => workoutsRepository.list(today, today) })
  const catalog = useExerciseCatalog()
  const [screen, setScreen] = useState<Screen>('compose')
  const [text, setText] = useState('')
  const [choices, setChoices] = useState<Record<string, ExerciseSnapshot>>({})
  const [items, setItems] = useState<ParsedWorkoutExercise[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const [clientId, setClientId] = useState('')
  const clientWorkouts = useQuery({ queryKey: ['client-exercises-frequency', clientId], queryFn: () => workoutsRepository.list(undefined, undefined, clientId), enabled: Boolean(clientId) })
  const [recordMode, setRecordMode] = useState<RecordMode>('planned')
  const [workoutDate, setWorkoutDate] = useState(today)
  const [startTime, setStartTime] = useState('')
  const [quickClientName, setQuickClientName] = useState('')
  const [prefillError, setPrefillError] = useState<string | null>(null)
  const [manualRefs, setManualRefs] = useState<string[]>([])
  const [removedRefs, setRemovedRefs] = useState<string[]>([])
  const [draftReady, setDraftReady] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const inputStarted = useRef(false)
  const openedTracked = useRef(false)
  const lastEmptyText = useRef('')
  const draftKey = todayDraftKey(actor!.userId)

  useEffect(() => {
    const draft = readTodayDraft(draftKey)
    if (draft) {
      setScreen(draft.screen)
      setText(draft.text)
      setChoices(draft.choices)
      setItems(draft.items)
      setClientId(draft.clientId)
      setRecordMode(draft.recordMode ?? 'planned')
      setWorkoutDate(workoutDateForRecordMode(draft.recordMode ?? 'planned', draft.workoutDate ? localDate(draft.workoutDate) : today, today))
      setStartTime(draft.startTime ?? '')
      setManualRefs(draft.manualRefs ?? [])
      setRemovedRefs(draft.removedRefs ?? [])
      setDraftRestored(true)
    }
    setDraftReady(true)
  }, [draftKey, today])

  useEffect(() => {
    if (!draftReady) return
    if (!text.trim() && !items.length) {
      removeTodayDraft(draftKey)
      return
    }
    writeTodayDraft(draftKey, { screen, text, choices, items, clientId, manualRefs, removedRefs, recordMode, workoutDate, startTime })
  }, [choices, clientId, draftKey, draftReady, items, manualRefs, recordMode, removedRefs, screen, startTime, text, workoutDate])

  const parsed = useMemo(() => parseQuickWorkoutEntry(text, catalog.exercises), [catalog.exercises, text])
  const resolved = useMemo(() => [
    ...parsed.parsed,
    ...parsed.unparsed.flatMap((item) => choices[item.line] ? [resolveQuickWorkoutLine(item.line, choices[item.line]!)] : []),
  ], [choices, parsed])
  const noMatches = Boolean(text.trim() && !resolved.length && parsed.unparsed.length)
  const frequentExercises = useMemo(() => frequentExercisesForClient(catalog.exercises, clientWorkouts.data ?? []), [catalog.exercises, clientWorkouts.data])

  useEffect(() => {
    if (!openedTracked.current) {
      openedTracked.current = true
      trackGoal('today_opened')
    }
  }, [])

  useEffect(() => {
    if (text.trim() && !inputStarted.current) {
      inputStarted.current = true
      trackGoal('today_input_started')
      trackGoal('workout_input_started')
    }
    if (noMatches && lastEmptyText.current !== text) {
      lastEmptyText.current = text
      trackGoal('today_parse_empty')
    }
  }, [noMatches, text])
  const save = useMutation({
    mutationFn: async (mode: RecordMode) => {
      const draft = { clientId, workoutDate, startTime: mode === 'planned' ? startTime || undefined : undefined, exercises: items.map(draftExercise) }
      return mode === 'planned' ? workoutsRepository.save(draft) : workoutsRepository.saveCompleted(draft)
    },
    onMutate: (mode) => trackGoal(mode === 'planned' ? 'today_plan_save_started' : 'today_workout_save_started'),
    onSuccess: async (id, mode) => {
      trackGoal(mode === 'planned' ? 'today_plan_saved' : 'today_workout_saved')
      trackGoal('today_review_confirmed')
      setDraftReady(false)
      removeTodayDraft(draftKey)
      await queryClient.invalidateQueries({ queryKey: ['workouts'] })
      await queryClient.invalidateQueries({ queryKey: ['today-workouts'] })
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      navigate(`/workouts/${id}`)
    }, onError: () => trackGoal('today_workout_save_error'),
  })
  const createQuickClient = useMutation({
    mutationFn: () => clientsRepository.createQuick(quickClientName.trim()),
    onSuccess: async (id) => {
      trackGoal('today_quick_client_created')
      setClientId(id)
      setQuickClientName('')
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
  })

  function review() {
    trackGoal('workout_parse_submitted')
    if (!resolved.length) {
      trackGoal('workout_parse_failed')
      return
    }
    trackGoal(items.length ? 'today_reparse_success' : 'today_parse_success')
    trackGoal('workout_parse_completed')
    const currentByRef = new Map(items.map((item) => [item.exercise.ref, item]))
    const rebuilt = resolved
      .filter((item) => !removedRefs.includes(item.exercise.ref))
      .map((item) => manualRefs.includes(item.exercise.ref) ? currentByRef.get(item.exercise.ref) ?? item : item)
    const manualOnly = items.filter((item) => manualRefs.includes(item.exercise.ref) && !rebuilt.some((rebuiltItem) => rebuiltItem.exercise.ref === item.exercise.ref))
    setItems([...rebuilt, ...manualOnly])
    setScreen('review')
    trackGoal('workout_review_opened')
  }

  async function previousResults(selected: ExerciseSnapshot[]): Promise<Map<string, PreviousExerciseResult>> {
    if (!clientId) return new Map()
    try {
      setPrefillError(null)
      return await workoutsRepository.latestExerciseResults(clientId, selected.map((exercise) => exercise.ref))
    } catch {
      setPrefillError('Не удалось подставить значения с прошлой тренировки')
      return new Map()
    }
  }

  async function addExercises(exercises: ExerciseSnapshot[]) {
    const results = await previousResults(exercises)
    setManualRefs((current) => [...new Set([...current, ...exercises.map((exercise) => exercise.ref)])])
    setItems((current) => [...current, ...exercises.map((exercise) => ({
      line: exercise.name,
      exercise,
      sets: results.get(exercise.ref)?.sets ?? [{ position: 0 }],
      hasValues: Boolean(results.get(exercise.ref)),
    }))])
    setPickerOpen(false)
  }

  async function pickExercises(exercises: ExerciseSnapshot[]) {
    if (replaceIndex === null) { await addExercises(exercises); return }
    const exercise = exercises[0]
    if (!exercise) return
    const replacedRef = items[replaceIndex]?.exercise.ref
    setItems((current) => current.map((item, index) => index === replaceIndex ? {
      ...item,
      line: exercise.name,
      exercise,
      sets: item.exercise.inputKind === exercise.inputKind ? item.sets : [{ position: 0 }],
      hasValues: item.exercise.inputKind === exercise.inputKind && item.hasValues,
    } : item))
    setManualRefs((current) => [...new Set([...current, exercise.ref])])
    if (replacedRef) setRemovedRefs((current) => current.includes(replacedRef) ? current : [...current, replacedRef])
    setReplaceIndex(null)
    setPickerOpen(false)
  }

  function updateSet(itemIndex: number, setIndex: number, patch: Partial<WorkoutSetDraft>) {
    trackGoal('today_review_edited')
    const ref = items[itemIndex]?.exercise.ref
    if (ref) setManualRefs((current) => current.includes(ref) ? current : [...current, ref])
    const safePatch = patch.rpe === undefined || isValidRpe(patch.rpe) ? patch : { ...patch, rpe: undefined }
    setItems((current) => current.map((item, index) => index !== itemIndex ? item : {
      ...item,
      hasValues: true,
      sets: item.sets.map((set, currentSetIndex) => currentSetIndex === setIndex ? { ...set, ...safePatch } : set),
    }))
  }

  function addSet(itemIndex: number) {
    const ref = items[itemIndex]?.exercise.ref
    if (ref) setManualRefs((current) => current.includes(ref) ? current : [...current, ref])
    setItems((current) => current.map((item, index) => {
      if (index !== itemIndex) return item
      const previous = item.sets.at(-1)
      const nextSet = previous ? { ...previous, position: item.sets.length } : { position: item.sets.length }
      return { ...item, sets: [...item.sets, nextSet], hasValues: item.hasValues }
    }))
  }

  function removeSet(itemIndex: number, setIndex: number) {
    const ref = items[itemIndex]?.exercise.ref
    if (ref) setManualRefs((current) => current.includes(ref) ? current : [...current, ref])
    setItems((current) => current.map((item, index) => index !== itemIndex ? item : {
      ...item,
      sets: item.sets.filter((_, currentSetIndex) => currentSetIndex !== setIndex).map((set, position) => ({ ...set, position })),
    }))
  }

  function discardDraft() {
    removeTodayDraft(draftKey)
    setScreen('compose')
    setText('')
    setChoices({})
    setItems([])
    setClientId('')
    setRecordMode('planned')
    setWorkoutDate(today)
    setStartTime('')
    setManualRefs([])
    setRemovedRefs([])
    setDraftRestored(false)
  }

  const currentWorkout = todayWorkouts.data?.find((workout) => workout.status === 'in_progress')
  const plannedWorkouts = todayWorkouts.data?.filter((workout) => workout.status === 'planned').sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '')) ?? []
  function workoutTime(workout: Workout) { return workout.startTime?.slice(0, 5) ?? 'Без времени' }

  const trainerInitial = actor?.firstName?.trim().slice(0, 1).toUpperCase() || 'П'
  const agenda = (currentWorkout || plannedWorkouts.length > 0) && <section className="today-agenda"><div className="today-agenda-head"><div><p className="eyebrow">Рабочий день</p><h2>На сегодня</h2></div><Link className="link" to="/schedule">Расписание</Link></div>{currentWorkout && <Link className="today-current-workout" to={`/workouts/${currentWorkout.id}/live`}><span><strong>Продолжить тренировку</strong><small>{currentWorkout.clientName} · {workoutTime(currentWorkout)}</small></span><b>→</b></Link>}{plannedWorkouts.slice(0, 3).map((workout) => <Link className="today-planned-workout" key={workout.id} to={`/workouts/${workout.id}`}><span>{workoutTime(workout)}</span><strong>{workout.clientName}</strong><small>{workout.exercises.length ? workout.exercises.map((exercise) => exercise.name).slice(0, 2).join(', ') : 'Без упражнений'}</small></Link>)}</section>
  const draftNotice = draftRestored && <div className="today-draft-notice" role="status"><span><strong>Черновик восстановлен</strong><small>Можно продолжить с того же места.</small></span><button type="button" className="link" onClick={discardDraft}>Удалить</button></div>

  return <Page title="Сегодня" className="today-page today-start-page" action={<Link className="today-profile-avatar" to="/profile" aria-label="Открыть профиль">{trainerInitial}</Link>}>
    {screen === 'compose' ? <section className="today-composer">
      <div className="today-hero">
        <h1>Новая тренировка</h1>
        <p>Напишите тренировку — мы разберём её по упражнениям и подходам.</p>
      </div>
      <div className="today-input-card">
        <VoiceNoteField name="today-workout" source="today_workout" label="Тренировка" voiceLabel="Надиктовать" voiceBeta placeholder={'Присед 3×8 — 80 кг\nПланка 3×45 сек'} value={text} onValueChange={setText} />
        {text && <div className="today-input-actions"><button type="button" className="link" onClick={() => setText('')}>Очистить</button></div>}
      </div>
      {items.length > 0 && <p className="today-hint">Ручные правки подходов и добавленные упражнения сохранятся при повторном разборе.</p>}
      {text.trim() && <div className="today-parse-preview" aria-live="polite">
        {resolved.length > 0 && <p><strong>Найдены упражнения: {resolved.length}</strong></p>}
        {parsed.unparsed.map((item) => <div className="today-unparsed" key={item.line}>
          <p>«{item.line}» — {item.reason === 'ambiguous' ? 'выберите вариант' : 'не нашли в каталоге'}</p>
          {item.candidates.length > 0 && <div className="quick-workout-candidates">{item.candidates.map((exercise) => <button type="button" className={choices[item.line]?.ref === exercise.ref ? 'secondary selected' : 'secondary'} key={exercise.ref} onClick={() => setChoices((current) => ({ ...current, [item.line]: exercise }))}>{exercise.name}</button>)}</div>}
        </div>)}
      </div>}
      {noMatches && <div className="today-empty-parse" role="status"><strong>Не нашли упражнение</strong><span>Проверьте название или добавьте его из каталога ниже.</span></div>}
      <button type="button" className="wide today-primary-cta" disabled={!text.trim()} onClick={review}>Разобрать тренировку</button>
      <button type="button" className="secondary wide today-picker-cta" onClick={() => { trackGoal('exercise_picker_opened'); setItems([]); setScreen('review') }}><span>Выбрать упражнения</span><small>Из каталога — можно несколько сразу</small></button>
    </section> : <section className="today-review">
      <div className="today-review-head"><div><h1>Проверьте тренировку</h1></div><button type="button" className="link" onClick={() => setScreen('compose')}>Изменить текст</button></div>
      {items.length > 0 ? <div className="today-exercise-list">{items.map((item, index) => <article className="today-exercise" key={`${item.exercise.ref}-${index}`}>
        <div className="today-exercise-title"><div><strong>{item.exercise.name}</strong><p>{setSummary(item)}</p></div><button type="button" className="icon-button" aria-label={`Удалить ${item.exercise.name}`} onClick={() => { setRemovedRefs((current) => current.includes(item.exercise.ref) ? current : [...current, item.exercise.ref]); setItems((current) => current.filter((_, itemIndex) => itemIndex !== index)) }}>×</button></div>
        <details className="today-exercise-editor"><summary>Править</summary><button type="button" className="link" onClick={() => { setReplaceIndex(index); setPickerOpen(true) }}>Заменить упражнение</button><div className="today-set-list">{item.sets.map((set, setIndex) => <div className="today-set-editor" key={set.position}><strong>{setIndex + 1}</strong>{item.exercise.inputKind === 'strength' && <><label>Кг<input aria-label={`${item.exercise.name}: вес, подход ${setIndex + 1}`} type="number" inputMode="decimal" value={set.weightKg ?? ''} onChange={(event) => updateSet(index, setIndex, { weightKg: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><label>Повт.<input aria-label={`${item.exercise.name}: повторы, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.reps ?? ''} onChange={(event) => updateSet(index, setIndex, { reps: event.target.value === '' ? undefined : Number(event.target.value) })} /></label></>}{item.exercise.inputKind === 'duration' && <label>Сек.<input aria-label={`${item.exercise.name}: секунды, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.durationSec ?? ''} onChange={(event) => updateSet(index, setIndex, { durationSec: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}{item.exercise.inputKind === 'reps' && <label>Повт.<input aria-label={`${item.exercise.name}: повторы, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.reps ?? ''} onChange={(event) => updateSet(index, setIndex, { reps: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}{item.exercise.inputKind === 'distance' && <label>Км<input aria-label={`${item.exercise.name}: километры, подход ${setIndex + 1}`} type="number" inputMode="decimal" value={set.distanceKm ?? ''} onChange={(event) => updateSet(index, setIndex, { distanceKm: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}<label>RPE<input aria-label={`${item.exercise.name}: RPE, подход ${setIndex + 1}`} type="number" min="1" max="10" step="0.5" inputMode="decimal" value={set.rpe ?? ''} onChange={(event) => updateSet(index, setIndex, { rpe: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>{item.sets.length > 1 && <button type="button" className="link danger" aria-label={`Удалить подход ${setIndex + 1}`} onClick={() => removeSet(index, setIndex)}>×</button>}</div>)}</div><button type="button" className="secondary today-add-set" onClick={() => addSet(index)}>＋ Подход</button></details>
      </article>)}</div> : <div className="today-empty"><p>Добавьте упражнения из каталога — можно выбрать несколько сразу.</p></div>}
      <button type="button" className="secondary wide" onClick={() => { setReplaceIndex(null); setPickerOpen(true) }}>Добавить упражнение</button>
      <label className="today-client"><span>Для кого тренировка</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Выберите клиента</option>{clients.data?.map((client) => <option value={client.id} key={client.id}>{client.fullName}</option>)}</select></label>
      {!clientId && <section className="today-quick-client"><div><strong>Нет клиента?</strong><p>Добавьте только имя — остальное можно заполнить позже.</p></div><div className="today-quick-client-form"><input aria-label="Имя нового клиента" value={quickClientName} onChange={(event) => setQuickClientName(event.target.value)} placeholder="Имя клиента" /><button type="button" className="secondary" disabled={quickClientName.trim().length < 2 || createQuickClient.isPending} onClick={() => createQuickClient.mutate()}>Создать</button></div>{createQuickClient.error && <p className="error">{createQuickClient.error.message}</p>}</section>}
      {(prefillError || save.error) && <p className="error">{prefillError ?? save.error?.message}</p>}
      <section className="today-save-actions" aria-label="Тип записи">
        <div className="today-record-mode" role="group" aria-label="Тип тренировки"><button type="button" className={recordMode === 'planned' ? 'active' : ''} aria-pressed={recordMode === 'planned'} onClick={() => setRecordMode('planned')}>План</button><button type="button" className={recordMode === 'completed' ? 'active' : ''} aria-pressed={recordMode === 'completed'} onClick={() => { setRecordMode('completed'); setWorkoutDate((date) => workoutDateForRecordMode('completed', date, today)) }}>Завершённая</button></div>
        <div className="split"><label className="today-date-field"><span>Дата</span><input aria-label="Дата тренировки" type="date" value={workoutDate} max={recordMode === 'completed' ? today : undefined} onChange={(event) => setWorkoutDate(localDate(event.target.value))} required /></label>{recordMode === 'planned' && <label className="today-date-field"><span>Время</span><input aria-label="Время тренировки" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>}</div>
        <button type="button" className="wide" disabled={!items.length || !clientId || save.isPending} onClick={() => save.mutate(recordMode)}>{recordMode === 'planned' ? 'Запланировать' : 'Записать как завершённую'}</button>
      </section>
    </section>}
    {screen === 'compose' && agenda}
    {draftNotice}
    {(clients.error ?? catalog.error ?? todayWorkouts.error) && <p className="error">{(clients.error ?? catalog.error ?? todayWorkouts.error)?.message}</p>}
    {pickerOpen && <ExercisePicker catalog={catalog} frequent={frequentExercises} onPick={(exercise) => pickExercises([exercise])} onPickMany={pickExercises} multiple={replaceIndex === null} onClose={() => { setPickerOpen(false); setReplaceIndex(null) }} />}
  </Page>
}
