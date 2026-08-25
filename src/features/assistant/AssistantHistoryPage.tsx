import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRightIcon } from '../../shared/icons'
import { useAuth } from '../../app/auth-context'
import { assistantRepository, type AssistantOrchestratorAction } from '../../data/repositories/assistant.repository'
import { trainingSummariesRepository } from '../../data/repositories/training-summaries.repository'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { VoiceInputButton } from '../voice-input'
import { clientSchema } from '../../shared/validation'
import { localDate, todayInTimeZone } from '../../shared/local-date'
import type { ExerciseSnapshot, WorkoutDraft } from '../../shared/domain'
import { workoutsRepository } from '../../data/repositories/workouts.repository'
import { filterExercises, useExerciseCatalog } from '../exercises'
import { WorkoutComposer } from '../workouts/WorkoutComposer'
import { formatLlmWorkoutText, parseWorkoutWithLlm } from '../workouts/llm-workout-parser'
import type { WorkoutParseResponse } from '../../data/repositories/exercises.repository'

type Message = { id: string; author: string; content: string; action: AssistantOrchestratorAction | null }

export function AssistantHistoryPage() {
  const { actor } = useAuth()
  const queryClient = useQueryClient()
  const [conversationId, setConversationId] = useState<string>()
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const [sending, setSending] = useState(false)
  const [runningSummaryIds, setRunningSummaryIds] = useState<string[]>([])
  const [completedSummaryIds, setCompletedSummaryIds] = useState<string[]>([])
  const [runningClientIds, setRunningClientIds] = useState<string[]>([])
  const [completedClientIds, setCompletedClientIds] = useState<string[]>([])
  const latestAssistantMessage = [...messages].reverse().find((message) => message.author === 'assistant')
  const activeActionId = latestAssistantMessage?.action ? latestAssistantMessage.id : undefined

  useEffect(() => {
    if (!actor) return
    void (async () => {
      const { data: conversations } = await assistantRepository.listConversations()
      const conversation = conversations?.[0] ?? (await assistantRepository.createConversation(actor.userId)).data
      if (!conversation) return
      setConversationId(conversation.id)
      const { data } = await assistantRepository.listMessages(conversation.id)
      setMessages((data ?? []).map((row) => ({ ...row, action: row.action as AssistantOrchestratorAction | null })))
    })()
  }, [actor])

  async function send(suggestedMessage?: string) {
    const message = (suggestedMessage ?? text).trim()
    if (!message || !conversationId || sending) return
    if (suggestedMessage === undefined) setText('')
    setSending(true)
    setError(undefined)
    const submittedAt = Date.now()
    setMessages((current) => [...current, {
      id: `pending-user-${submittedAt}`,
      author: 'user',
      content: message,
      action: null,
    }])
    try {
      const turn = await assistantRepository.sendTurn(conversationId, message)
      setMessages((current) => [...current, {
        id: `pending-assistant-${submittedAt}`,
        author: 'assistant',
        content: turn.reply,
        action: turn.action,
      }])
    } catch {
      setError('Не удалось получить ответ ассистента. Попробуйте ещё раз.')
    } finally {
      setSending(false)
    }
  }

  async function confirmSummary(messageId: string, action: AssistantOrchestratorAction) {
    const payload = summaryPayload(action)
    if (payload === undefined || runningSummaryIds.includes(messageId) || completedSummaryIds.includes(messageId)) return
    setRunningSummaryIds((current) => [...current, messageId])
    setError(undefined)
    try {
      await trainingSummariesRepository.generate(payload.clientId, payload.periodStart, payload.periodEnd, false)
    } catch {
      setRunningSummaryIds((current) => current.filter((id) => id !== messageId))
      setError('Не удалось сформировать сводку. Попробуйте ещё раз.')
      return
    }
    setRunningSummaryIds((current) => current.filter((id) => id !== messageId))
    setCompletedSummaryIds((current) => [...current, messageId])
  }

  async function confirmClient(messageId: string, draft: ClientDraftPayload) {
    if (runningClientIds.includes(messageId) || completedClientIds.includes(messageId)) return
    setRunningClientIds((current) => [...current, messageId]); setError(undefined)
    try {
      const parsed = clientSchema.parse({ fullName: draft.fullName, gender: draft.gender, ageYears: draft.ageYears, heightCm: draft.heightCm, goal: draft.goal || undefined, initialWeightKg: draft.initialWeightKg })
      await clientsRepository.create({ ...parsed, ageUpdatedAt: todayInTimeZone(actor?.timezone), initialWeightRecordedOn: parsed.initialWeightKg === undefined ? undefined : todayInTimeZone(actor?.timezone) })
      setCompletedClientIds((current) => [...current, messageId])
    } catch { setError('Не удалось создать карточку клиента. Проверьте данные и попробуйте ещё раз.') }
    finally { setRunningClientIds((current) => current.filter((id) => id !== messageId)) }
  }

  return <main className="assistant-page">
    <h1 className="sr-only">Ассистент</h1>
    <p className="assistant-local-note">Ассистент сохраняет историю этой беседы. Любое изменение данных появится только в отдельной карточке подтверждения.</p>
    <section className="assistant-thread" aria-label="Диалог с ассистентом">
      {messages.map((message) => message.author === 'user'
        ? <article key={message.id} className="assistant-message assistant-message-user"><p>{message.content}</p></article>
        : <article key={message.id} className="assistant-action-card"><AssistantMessageContent content={message.content} />{message.action && message.id === activeActionId && <AssistantAction action={message.action} timezone={actor?.timezone} onWorkoutSaved={() => void queryClient.invalidateQueries({ queryKey: ['workouts'] })} onSuggestion={(value) => void send(value)} onCancel={() => void send('Отменить')} onConfirm={() => void confirmSummary(message.id, message.action!)} onConfirmClient={(draft) => void confirmClient(message.id, draft)} running={runningSummaryIds.includes(message.id) || runningClientIds.includes(message.id)} completed={completedSummaryIds.includes(message.id) || completedClientIds.includes(message.id)} />}</article>)}
      {error && <p className="assistant-card-hint" role="alert">{error}</p>}
    </section>
    <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
      <label className="sr-only" htmlFor="assistant-history-message">Сообщение ассистенту</label>
      <input id="assistant-history-message" value={text} onChange={(event) => setText(event.target.value)} placeholder="Чем могу помочь?" disabled={!conversationId || sending} />
      <VoiceInputButton variant="icon" source="assistant" idleLabel="Голосовой ввод" disabled={!conversationId || sending} showTranscriptStatus={false} onTranscript={async (transcript) => {
        await send(transcript)
      }} />
      <button type="submit" className="assistant-icon-button" disabled={!conversationId || sending} aria-label="Отправить сообщение"><ChevronRightIcon /></button>
    </form>
  </main>
}

