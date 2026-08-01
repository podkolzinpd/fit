import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { workoutsRepository } from '../../data/repositories/workouts.repository'
import type { ExerciseSnapshot, WorkoutDraft } from '../../shared/domain'
import { todayLocalDate } from '../../shared/local-date'
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
  const [clientId, setClientId] = useState('')
  const [quickClientName, setQuickClientName] = useState('')
  const [draftReady, setDraftReady] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const draftKey = todayDraftKey(actor!.userId)

  useEffect(() => {
    const draft = readTodayDraft(draftKey)
    if (draft) {
      setScreen(draft.screen)
      setText(draft.text)
      setChoices(draft.choices)
      setItems(draft.items)
      setClientId(draft.clientId)
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
    writeTodayDraft(draftKey, { screen, text, choices, items, clientId })
  }, [choices, clientId, draftKey, draftReady, items, screen, text])

  const parsed = useMemo(() => parseQuickWorkoutEntry(text, catalog.exercises), [catalog.exercises, text])
  const resolved = useMemo(() => [
    ...parsed.parsed,
    ...parsed.unparsed.flatMap((item) => choices[item.line] ? [resolveQuickWorkoutLine(item.line, choices[item.line]!)] : []),
  ], [choices, parsed])
  const save = useMutation({
    mutationFn: async () => workoutsRepository.saveCompleted({
      clientId,
      workoutDate: todayLocalDate(),
      exercises: items.map(draftExercise),
    }),
    onSuccess: async (id) => {
      setDraftReady(false)
      removeTodayDraft(draftKey)
      await queryClient.invalidateQueries({ queryKey: ['workouts'] })
      navigate(`/workouts/${id}`)
    },
  })
  const createQuickClient = useMutation({
    mutationFn: () => clientsRepository.createQuick(quickClientName.trim()),
    onSuccess: async (id) => {
      setClientId(id)
      setQuickClientName('')
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
  })

  function review() {
    if (!resolved.length) return
    setItems(resolved)
    setScreen('review')
  }

  function addExercises(exercises: ExerciseSnapshot[]) {
    setItems((current) => [...current, ...exercises.map((exercise) => ({
      line: exercise.name,
      exercise,
      sets: [{ position: 0 }],
      hasValues: false,
    }))])
    setPickerOpen(false)
  }

  function discardDraft() {
    removeTodayDraft(draftKey)
    setScreen('compose')
    setText('')
    setChoices({})
    setItems([])
    setClientId('')
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
      {text.trim() && <div className="today-parse-preview" aria-live="polite">
        {resolved.length > 0 && <p><strong>Найдены упражнения: {resolved.length}</strong></p>}
        {parsed.unparsed.map((item) => <div className="today-unparsed" key={item.line}>
          <p>«{item.line}» — {item.reason === 'ambiguous' ? 'выберите вариант' : 'не нашли в каталоге'}</p>
          {item.candidates.length > 0 && <div className="quick-workout-candidates">{item.candidates.map((exercise) => <button type="button" className={choices[item.line]?.ref === exercise.ref ? 'secondary selected' : 'secondary'} key={exercise.ref} onClick={() => setChoices((current) => ({ ...current, [item.line]: exercise }))}>{exercise.name}</button>)}</div>}
        </div>)}
      </div>}
      <button type="button" className="wide" disabled={!resolved.length} onClick={review}>Разобрать тренировку{resolved.length ? ` (${resolved.length})` : ''}</button>
      <button type="button" className="secondary wide" onClick={() => { setItems([]); setScreen('review') }}>Выбрать упражнения из библиотеки</button>
    </section> : <section className="today-review">
      <div className="today-review-head"><div><p className="eyebrow">Проверьте результат</p><h1>Тренировка готова</h1></div><button type="button" className="link" onClick={() => setScreen('compose')}>Изменить текст</button></div>
      {items.length > 0 ? <div className="today-exercise-list">{items.map((item, index) => <article className="today-exercise" key={`${item.exercise.ref}-${index}`}>
        <div><strong>{item.exercise.name}</strong><p>{setSummary(item)}</p></div>
        <button type="button" className="icon-button" aria-label={`Удалить ${item.exercise.name}`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
      </article>)}</div> : <div className="today-empty"><p>Добавьте упражнения из каталога — можно выбрать несколько сразу.</p></div>}
      <button type="button" className="secondary wide" onClick={() => setPickerOpen(true)}>Добавить упражнение</button>
      <label className="today-client"><span>Кому записать тренировку</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Выберите клиента</option>{clients.data?.map((client) => <option value={client.id} key={client.id}>{client.fullName}</option>)}</select></label>
      <section className="today-quick-client"><div><strong>Нет клиента в списке?</strong><p>Создайте короткую карточку только по имени — остальное добавите позже.</p></div><div className="today-quick-client-form"><input aria-label="Имя нового клиента" value={quickClientName} onChange={(event) => setQuickClientName(event.target.value)} placeholder="Имя клиента" /><button type="button" className="secondary" disabled={quickClientName.trim().length < 2 || createQuickClient.isPending} onClick={() => createQuickClient.mutate()}>Создать</button></div>{createQuickClient.error && <p className="error">{createQuickClient.error.message}</p>}</section>
      {save.error && <p className="error">{save.error.message}</p>}
      <button type="button" className="wide" disabled={!items.length || !clientId || save.isPending} onClick={() => save.mutate()}>Записать завершённую тренировку</button>
    </section>}
    {(clients.error ?? catalog.error) && <p className="error">{(clients.error ?? catalog.error)?.message}</p>}
    {pickerOpen && <ExercisePicker catalog={catalog} onPick={(exercise) => addExercises([exercise])} onPickMany={addExercises} multiple onClose={() => setPickerOpen(false)} />}
  </Page>
}
