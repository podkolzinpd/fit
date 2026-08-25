import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRightIcon } from '../../shared/icons'
import { useAuth } from '../../app/auth-context'
import { assistantRepository, type AssistantOrchestratorAction } from '../../data/repositories/assistant.repository'
import { trainingSummariesRepository } from '../../data/repositories/training-summaries.repository'
import { VoiceInputButton } from '../voice-input'
import { clientSchema } from '../../shared/validation'
import { currentTimeInTimeZone, formatLocalDate, todayInTimeZone } from '../../shared/local-date'
import type { ExerciseSnapshot, WorkoutDraft } from '../../shared/domain'
import { useExerciseCatalog } from '../exercises'
import { WorkoutComposer } from '../workouts/WorkoutComposer'
import { formatLlmWorkoutText, parseWorkoutWithLlm } from '../workouts/llm-workout-parser'
import type { WorkoutParseResponse } from '../../data/repositories/exercises.repository'
import { optionalProgramNumber, programSessions, programWorkoutDrafts, updateProgramExercise } from './program-draft'
import { appendWorkoutParse, assistantWorkoutSaveInput, enqueueWorkoutParse, replaceWorkoutParseSource, type WorkoutParseQueue } from './workout-draft'
import { conversationLocalDate, conversationTitle, filterTerminalAssistantMessages, groupAssistantConversations, isReadOnlyConversation, isWorkoutDictationReceipt, latestActiveAssistantAction, mergeAssistantMessages, selectTodayConversation, type AssistantConversation, type AssistantMessage } from './assistant-sessions'
import { AssistantInlineSummaryCard } from './AssistantInlineSummary'
import { parseAssistantInlineSummary } from './assistant-inline-summary'

type FailedTurn = { turnId: string; message: string }