function AssistantMessageContent({ content }: { content: string }) {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
  const bullets = lines.filter((line) => line.startsWith('• '))
  if (bullets.length) return <div className="assistant-message-copy"><p>{lines.find((line) => !line.startsWith('• '))}</p><ul>{bullets.map((line) => <li key={line}>{line.slice(2)}</li>)}</ul></div>
  return <p>{content}</p>
}

type SummaryPayload = { step: string; clientId?: string; clientName?: string; candidates?: { id: string; fullName: string }[]; options?: string[]; periodStart?: string; periodEnd?: string; periodLabel?: string }
type ClientDraftPayload = { step: string; fullName: string; gender: 'male' | 'female'; ageYears: number; heightCm: number; goal?: string; initialWeightKg?: number }
type WorkoutDraftPayload = { step: string; clientId: string; clientName: string; transcript: string }
type ProgramExerciseDraft = { name: string; sets: number; reps?: number; weightKg?: number; durationMin?: number; distanceKm?: number }
type ProgramSessionDraft = { title: string; day: string; exercises: ProgramExerciseDraft[] }
type ProgramDraftPayload = { step: string; clientId: string; clientName: string; goal?: string | null; brief: string; sessions: unknown[] }

function summaryPayload(action: AssistantOrchestratorAction): { clientId: string; periodStart: string; periodEnd: string } | undefined {
  const payload = action.payload as SummaryPayload
  return action.tool === 'summarize_progress' && payload.step === 'confirm' && typeof payload.clientId === 'string' && typeof payload.periodStart === 'string' && typeof payload.periodEnd === 'string'
    ? { clientId: payload.clientId, periodStart: payload.periodStart, periodEnd: payload.periodEnd }
    : undefined
}

