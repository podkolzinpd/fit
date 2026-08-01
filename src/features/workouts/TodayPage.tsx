import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { workoutsRepository } from '../../data/repositories/workouts.repository'
import type { ExerciseSnapshot, WorkoutDraft, WorkoutSetDraft } from '../../shared/domain'
import { todayLocalDate } from '../../shared/local-date'
import { trackGoal } from '../../shared/yandex-metrika'
import { Page } from '../../shared/ui'
import { ExercisePicker, useExerciseCatalog } from '../exercises'
import { VoiceNoteField } from '../voice-input'
import { useAuth } from '../../app/auth-context'
import { parseQuickWorkoutEntry, resolveQuickWorkoutLine, type ParsedWorkoutExercise } from './quick-workout-entry'
import { readTodayDraft, removeTodayDraft, todayDraftKey, writeTodayDraft } from './today-draft'

type Screen = 'compose' | 'review'

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
    sets: item.sets.length ? item.sets : [{ position: 0 }],
  }
}

export function TodayPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { actor } = useAuth()
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false) })
  const catalog = useExerciseCatalog()
  const [screen, setScreen] = useState<Screen>('compose')
  const [text, setText] = useState('')
  const [choices, setChoices] = useState<Record<string, ExerciseSnapshot>>({})
  const [items, setItems] = useState<ParsedWorkoutExercise[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const [clientId, setClientId] = useState('')
  const [quickClientName, setQuickClientName] = useState('')
  const [manualRefs, setManualRefs] = useState<string[]>([])
  const [removedRefs, setRemovedRefs] = useState<string[]>([])
  const [draftReady, setDraftReady] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const inputStarted = useRef(false)
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
      setManualRefs(draft.manualRefs ?? [])
      setRemovedRefs(draft.removedRefs ?? [])
      setDraftRestored(true)
    }
    setDraftReady(true)
  }, [draftKey])

  useEffect(() => {
    if (!draftReady) return
    if (!text.trim() && !items.length) {
      removeTodayDraft(draftKey)
      return
    }
    writeTodayDraft(draftKey, { screen, text, choices, items, clientId, manualRefs, removedRefs })
  }, [choices, clientId, draftKey, draftReady, items, manualRefs, removedRefs, screen, text])

  const parsed = useMemo(() => parseQuickWorkoutEntry(text, catalog.exercises), [catalog.exercises, text])
  const resolved = useMemo(() => [
    ...parsed.parsed,
    ...parsed.unparsed.flatMap((item) => choices[item.line] ? [resolveQuickWorkoutLine(item.line, choices[item.line]!)] : []),
  ], [choices, parsed])
  const noMatches = Boolean(text.trim() && !resolved.length && parsed.unparsed.length)

  useEffect(() => {
    if (text.trim() && !inputStarted.current) {
      inputStarted.current = true
      trackGoal('today_input_started')
    }
    if (noMatches && lastEmptyText.current !== text) {
      lastEmptyText.current = text
      trackGoal('today_parse_empty')
    }
  }, [noMatches, text])
  const save = useMutation({
    mutationFn: async () => workoutsRepository.saveCompleted({
      clientId,
      workoutDate: todayLocalDate(),
      exercises: items.map(draftExercise),
    }),
    onMutate: () => trackGoal('today_workout_save_started'),
    onSuccess: async (id) => {
      trackGoal('today_workout_saved')
      setDraftReady(false)
      removeTodayDraft(draftKey)
      await queryClient.invalidateQueries({ queryKey: ['workouts'] })
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
    if (!resolved.length) return
    trackGoal(items.length ? 'today_reparse_success' : 'today_parse_success')
    const currentByRef = new Map(items.map((item) => [item.exercise.ref, item]))
    const rebuilt = resolved
      .filter((item) => !removedRefs.includes(item.exercise.ref))
      .map((item) => manualRefs.includes(item.exercise.ref) ? currentByRef.get(item.exercise.ref) ?? item : item)
    const manualOnly = items.filter((item) => manualRefs.includes(item.exercise.ref) && !rebuilt.some((rebuiltItem) => rebuiltItem.exercise.ref === item.exercise.ref))
    setItems([...rebuilt, ...manualOnly])
    setScreen('review')
  }

  function addExercises(exercises: ExerciseSnapshot[]) {
    setManualRefs((current) => [...new Set([...current, ...exercises.map((exercise) => exercise.ref)])])
    setItems((current) => [...current, ...exercises.map((exercise) => ({
      line: exercise.name,
      exercise,
      sets: [{ position: 0 }],
      hasValues: false,
    }))])
    setPickerOpen(false)
  }

  function pickExercises(exercises: ExerciseSnapshot[]) {
    if (replaceIndex === null) { addExercises(exercises); return }
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
    setItems((current) => current.map((item, index) => index !== itemIndex ? item : {
      ...item,
      hasValues: true,
      sets: item.sets.map((set, currentSetIndex) => currentSetIndex === setIndex ? { ...set, ...patch } : set),
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
    setManualRefs([])
    setRemovedRefs([])
    setDraftRestored(false)
  }

  return <Page title="Сегодня" className="today-page" hideTitle action={<Link className="button secondary today-clients" to="/clients">Клиенты</Link>}>
    {draftRestored && <div className="today-draft-notice" role="status"><span><strong>Черновик восстановлен</strong><small>Можно продолжить с того же места.</small></span><button type="button" className="link" onClick={discardDraft}>Удалить</button></div>}
    {screen === 'compose' ? <section className="today-composer">
      <div className="today-hero">
        <p className="eyebrow">Быстрый старт</p>
        <h1>Запишите тренировку<br />в одном сообщении</h1>
        <p>Например: «Присед 3×8 80 кг, затем планка 3 по 45 сек».</p>
      </div>
      <VoiceNoteField name="today-workout" source="today_workout" label="Тренировка" voiceLabel="Надиктовать · beta" value={text} onValueChange={setText} />
      <p className="today-hint">Голосовой ввод пока в beta: перед сохранением проверьте результат.</p>
      {items.length > 0 && <p className="today-hint">Ручные правки подходов и добавленные упражнения сохранятся при повторном разборе.</p>}
      {text.trim() && <div className="today-parse-preview" aria-live="polite">
        {resolved.length > 0 && <p><strong>Найдены упражнения: {resolved.length}</strong></p>}
        {parsed.unparsed.map((item) => <div className="today-unparsed" key={item.line}>
          <p>«{item.line}» — {item.reason === 'ambiguous' ? 'выберите вариант' : 'не нашли в каталоге'}</p>
          {item.candidates.length > 0 && <div className="quick-workout-candidates">{item.candidates.map((exercise) => <button type="button" className={choices[item.line]?.ref === exercise.ref ? 'secondary selected' : 'secondary'} key={exercise.ref} onClick={() => setChoices((current) => ({ ...current, [item.line]: exercise }))}>{exercise.name}</button>)}</div>}
        </div>)}
      </div>}
      {noMatches && <div className="today-empty-parse" role="status"><strong>Не нашли упражнение</strong><span>Проверьте название или добавьте его из каталога ниже.</span></div>}
      <button type="button" className="wide" disabled={!resolved.length} onClick={review}>Разобрать тренировку{resolved.length ? ` (${resolved.length})` : ''}</button>
      <button type="button" className="secondary wide" onClick={() => { setItems([]); setScreen('review') }}>Выбрать упражнения из библиотеки</button>
    </section> : <section className="today-review">
      <div className="today-review-head"><div><p className="eyebrow">Проверьте результат</p><h1>Тренировка готова</h1></div><button type="button" className="link" onClick={() => setScreen('compose')}>Изменить текст</button></div>
      {items.length > 0 ? <div className="today-exercise-list">{items.map((item, index) => <article className="today-exercise" key={`${item.exercise.ref}-${index}`}>
        <div className="today-exercise-title"><div><strong>{item.exercise.name}</strong><p>{setSummary(item)}</p></div><button type="button" className="icon-button" aria-label={`Удалить ${item.exercise.name}`} onClick={() => { setRemovedRefs((current) => current.includes(item.exercise.ref) ? current : [...current, item.exercise.ref]); setItems((current) => current.filter((_, itemIndex) => itemIndex !== index)) }}>×</button></div>
        <details className="today-exercise-editor"><summary>Править</summary><button type="button" className="link" onClick={() => { setReplaceIndex(index); setPickerOpen(true) }}>Заменить упражнение</button><div className="today-set-list">{item.sets.map((set, setIndex) => <div className="today-set-editor" key={set.position}><strong>{setIndex + 1}</strong>{item.exercise.inputKind === 'strength' && <><label>Кг<input aria-label={`${item.exercise.name}: вес, подход ${setIndex + 1}`} type="number" inputMode="decimal" value={set.weightKg ?? ''} onChange={(event) => updateSet(index, setIndex, { weightKg: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><label>Повт.<input aria-label={`${item.exercise.name}: повторы, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.reps ?? ''} onChange={(event) => updateSet(index, setIndex, { reps: event.target.value === '' ? undefined : Number(event.target.value) })} /></label></>}{item.exercise.inputKind === 'duration' && <label>Сек.<input aria-label={`${item.exercise.name}: секунды, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.durationSec ?? ''} onChange={(event) => updateSet(index, setIndex, { durationSec: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}{item.exercise.inputKind === 'reps' && <label>Повт.<input aria-label={`${item.exercise.name}: повторы, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.reps ?? ''} onChange={(event) => updateSet(index, setIndex, { reps: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}{item.exercise.inputKind === 'distance' && <label>Км<input aria-label={`${item.exercise.name}: километры, подход ${setIndex + 1}`} type="number" inputMode="decimal" value={set.distanceKm ?? ''} onChange={(event) => updateSet(index, setIndex, { distanceKm: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}<label>RPE<input aria-label={`${item.exercise.name}: RPE, подход ${setIndex + 1}`} type="number" min="1" max="10" step="0.5" inputMode="decimal" value={set.rpe ?? ''} onChange={(event) => updateSet(index, setIndex, { rpe: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>{item.sets.length > 1 && <button type="button" className="link danger" aria-label={`Удалить подход ${setIndex + 1}`} onClick={() => removeSet(index, setIndex)}>×</button>}</div>)}</div><button type="button" className="secondary today-add-set" onClick={() => addSet(index)}>＋ Подход</button></details>
      </article>)}</div> : <div className="today-empty"><p>Добавьте упражнения из каталога — можно выбрать несколько сразу.</p></div>}
      <button type="button" className="secondary wide" onClick={() => { setReplaceIndex(null); setPickerOpen(true) }}>Добавить упражнение</button>
      <label className="today-client"><span>Кому записать тренировку</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Выберите клиента</option>{clients.data?.map((client) => <option value={client.id} key={client.id}>{client.fullName}</option>)}</select></label>
      <section className="today-quick-client"><div><strong>Нет клиента в списке?</strong><p>Создайте короткую карточку только по имени — остальное добавите позже.</p></div><div className="today-quick-client-form"><input aria-label="Имя нового клиента" value={quickClientName} onChange={(event) => setQuickClientName(event.target.value)} placeholder="Имя клиента" /><button type="button" className="secondary" disabled={quickClientName.trim().length < 2 || createQuickClient.isPending} onClick={() => createQuickClient.mutate()}>Создать</button></div>{createQuickClient.error && <p className="error">{createQuickClient.error.message}</p>}</section>
      {save.error && <p className="error">{save.error.message}</p>}
      <button type="button" className="wide" disabled={!items.length || !clientId || save.isPending} onClick={() => save.mutate()}>Записать завершённую тренировку</button>
    </section>}
    {(clients.error ?? catalog.error) && <p className="error">{(clients.error ?? catalog.error)?.message}</p>}
    {pickerOpen && <ExercisePicker catalog={catalog} onPick={(exercise) => pickExercises([exercise])} onPickMany={pickExercises} multiple={replaceIndex === null} onClose={() => { setPickerOpen(false); setReplaceIndex(null) }} />}
  </Page>
}