export function AssistantHistoryPage() {
  const { actor } = useAuth()
  const queryClient = useQueryClient()
  const [conversationId, setConversationId] = useState<string>()
  const [todayConversationId, setTodayConversationId] = useState<string>()
  const [conversations, setConversations] = useState<AssistantConversation[]>([])
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const [failedTurn, setFailedTurn] = useState<FailedTurn>()
  const [sending, setSending] = useState(false)
  const [runningSummaryIds, setRunningSummaryIds] = useState<string[]>([])
  const [completedSummaryIds, setCompletedSummaryIds] = useState<string[]>([])
  const [runningClientIds, setRunningClientIds] = useState<string[]>([])
  const [completedClientIds, setCompletedClientIds] = useState<string[]>([])
  const [savingSummaryIds, setSavingSummaryIds] = useState<string[]>([])
  const [savedSummaryIds, setSavedSummaryIds] = useState<string[]>([])
  const [actionVersions, setActionVersions] = useState<Record<string, number>>({})
  const conversationRef = useRef<string | undefined>(undefined)
  const loadSequence = useRef(0)
  const threadRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let cancelled = false
    ++loadSequence.current
    if (!actor) {
      setConversationId(undefined)
      setTodayConversationId(undefined)
      setConversations([])
      setMessages([])
      setLoadingMessages(false)
      return () => { cancelled = true }
    }
    setConversationId(undefined)
    setTodayConversationId(undefined)
    setConversations([])
    setMessages([])
    setLoadingMessages(false)
    void (async () => {
      const { data: conversations } = await assistantRepository.listConversations()
      const today = todayInTimeZone(actor.timezone)
      let available = (conversations ?? []) as AssistantConversation[]
      let conversation = selectTodayConversation(available, actor.timezone, today)
      if (!conversation) {
        conversation = (await assistantRepository.createConversation(actor.userId)).data as AssistantConversation | undefined
        if (conversation) available = [conversation, ...available]
      }
      if (cancelled) return
      if (!conversation) return
      setConversations(available)
      const current = selectTodayConversation(available, actor.timezone, today)
      setTodayConversationId(current?.id ?? conversation.id)
      setConversationId(conversation.id)
      conversationRef.current = conversation.id
    })()
    return () => { cancelled = true }
  }, [actor])

  useEffect(() => {
    if (!conversationId) return
    const sequence = ++loadSequence.current
    conversationRef.current = conversationId
    setMessages([])
    setLoadingMessages(true)
    void (async () => {
      const [{ data }, { data: actions }] = await Promise.all([
        assistantRepository.listMessages(conversationId), assistantRepository.listActions(conversationId),
      ])
      if (sequence !== loadSequence.current || conversationRef.current !== conversationId) return
      const merged = mergeAssistantMessages((data ?? []) as AssistantMessage[], (actions ?? []) as Parameters<typeof mergeAssistantMessages>[1])
      const versions: Record<string, number> = {}
      for (const action of actions ?? []) versions[action.id] = action.version
      setMessages(merged)
      setActionVersions(versions)
      setLoadingMessages(false)
    })()
  }, [conversationId])

  const readOnly = isReadOnlyConversation(conversationId, todayConversationId)
  const today = todayInTimeZone(actor?.timezone)
  const historyConversations = conversations.filter((conversation) => conversation.id !== todayConversationId)
  const conversationGroups = groupAssistantConversations(historyConversations, actor?.timezone, today)
  const lastMessageId = messages[messages.length - 1]?.id

  useLayoutEffect(() => {
    if (!conversationId || loadingMessages) return
    const thread = threadRef.current
    const scrollContainer = thread?.closest<HTMLElement>('.content')
    if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight
  }, [conversationId, lastMessageId, loadingMessages])

  function selectConversation(id: string) {
    if (sending || id === conversationId) return
    ++loadSequence.current
    conversationRef.current = id
    setHistoryOpen(false)
    setConversationId(id)
  }

  function returnToToday() {
    if (todayConversationId) selectConversation(todayConversationId)
  }

  async function send(suggestedMessage?: string, retry?: FailedTurn) {
    const message = (retry?.message ?? suggestedMessage ?? text).trim()
    if (!message || !conversationId || readOnly || sending) return
    const requestConversationId = conversationId
    if (retry === undefined && suggestedMessage === undefined) setText('')
    setSending(true)
    setError(undefined)
    const turnId = retry?.turnId ?? crypto.randomUUID()
    if (retry === undefined) {
      setMessages((current) => [...current, {
        id: `pending-user-${turnId}`,
        conversation_id: requestConversationId,
        turn_id: turnId,
        author: 'user',
        content: message,
        action: null,
        created_at: new Date().toISOString(),
      }])
    }
    try {
      const turn = await assistantRepository.sendTurn(requestConversationId, turnId, message)
      if (conversationRef.current !== requestConversationId) return
      setMessages((current) => [...current, {
        id: `pending-assistant-${turnId}`,
        conversation_id: requestConversationId,
        turn_id: turnId,
        author: 'assistant',
        content: turn.reply,
        action: turn.action,
        created_at: new Date().toISOString(),
      }])
      setFailedTurn(undefined)
    } catch {
      if (conversationRef.current !== requestConversationId) return
      setFailedTurn({ turnId, message })
      if (retry === undefined && suggestedMessage === undefined) setText((current) => current || message)
      setError('Не удалось получить ответ ассистента. Попробуйте ещё раз.')
    } finally {
      setSending(false)
    }
  }

  async function applyAction(messageId: string, action: AssistantOrchestratorAction, input: object): Promise<void> {
    if (!action.id) throw new Error('assistant_action_not_found')
    const version = actionVersions[action.id] ?? 1
    const result = await assistantRepository.applyAction(action.id, input, version)
    if (result.error) throw result.error
    const payload = result.data as { status?: string; version?: number } | null
    if (payload?.status === 'failed') {
      setActionVersions((current) => ({ ...current, [action.id!]: payload.version ?? version }))
      setMessages((current) => current.map((message) => message.id !== messageId || message.action === null ? message : { ...message, action: { ...message.action, lifecycleStatus: 'failed', result: payload as Record<string, unknown> } }))
      throw new Error('assistant_action_failed')
    }
    if (payload?.status !== 'applied') throw new Error('assistant_action_failed')
    setActionVersions((current) => ({ ...current, [action.id!]: payload.version ?? version + 1 }))
    setMessages((current) => current.map((message) => message.id !== messageId || message.action === null ? message : { ...message, action: { ...message.action, lifecycleStatus: 'applied', result: payload as Record<string, unknown> } }))
  }

  async function cancelAction(messageId: string, action: AssistantOrchestratorAction): Promise<boolean> {
    if (!action.id) return true
    const version = actionVersions[action.id] ?? 1
    const result = await assistantRepository.cancelAction(action.id, version)
    if (result.error) { setError('Не удалось отменить операцию. Обновите страницу и попробуйте ещё раз.'); return false }
    setActionVersions((current) => ({ ...current, [action.id!]: (result.data as { version?: number } | null)?.version ?? version + 1 }))
    setMessages((current) => current.map((message) => message.id !== messageId || message.action === null ? message : { ...message, action: { ...message.action, lifecycleStatus: 'cancelled' } }))
    return true
  }

  async function confirmSummary(messageId: string, action: AssistantOrchestratorAction) {
    const payload = summaryPayload(action)
    if (payload === undefined || runningSummaryIds.includes(messageId) || completedSummaryIds.includes(messageId)) return
    setRunningSummaryIds((current) => [...current, messageId])
    setError(undefined)
    try {
      await trainingSummariesRepository.generate(payload.clientId, payload.periodStart, payload.periodEnd, false)
      if (action.id) {
        const version = actionVersions[action.id] ?? 1
        const result = await assistantRepository.completeSummary(action.id, version)
        if (result.error) throw result.error
        const completed = result.data as { status?: string; version?: number; summaryId?: string } | null
        if (completed?.status !== 'applied') throw new Error('assistant_summary_not_completed')
        setActionVersions((current) => ({ ...current, [action.id!]: completed.version ?? version + 1 }))
        setMessages((current) => current.map((message) => message.id !== messageId || message.action === null ? message : { ...message, action: { ...message.action, lifecycleStatus: 'applied', result: completed as Record<string, unknown> } }))
      }
    } catch {
      setRunningSummaryIds((current) => current.filter((id) => id !== messageId))
      setError('Не удалось сформировать сводку. Попробуйте ещё раз.')
      return
    }
    setRunningSummaryIds((current) => current.filter((id) => id !== messageId))
    setCompletedSummaryIds((current) => [...current, messageId])
  }

  async function confirmClient(messageId: string, action: AssistantOrchestratorAction, draft: ClientDraftPayload) {
    if (runningClientIds.includes(messageId) || completedClientIds.includes(messageId)) return
    setRunningClientIds((current) => [...current, messageId]); setError(undefined)
    try {
      const parsed = clientSchema.parse({ fullName: draft.fullName, gender: draft.gender, ageYears: draft.ageYears, heightCm: draft.heightCm, goal: draft.goal || undefined, initialWeightKg: draft.initialWeightKg })
      await applyAction(messageId, action, { ...parsed, ageUpdatedAt: todayInTimeZone(actor?.timezone), initialWeightRecordedOn: parsed.initialWeightKg === undefined ? undefined : todayInTimeZone(actor?.timezone) })
      setCompletedClientIds((current) => [...current, messageId])
    } catch { setError('Не удалось создать карточку клиента. Проверьте данные и попробуйте ещё раз.') }
    finally { setRunningClientIds((current) => current.filter((id) => id !== messageId)) }
  }

  async function saveInlineSummary(messageId: string, summaryId: string, clientId: string) {
    if (savingSummaryIds.includes(messageId) || savedSummaryIds.includes(messageId)) return
    setSavingSummaryIds((current) => [...current, messageId])
    setError(undefined)
    try {
      const summaries = await trainingSummariesRepository.listForTrainer(clientId)
      const summary = summaries.find((item) => item.id === summaryId)
      if (!summary) throw new Error('assistant_summary_not_found')
      await trainingSummariesRepository.publish(summary, summary.client)
      setSavedSummaryIds((current) => [...current, messageId])
    } catch {
      setError('Не удалось сохранить сводку в прогресс. Попробуйте ещё раз.')
    } finally {
      setSavingSummaryIds((current) => current.filter((id) => id !== messageId))
    }
  }

  const latestActiveAction = readOnly ? undefined : latestActiveAssistantAction(messages, conversationId)
  const visibleMessages = filterTerminalAssistantMessages(messages)

  useEffect(() => {
    const summaries = messages.flatMap((message) => {
      if (message.action?.tool !== 'summarize_progress' || message.action.lifecycleStatus !== 'applied') return []
      const summary = parseAssistantInlineSummary(message.action.result)
      return summary ? [{ messageId: message.id, summaryId: summary.summaryId, clientId: summary.clientId }] : []
    })
    if (summaries.length === 0) return
    let cancelled = false
    void Promise.all(summaries.map(async ({ messageId, summaryId, clientId }) => {
      try {
        const rows = await trainingSummariesRepository.listForTrainer(clientId)
        return rows.some((row) => row.id === summaryId && row.published) ? messageId : undefined
      } catch { return undefined }
    })).then((savedIds) => {
      if (cancelled) return
      const found = savedIds.filter((id): id is string => id !== undefined)
      if (found.length > 0) setSavedSummaryIds((current) => [...new Set([...current, ...found])])
    })
    return () => { cancelled = true }
  }, [messages])

  return <main className="assistant-page">
    <h1 className="sr-only">Ассистент</h1>
    <section className="assistant-session-switcher" aria-label="Сессия ассистента">
      <div className="assistant-session-bar">
        <div className="assistant-session-label"><strong>{readOnly ? 'Архив' : 'Сегодня'}</strong><span>{conversationId ? formatLocalDate(conversationLocalDate({ created_at: conversations.find((item) => item.id === conversationId)?.created_at ?? new Date().toISOString() }, actor?.timezone)) : 'Загружаю…'}</span></div>
        <div className="assistant-session-actions">
          {readOnly && <button type="button" className="assistant-session-today" onClick={returnToToday}>Сегодня</button>}
          {historyConversations.length > 0 && <button type="button" className="assistant-history-toggle" aria-expanded={historyOpen} aria-controls="assistant-session-history" onClick={() => setHistoryOpen((open) => !open)}>История {historyConversations.length}</button>}
        </div>
      </div>
      {historyOpen && historyConversations.length > 0 && <div id="assistant-session-history" className="assistant-session-history">
          {conversationGroups.map((group) => <div key={group.date} className="assistant-session-day">
            <span className="assistant-session-day-label">{formatLocalDate(group.date)}</span>
            {group.conversations.map((conversation) => <button key={conversation.id} type="button" className={conversation.id === conversationId ? 'selected' : ''} onClick={() => selectConversation(conversation.id)}>
              <small>{conversationTitle(conversation, group.date, today)}</small>
            </button>)}
          </div>)}
      </div>}
    </section>
    <section ref={threadRef} className="assistant-thread" aria-label="Диалог с ассистентом">
      {loadingMessages && <p className="assistant-thread-status">Загружаю сессию…</p>}
      {visibleMessages.map((message) => {
        if (message.author === 'user') {
          if (isWorkoutDictationReceipt(message, messages)) return <article key={message.id} className="assistant-workout-user-receipt"><details><summary>Диктовка · фрагмент добавлен</summary><p>{message.content}</p></details></article>
          return <article key={message.id} className="assistant-message assistant-message-user"><p>{message.content}</p></article>
        }
        const inlineSummary = message.action?.tool === 'summarize_progress' && message.action.lifecycleStatus === 'applied'
          ? parseAssistantInlineSummary(message.action.result)
          : undefined
        if (inlineSummary) return <article key={message.id} className="assistant-message assistant-message-assistant"><AssistantInlineSummaryCard summary={inlineSummary} onSave={() => void saveInlineSummary(message.id, inlineSummary.summaryId, inlineSummary.clientId)} saving={savingSummaryIds.includes(message.id)} saved={savedSummaryIds.includes(message.id) || inlineSummary.saved === true} /></article>
        const showContent = !message.action || message.content.trim() !== message.action.description.trim() || (message.action.tool === 'summarize_progress' && message.action.lifecycleStatus === 'applied')
        if (!showContent) return null
        return <article key={message.id} className="assistant-message assistant-message-assistant"><AssistantMessageContent content={message.content} /></article>
      })}
      {error && <div className="assistant-card-hint" role="alert"><span>{error}</span>{failedTurn && <button type="button" onClick={() => void send(undefined, failedTurn)} disabled={sending}>Повторить отправку</button>}</div>}
    </section>
    {latestActiveAction && <section className="assistant-context-panel" aria-label="Текущий контекст ассистента">
      <AssistantAction action={latestActiveAction.action} timezone={actor?.timezone} onWorkoutSaved={() => void queryClient.invalidateQueries({ queryKey: ['workouts'] })} onApplyAction={(input) => applyAction(latestActiveAction.message.id, latestActiveAction.action, input)} onSuggestion={(value) => void send(value)} onCancel={() => { void (async () => { const cancelled = await cancelAction(latestActiveAction.message.id, latestActiveAction.action); if (cancelled && !latestActiveAction.action.id) await send('Отменить') })() }} onConfirm={() => void confirmSummary(latestActiveAction.message.id, latestActiveAction.action)} onConfirmClient={(draft) => void confirmClient(latestActiveAction.message.id, latestActiveAction.action, draft)} running={runningSummaryIds.includes(latestActiveAction.message.id) || runningClientIds.includes(latestActiveAction.message.id)} completed={completedSummaryIds.includes(latestActiveAction.message.id) || completedClientIds.includes(latestActiveAction.message.id) || latestActiveAction.action.lifecycleStatus === 'applied'} />
    </section>}
    <form className="assistant-composer" autoComplete="off" onSubmit={(event) => { event.preventDefault(); void send() }}>
      <label className="sr-only" htmlFor="assistant-history-message">Сообщение ассистенту</label>
      <input id="assistant-history-message" name="assistant-prompt" autoComplete="off" value={text} onChange={(event) => setText(event.target.value)} placeholder="Напишите сообщение" disabled={!conversationId || readOnly || sending} />
      <VoiceInputButton variant="icon" source="assistant" idleLabel="Голосовой ввод" disabled={!conversationId || readOnly || sending} showTranscriptStatus={false} onTranscript={async (transcript) => {
        await send(transcript)
      }} />
      <button type="submit" className="assistant-icon-button" disabled={!conversationId || readOnly || sending} aria-label="Отправить сообщение"><ChevronRightIcon /></button>
    </form>
  </main>
}