function AssistantAction({ action, timezone, onWorkoutSaved, onSuggestion, onCancel, onConfirm, onConfirmClient, running, completed }: { action: AssistantOrchestratorAction; timezone?: string; onWorkoutSaved: () => void; onSuggestion: (value: string) => void; onCancel: () => void; onConfirm: () => void; onConfirmClient: (draft: ClientDraftPayload) => void; running: boolean; completed: boolean }) {
  const payload = action.payload as SummaryPayload
  if (action.tool === 'create_client_draft' && payload.step === 'confirm') return <ClientDraftCard payload={payload as ClientDraftPayload} onCancel={onCancel} onConfirm={onConfirmClient} running={running} completed={completed} />
  if (action.tool === 'record_workout' && payload.step === 'confirm') return <AssistantWorkoutDraftCard payload={payload as WorkoutDraftPayload} timezone={timezone} onCancel={onCancel} onSaved={onWorkoutSaved} />
  if (action.tool === 'create_program_draft' && payload.step === 'confirm') return <ProgramDraftCard payload={payload as ProgramDraftPayload} timezone={timezone} onSaved={onWorkoutSaved} onCancel={onCancel} />
  if (action.tool !== 'summarize_progress') return <ActionPreview action={action} onCancel={onCancel} />
  if (payload.step === 'client' && Array.isArray(payload.candidates)) return <SummaryClientChoices candidates={payload.candidates} onSuggestion={onSuggestion} onCancel={onCancel} />
  if (payload.step === 'period' && typeof payload.clientName === 'string' && Array.isArray(payload.options)) return <SummaryPeriodChoices clientName={payload.clientName} options={payload.options} onSuggestion={onSuggestion} onCancel={onCancel} />
  if (summaryPayload(action) !== undefined) return <div className="assistant-progress-preview"><strong>{action.title}</strong><span>{action.description}</span><button type="button" onClick={onConfirm} disabled={running || completed}>{completed ? 'Сводка сформирована' : running ? 'Формирую…' : 'Сформировать сводку'}</button>{!completed && <CancelActionButton onCancel={onCancel} />}<small>Будут использованы только завершённые тренировки за выбранный период.</small></div>
  return <ActionPreview action={action} onCancel={onCancel} />
}