function AssistantMessageContent({ content }: { content: string }) {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
  const bullets = lines.filter((line) => line.startsWith('• '))
  if (bullets.length) return <div className="assistant-message-copy"><p>{lines.find((line) => !line.startsWith('• '))}</p><ul>{bullets.map((line) => <li key={line}>{line.slice(2)}</li>)}</ul></div>
  return <p>{content}</p>
}

type SummaryPayload = { step: string; clientId?: string; clientName?: string; transcript?: string; candidates?: { id: string; fullName: string }[]; options?: string[]; periodStart?: string; periodEnd?: string; periodLabel?: string }
type ClientDraftPayload = { step: string; fullName: string; gender: 'male' | 'female'; ageYears: number; heightCm: number; goal?: string; initialWeightKg?: number }
type WorkoutDraftPayload = { step: string; clientId: string; clientName: string; transcript?: string }
type ProgramDraftPayload = { step: string; clientId: string; clientName: string; goal?: string | null; brief: string; sessions: unknown[] }

function summaryPayload(action: AssistantOrchestratorAction): { clientId: string; periodStart: string; periodEnd: string } | undefined {
  const payload = action.payload as SummaryPayload
  return action.tool === 'summarize_progress' && payload.step === 'confirm' && typeof payload.clientId === 'string' && typeof payload.periodStart === 'string' && typeof payload.periodEnd === 'string'
    ? { clientId: payload.clientId, periodStart: payload.periodStart, periodEnd: payload.periodEnd }
    : undefined
}

function AssistantAction({ action, timezone, onWorkoutSaved, onApplyAction, onSuggestion, onCancel, onConfirm, onConfirmClient, running, completed }: { action: AssistantOrchestratorAction; timezone?: string; onWorkoutSaved: () => void; onApplyAction: (input: object) => Promise<void>; onSuggestion: (value: string) => void; onCancel: () => void; onConfirm: () => void; onConfirmClient: (draft: ClientDraftPayload) => void; running: boolean; completed: boolean }) {
  const payload = action.payload as SummaryPayload
  if (action.tool === 'create_client_draft' && payload.step === 'confirm') return <ClientDraftCard payload={payload as ClientDraftPayload} onCancel={onCancel} onConfirm={onConfirmClient} running={running} completed={completed} />
  if (action.tool === 'record_workout' && payload.step === 'confirm') return <AssistantWorkoutDraftCard key={`${action.id ?? 'workout'}-${payload.clientId}`} payload={payload as WorkoutDraftPayload} timezone={timezone} onCancel={onCancel} onApply={onApplyAction} onSaved={onWorkoutSaved} />
  if (action.tool === 'record_workout' && payload.step === 'workout') return <WorkoutCollectionCard payload={payload as WorkoutDraftPayload} onSuggestion={onSuggestion} onCancel={onCancel} />
  if (action.tool === 'create_program_draft' && payload.step === 'confirm') return <ProgramDraftCard payload={payload as ProgramDraftPayload} timezone={timezone} onApply={onApplyAction} onSaved={onWorkoutSaved} onCancel={onCancel} />
  if (action.tool !== 'summarize_progress') return <ActionPreview action={action} onCancel={onCancel} />
  if (payload.step === 'client' && Array.isArray(payload.candidates)) return <SummaryClientChoices candidates={payload.candidates} onSuggestion={onSuggestion} onCancel={onCancel} />
  if (payload.step === 'period' && typeof payload.clientName === 'string' && Array.isArray(payload.options)) return <SummaryPeriodChoices clientName={payload.clientName} options={payload.options} onSuggestion={onSuggestion} onCancel={onCancel} />
  if (summaryPayload(action) !== undefined) return <div className="assistant-progress-preview"><strong>{action.title}</strong><span>{action.description}</span><button type="button" onClick={onConfirm} disabled={running || completed}>{completed ? 'Сводка сформирована' : running ? 'Формирую…' : 'Сформировать сводку'}</button>{!completed && <CancelActionButton onCancel={onCancel} />}<small>Будут использованы только завершённые тренировки за выбранный период.</small></div>
  return <ActionPreview action={action} onCancel={onCancel} />
}