function ProgramDraftCard({ payload, timezone, onSaved, onCancel }: { payload: ProgramDraftPayload; timezone?: string; onSaved: () => void; onCancel: () => void }) {
  const catalog = useExerciseCatalog()
  const [sessions, setSessions] = useState(() => programSessions(payload.sessions))
  const [dates, setDates] = useState(() => sessions.map((_, index) => { const date = new Date(`${todayInTimeZone(timezone)}T12:00:00`); date.setDate(date.getDate() + index * 7); return date.toISOString().slice(0, 10) }))
  // One confirmation can be safely retried after a timeout: each planned
  // workout keeps its own idempotency key for the lifetime of this card.
  const [requestIds] = useState(() => programSessions(payload.sessions).map(() => crypto.randomUUID()))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()
  async function save() {
    if (saving || saved) return
    const workouts = programWorkoutDrafts(payload.clientId, sessions, dates, requestIds, catalog.exercises)
    if (workouts === undefined) { setError('Уточните дату и названия упражнений: они должны совпадать с каталогом.'); return }
    setSaving(true); setError(undefined)
    try {
      await Promise.all(workouts.map((workout) => workoutsRepository.save(workout)))
      setSaved(true); onSaved()
    } catch { setError('Не удалось добавить программу в расписание. Попробуйте ещё раз.') }
    finally { setSaving(false) }
  }
  return <div className="assistant-program-draft" aria-label={`Черновик программы ${payload.clientName}`}><strong>Программа · {payload.clientName}</strong><small>{payload.goal ? `Цель: ${payload.goal}` : 'Цель уточнена в анкете'}</small>{sessions.map((session, index) => <fieldset key={`${session.day}-${index}`}><label>Дата<input type="date" value={dates[index] ?? ''} onChange={(event) => setDates((current) => current.map((value, position) => position === index ? event.target.value : value))} /></label><label>Название<input value={session.title} onChange={(event) => setSessions((current) => current.map((item, position) => position === index ? { ...item, title: event.target.value } : item))} /></label><div className="assistant-program-exercises">{session.exercises.map((exercise, exerciseIndex) => <div key={exerciseIndex} className="assistant-program-exercise"><label>Упражнение<input value={exercise.name} onChange={(event) => setSessions((current) => updateProgramExercise(current, index, exerciseIndex, { name: event.target.value }))} /></label><label>Подходы<input type="number" min="1" max="8" value={exercise.sets} onChange={(event) => setSessions((current) => updateProgramExercise(current, index, exerciseIndex, { sets: Number(event.target.value) }))} /></label><label>Повторы<input type="number" min="1" value={exercise.reps ?? ''} onChange={(event) => setSessions((current) => updateProgramExercise(current, index, exerciseIndex, { reps: optionalNumber(event.target.value) }))} /></label><label>Вес, кг<input type="number" min="0" step="0.5" value={exercise.weightKg ?? ''} onChange={(event) => setSessions((current) => updateProgramExercise(current, index, exerciseIndex, { weightKg: optionalNumber(event.target.value) }))} /></label><label>Время, мин<input type="number" min="0" step="1" value={exercise.durationMin ?? ''} onChange={(event) => setSessions((current) => updateProgramExercise(current, index, exerciseIndex, { durationMin: optionalNumber(event.target.value) }))} /></label><label>Дистанция, км<input type="number" min="0" step="0.1" value={exercise.distanceKm ?? ''} onChange={(event) => setSessions((current) => updateProgramExercise(current, index, exerciseIndex, { distanceKm: optionalNumber(event.target.value) }))} /></label></div>)}</div></fieldset>)}{error && <p className="assistant-card-hint" role="alert">{error}</p>}<button type="button" onClick={() => void save()} disabled={catalog.loading || saving || saved}>{saved ? 'Программа добавлена в расписание' : saving ? 'Добавляю…' : 'Добавить в расписание'}</button>{!saved && <CancelActionButton onCancel={onCancel} />}</div>
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function programSessions(value: readonly unknown[]): ProgramSessionDraft[] {
  return value.flatMap((session): ProgramSessionDraft[] => {
    if (typeof session !== 'object' || session === null || Array.isArray(session)) return []
    const row = session as Record<string, unknown>
    if (typeof row.title !== 'string' || typeof row.day !== 'string' || !Array.isArray(row.exercises)) return []
    const exercises = row.exercises.flatMap((exercise): ProgramExerciseDraft[] => {
      // Keep already stored early draft cards readable after the schema upgrade.
      if (typeof exercise === 'string' && exercise.trim()) return [{ name: exercise.trim(), sets: 1 }]
      if (typeof exercise !== 'object' || exercise === null || Array.isArray(exercise)) return []
      const item = exercise as Record<string, unknown>
      if (typeof item.name !== 'string' || !item.name.trim() || typeof item.sets !== 'number' || !Number.isInteger(item.sets) || item.sets < 1) return []
      const number = (field: string) => typeof item[field] === 'number' && Number.isFinite(item[field]) && item[field] > 0 ? item[field] as number : undefined
      return [{ name: item.name.trim(), sets: item.sets, reps: number('reps'), weightKg: number('weightKg'), durationMin: number('durationMin'), distanceKm: number('distanceKm') }]
    })
    return exercises.length ? [{ title: row.title, day: row.day, exercises }] : []
  })
}

function updateProgramExercise(sessions: ProgramSessionDraft[], sessionIndex: number, exerciseIndex: number, patch: Partial<ProgramExerciseDraft>): ProgramSessionDraft[] {
  return sessions.map((session, currentSessionIndex) => currentSessionIndex !== sessionIndex ? session : {
    ...session,
    exercises: session.exercises.map((exercise, currentExerciseIndex) => currentExerciseIndex === exerciseIndex ? { ...exercise, ...patch } : exercise),
  })
}

export function programWorkoutDrafts(
  clientId: string,
  sessions: readonly ProgramSessionDraft[],
  dates: readonly string[],
  requestIds: readonly string[],
  catalog: readonly ExerciseSnapshot[],
): WorkoutDraft[] | undefined {
  if (sessions.length === 0 || sessions.length !== dates.length || sessions.length !== requestIds.length) return undefined
  const byName = new Map(catalog.map((exercise) => [exercise.name.toLocaleLowerCase('ru-RU'), exercise]))
  const resolveExercise = (name: string) => {
    const exact = byName.get(name.toLocaleLowerCase('ru-RU'))
    if (exact) return exact
    const matches = filterExercises(catalog, 'all', name)
    return matches.length === 1 ? matches[0] : undefined
  }
  const drafts = sessions.map((session, index) => {
    const date = dates[index]?.trim()
    const requestId = requestIds[index]?.trim()
    const exercises = session.exercises.map((item) => ({ item, exercise: resolveExercise(item.name) }))
    if (!date || !requestId || !session.title.trim() || exercises.some(({ exercise }) => exercise === undefined)) return undefined
    return {
      requestId,
      clientId,
      workoutDate: localDate(date),
      notes: session.title.trim(),
      exercises: exercises.map(({ item, exercise }, position) => ({ ...exercise!, position, blockId: crypto.randomUUID(), blockType: 'single' as const, blockRounds: 1, sets: Array.from({ length: item.sets }, (_, setPosition) => ({ position: setPosition, reps: item.reps, weightKg: item.weightKg, durationMin: item.durationMin, distanceKm: item.distanceKm })) })),
    }
  })
  return drafts.every((draft): draft is WorkoutDraft => draft !== undefined) ? drafts : undefined
}

function parsedWorkoutExercises(result: WorkoutParseResponse, catalog: readonly ExerciseSnapshot[]): WorkoutDraft['exercises'] {
  const byRef = new Map(catalog.map((exercise) => [exercise.ref, exercise]))
  return result.items.flatMap((item, position) => {
    const exercise = byRef.get(item.exerciseRef)
    if (!exercise) return []
    return [{
      ...exercise, position, blockId: crypto.randomUUID(), blockType: 'single' as const, blockRounds: 1,
      sets: (item.sets.length ? item.sets : [{}]).map((set, setPosition) => ({
        position: setPosition, weightKg: set.weightKg, reps: set.reps,
        ...(typeof set.durationMin === 'number' && set.durationMin > 0 ? { durationSec: Math.round(set.durationMin * 60) } : {}),
        ...(typeof set.distanceKm === 'number' && set.distanceKm > 0 ? { distanceKm: set.distanceKm } : {}),
      })),
    }]
  })
}

function AssistantWorkoutDraftCard({ payload, timezone, onCancel, onSaved }: { payload: WorkoutDraftPayload; timezone?: string; onCancel: () => void; onSaved: () => void }) {
  const catalog = useExerciseCatalog()
  const [text, setText] = useState(payload.transcript)
  const [result, setResult] = useState<WorkoutParseResponse>()
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  async function parse() {
    if (!text.trim() || catalog.loading || parsing) return
    setParsing(true); setError(undefined); setResult(undefined)
    try {
      const next = await parseWorkoutWithLlm(text, catalog.exercises)
      setResult(next)
      if (!next.items.length) setError('Не удалось распознать упражнения. Уточните текст диктовки и попробуйте ещё раз.')
    } catch { setError('Не удалось обработать диктовку. Исходный текст сохранён — попробуйте ещё раз.') }
    finally { setParsing(false) }
  }
  async function save() {
    if (!result || result.unmatched.length || saving || saved) return
    const exercises = parsedWorkoutExercises(result, catalog.exercises)
    if (!exercises.length) return
    setSaving(true); setError(undefined)
    try {
      await workoutsRepository.saveCompleted({ clientId: payload.clientId, workoutDate: todayInTimeZone(timezone), exercises })
      setSaved(true); onSaved()
    } catch { setError('Не удалось сохранить тренировку. Проверьте данные и попробуйте ещё раз.') }
    finally { setSaving(false) }
  }
  const unmatched = result?.unmatched ?? []
  function chooseExercise(sourceText: string, ref: string) {
    const exercise = catalog.exercises.find((item) => item.ref === ref)
    if (!exercise) return
    const valuesStart = sourceText.search(/\d/u)
    const values = valuesStart < 0 ? '' : sourceText.slice(valuesStart).trim()
    setText((current) => current.replace(sourceText, `${exercise.name}${values ? ` ${values}` : ''}`))
    setResult(undefined)
  }
  return <div className="assistant-program-draft" aria-label={`Разбор тренировки ${payload.clientName}`}>
    <strong>Тренировка · {payload.clientName}</strong>
    <WorkoutComposer name="assistant-workout-draft" source="assistant_workout" value={text} label="Диктовка" showVoice={false} onValueChange={setText} onClear={() => { setText(''); setResult(undefined) }} primaryAction={<button type="button" onClick={() => void parse()} disabled={!text.trim() || catalog.loading || parsing}>{catalog.loading ? 'Загружаю каталог…' : parsing ? 'Разбираю…' : 'Разобрать тренировку'}</button>} />
    {result && <div className="assistant-progress-preview"><strong>Результат разбора</strong><span>{formatLlmWorkoutText(result, catalog.exercises) || 'Упражнения не распознаны'}</span>{unmatched.map((item) => <div key={item.sourceText} className="assistant-period-options"><small>{item.reason}: {item.sourceText}</small>{item.suggestedExerciseRefs.map((ref) => <button key={ref} type="button" onClick={() => chooseExercise(item.sourceText, ref)}>{catalog.exercises.find((exercise) => exercise.ref === ref)?.name ?? 'Вариант упражнения'}</button>)}</div>)}{unmatched.length > 0 && <small>Выберите подходящий вариант, затем разберите тренировку повторно.</small>}{!unmatched.length && result.items.length > 0 && <button type="button" onClick={() => void save()} disabled={saving || saved}>{saved ? 'Тренировка сохранена' : saving ? 'Сохраняю…' : 'Сохранить тренировку'}</button>}</div>}
    {error && <p className="assistant-card-hint" role="alert">{error}</p>}
    {!saved && <CancelActionButton onCancel={onCancel} />}
  </div>
}

function ClientDraftCard({ payload, onCancel, onConfirm, running, completed }: { payload: ClientDraftPayload; onCancel: () => void; onConfirm: (draft: ClientDraftPayload) => void; running: boolean; completed: boolean }) {
  const [draft, setDraft] = useState(payload)
  return <div className="assistant-program-draft"><strong>Карточка клиента</strong><label>Имя<input value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} /></label><label>Пол<select value={draft.gender} onChange={(event) => setDraft({ ...draft, gender: event.target.value as ClientDraftPayload['gender'] })}><option value="female">Женский</option><option value="male">Мужской</option></select></label><label>Возраст<input type="number" value={draft.ageYears} onChange={(event) => setDraft({ ...draft, ageYears: Number(event.target.value) })} /></label><label>Рост, см<input type="number" value={draft.heightCm} onChange={(event) => setDraft({ ...draft, heightCm: Number(event.target.value) })} /></label><label>Цель (необязательно)<input value={draft.goal ?? ''} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} /></label><button type="button" onClick={() => onConfirm(draft)} disabled={running || completed}>{completed ? 'Клиент создан' : running ? 'Создаю…' : 'Создать клиента'}</button>{!completed && <CancelActionButton onCancel={onCancel} />}</div>
}