function WorkoutCollectionCard({ payload, onSuggestion, onCancel }: { payload: WorkoutDraftPayload; onSuggestion: (value: string) => void; onCancel: () => void }) {
  const transcript = payload.transcript?.trim() ?? ''
  return <div className="assistant-workout-collection">
    <small>Новая тренировка</small>
    <strong>{payload.clientName}</strong>
    {transcript
      ? <div className="assistant-workout-transcript"><small>Уже добавлено</small><p>{transcript}</p></div>
      : <p>Диктуйте упражнения по одному или все сразу — предыдущие фрагменты не пропадут.</p>}
    {transcript && <button type="button" onClick={() => onSuggestion('Готово, разобрать тренировку')}>Распознать упражнения</button>}
    <small>{transcript ? 'Можно надиктовать следующее упражнение обычным сообщением.' : 'Например: «Жим лёжа, 3 подхода по 10 повторений, 50 кг».'}</small>
    <CancelActionButton onCancel={onCancel} />
  </div>
}

function ProgramDraftCard({ payload, timezone, onApply, onSaved, onCancel }: { payload: ProgramDraftPayload; timezone?: string; onApply: (input: object) => Promise<void>; onSaved: () => void; onCancel: () => void }) {
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
      await onApply({ workouts })
      setSaved(true); onSaved()
    } catch { setError('Не удалось добавить программу в расписание. Попробуйте ещё раз.') }
    finally { setSaving(false) }
  }
  return <div className="assistant-program-draft" aria-label={`Черновик программы ${payload.clientName}`}><strong>Программа · {payload.clientName}</strong><small>{payload.goal ? `Цель: ${payload.goal}` : 'Цель уточнена в анкете'}</small>{sessions.map((session, index) => <fieldset key={`${session.day}-${index}`}><label>Дата<input type="date" value={dates[index] ?? ''} onChange={(event) => setDates((current) => current.map((value, position) => position === index ? event.target.value : value))} /></label><label>Название<input value={session.title} onChange={(event) => setSessions((current) => current.map((item, position) => position === index ? { ...item, title: event.target.value } : item))} /></label><div className="assistant-program-exercises">{session.exercises.map((exercise, exerciseIndex) => <div key={exerciseIndex} className="assistant-program-exercise"><label>Упражнение<input value={exercise.name} onChange={(event) => setSessions((current) => updateProgramExercise(current, index, exerciseIndex, { name: event.target.value }))} /></label><label>Подходы<input type="number" min="1" max="8" value={exercise.sets} onChange={(event) => setSessions((current) => updateProgramExercise(current, index, exerciseIndex, { sets: Number(event.target.value) }))} /></label><label>Повторы<input type="number" min="1" value={exercise.reps ?? ''} onChange={(event) => setSessions((current) => updateProgramExercise(current, index, exerciseIndex, { reps: optionalProgramNumber(event.target.value) }))} /></label><label>Вес, кг<input type="number" min="0" step="0.5" value={exercise.weightKg ?? ''} onChange={(event) => setSessions((current) => updateProgramExercise(current, index, exerciseIndex, { weightKg: optionalProgramNumber(event.target.value) }))} /></label><label>Время, мин<input type="number" min="0" step="1" value={exercise.durationMin ?? ''} onChange={(event) => setSessions((current) => updateProgramExercise(current, index, exerciseIndex, { durationMin: optionalProgramNumber(event.target.value) }))} /></label><label>Дистанция, км<input type="number" min="0" step="0.1" value={exercise.distanceKm ?? ''} onChange={(event) => setSessions((current) => updateProgramExercise(current, index, exerciseIndex, { distanceKm: optionalProgramNumber(event.target.value) }))} /></label></div>)}</div></fieldset>)}{error && <p className="assistant-card-hint" role="alert">{error}</p>}<button type="button" onClick={() => void save()} disabled={catalog.loading || saving || saved}>{saved ? 'Программа добавлена в расписание' : saving ? 'Добавляю…' : 'Добавить в расписание'}</button>{!saved && <CancelActionButton onCancel={onCancel} />}</div>
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