function ActionPreview({ action, onCancel }: { action: AssistantOrchestratorAction; onCancel: () => void }) {
  return <div className="assistant-progress-preview"><strong>{action.title}</strong><span>{action.description}</span><CancelActionButton onCancel={onCancel} /><small>Черновик: требуется отдельное подтверждение.</small></div>
}

function CancelActionButton({ onCancel }: { onCancel: () => void }) {
  return <button type="button" className="assistant-action-cancel" onClick={onCancel}>Отменить сценарий</button>
}

function SummaryClientChoices({ candidates, onSuggestion, onCancel }: { candidates: { id: string; fullName: string }[]; onSuggestion: (value: string) => void; onCancel: () => void }) {
  return <div className="assistant-progress-preview"><strong>Совпадения</strong><table className="assistant-choice-table"><tbody>{candidates.map((candidate) => <tr key={candidate.id}><td>{candidate.fullName}</td><td><button type="button" onClick={() => onSuggestion(`Сводка прогресса для ${candidate.fullName}`)}>Выбрать</button></td></tr>)}</tbody></table><CancelActionButton onCancel={onCancel} /></div>
}

function SummaryPeriodChoices({ clientName, options, onSuggestion, onCancel }: { clientName: string; options: string[]; onSuggestion: (value: string) => void; onCancel: () => void }) {
  return <div className="assistant-progress-preview"><strong>{clientName}</strong><div className="assistant-period-options">{options.map((option) => <button key={option} type="button" onClick={() => onSuggestion(`Сводка прогресса для ${clientName} за ${option}`)}>{option}</button>)}</div><CancelActionButton onCancel={onCancel} /><small>Можно также написать период в формате: с ГГГГ-ММ-ДД по ГГГГ-ММ-ДД.</small></div>
}