function AssistantWorkoutDraftCard({ payload, timezone, onCancel, onApply, onSaved }: { payload: WorkoutDraftPayload; timezone?: string; onCancel: () => void; onApply: (input: object) => Promise<void>; onSaved: () => void }) {
  const catalog = useExerciseCatalog()
  const [fragmentText, setFragmentText] = useState('')
  const [rawFragments, setRawFragments] = useState<string[]>([])
  const [workoutDate, setWorkoutDate] = useState<string>(() => todayInTimeZone(timezone))
  const [startTime, setStartTime] = useState(() => currentTimeInTimeZone(timezone))
  const [result, setResult] = useState<WorkoutParseResponse>()
  const [initialParsed, setInitialParsed] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [requestId] = useState(() => crypto.randomUUID())
  const parsedTranscript = useRef('')
  const parseQueue = useRef<WorkoutParseQueue>({ current: Promise.resolve() })

  function parseFragment(fragment: string, receipt = true, replaceSource?: string, inputValue?: string): Promise<void> {
    const normalized = fragment.trim()
    if (!normalized) return Promise.resolve()
    return enqueueWorkoutParse(parseQueue.current, async () => {
      if (catalog.loading) {
        setFragmentText((current) => current.trim() || normalized)
        setError('Каталог упражнений ещё загружается. Попробуйте распознать фрагмент ещё раз.')
        return
      }
      setParsing(true); setError(undefined)
      try {
        const next = await parseWorkoutWithLlm(normalized, catalog.exercises, { requireLocalDisambiguation: true })
        setResult((current) => replaceSource && current ? replaceWorkoutParseSource(current, replaceSource, next) : appendWorkoutParse(current, next))
        if (receipt) setRawFragments((current) => [...current, normalized])
        if (inputValue !== undefined) setFragmentText((current) => current.trim() === inputValue.trim() ? '' : current)
        if (!next.items.length && !next.unmatched.length) setError('Не удалось распознать упражнение. Уточните диктовку и попробуйте ещё раз.')
      } catch {
        setFragmentText((current) => current.trim() ? current : normalized)
        setError('Не удалось обработать диктовку. Исходный текст сохранён — попробуйте ещё раз.')
      }
      finally { setParsing(false) }
    })
  }

  useEffect(() => {
    const transcript = payload.transcript?.trim() ?? ''
    if (!transcript || catalog.loading || parsedTranscript.current === transcript) return
    const previous = parsedTranscript.current
    const fragment = previous && transcript.startsWith(previous) ? transcript.slice(previous.length).trim() : transcript
    parsedTranscript.current = transcript
    if (!fragment) return
    setInitialParsed(true)
    void parseFragment(fragment, true)
  }, [catalog.loading, payload.transcript])

  async function save() {
    if (!result || result.unmatched.length || saving || saved) return
    const exercises = parsedWorkoutExercises(result, catalog.exercises)
    if (!exercises.length) return
    setSaving(true); setError(undefined)
    try {
      await onApply(assistantWorkoutSaveInput(requestId, payload.clientId, workoutDate, startTime, exercises))
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
    void parseFragment(`${exercise.name}${values ? ` ${values}` : ''}`, false, sourceText)
  }
  return <div className="assistant-program-draft" aria-label={`Разбор тренировки ${payload.clientName}`}>
    <strong>Тренировка · {payload.clientName}</strong>
    <div className="assistant-workout-meta"><label>Дата<input type="date" value={workoutDate} onChange={(event) => setWorkoutDate(event.target.value)} /></label><label>Время<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label></div>
    {rawFragments.length > 0 && <details className="assistant-workout-receipt"><summary>Получено фрагментов: {rawFragments.length}</summary><div>{rawFragments.map((fragment, index) => <p key={`${fragment}-${index}`}>{fragment}</p>)}</div></details>}
    <WorkoutComposer name="assistant-workout-fragment" source="assistant_workout" value={fragmentText} label="Добавить упражнение" voiceLabel="Надиктовать упражнение" showVoice onValueChange={(value) => { setFragmentText(value); if (value.trim()) setError(undefined) }} onClear={() => setFragmentText('')} onTranscriptAppended={({ value, transcript }) => parseFragment(transcript, true, undefined, value)} primaryAction={<button type="button" onClick={() => void parseFragment(fragmentText, true, undefined, fragmentText)} disabled={!fragmentText.trim() || catalog.loading || parsing}>{catalog.loading ? 'Загружаю каталог…' : parsing ? 'Распознаю…' : error ? 'Распознать снова' : initialParsed ? 'Добавить упражнение' : 'Распознать упражнения'}</button>} />
    {result && <div className="assistant-progress-preview"><strong>Результат разбора</strong><span>{formatLlmWorkoutText(result, catalog.exercises) || 'Упражнения не распознаны'}</span>{unmatched.map((item) => <div key={item.sourceText} className="assistant-exercise-choice"><small>Нужно уточнить</small><strong>{item.sourceText}</strong><span>{item.reason}</span><div>{item.suggestedExerciseRefs.map((ref) => { const exercise = catalog.exercises.find((candidate) => candidate.ref === ref); return <button key={ref} type="button" onClick={() => chooseExercise(item.sourceText, ref)}>{exercise?.name ?? 'Вариант упражнения'}{exercise?.equipment ? <small>{exercise.equipment}</small> : null}</button> })}</div></div>)}{unmatched.length > 0 && <small>Выберите вариант — исходные подходы, повторы и вес останутся в тексте.</small>}{!unmatched.length && result.items.length > 0 && <button type="button" onClick={() => void save()} disabled={saving || saved}>{saved ? 'Тренировка сохранена' : saving ? 'Сохраняю…' : 'Сохранить тренировку'}</button>}</div>}
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
