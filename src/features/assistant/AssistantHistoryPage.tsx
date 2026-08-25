import { useEffect, useState } from 'react'
import { ChevronRightIcon } from '../../shared/icons'
import { useAuth } from '../../app/auth-context'
import { assistantRepository, type AssistantOrchestratorAction } from '../../data/repositories/assistant.repository'
import { trainingSummariesRepository } from '../../data/repositories/training-summaries.repository'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { VoiceInputButton } from '../voice-input'
import { clientSchema } from '../../shared/validation'
import { todayInTimeZone } from '../../shared/local-date'

type Message = { id: string; author: string; content: string; action: AssistantOrchestratorAction | null }

export function AssistantHistoryPage() {
  const { actor } = useAuth()
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
        : <article key={message.id} className="assistant-action-card"><p>{message.content}</p>{message.action && message.id === activeActionId && <AssistantAction action={message.action} onSuggestion={(value) => void send(value)} onCancel={() => void send('Отменить')} onConfirm={() => void confirmSummary(message.id, message.action!)} onConfirmClient={(draft) => void confirmClient(message.id, draft)} running={runningSummaryIds.includes(message.id) || runningClientIds.includes(message.id)} completed={completedSummaryIds.includes(message.id) || completedClientIds.includes(message.id)} />}</article>)}
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

type SummaryPayload = { step: string; clientId?: string; clientName?: string; candidates?: { id: string; fullName: string }[]; options?: string[]; periodStart?: string; periodEnd?: string; periodLabel?: string }
type ClientDraftPayload = { step: string; fullName: string; gender: 'male' | 'female'; ageYears: number; heightCm: number; goal?: string; initialWeightKg?: number }

function summaryPayload(action: AssistantOrchestratorAction): { clientId: string; periodStart: string; periodEnd: string } | undefined {
  const payload = action.payload as SummaryPayload
  return action.tool === 'summarize_progress' && payload.step === 'confirm' && typeof payload.clientId === 'string' && typeof payload.periodStart === 'string' && typeof payload.periodEnd === 'string'
    ? { clientId: payload.clientId, periodStart: payload.periodStart, periodEnd: payload.periodEnd }
    : undefined
}

function AssistantAction({ action, onSuggestion, onCancel, onConfirm, onConfirmClient, running, completed }: { action: AssistantOrchestratorAction; onSuggestion: (value: string) => void; onCancel: () => void; onConfirm: () => void; onConfirmClient: (draft: ClientDraftPayload) => void; running: boolean; completed: boolean }) {
  const payload = action.payload as SummaryPayload
  if (action.tool === 'create_client_draft' && payload.step === 'confirm') return <ClientDraftCard payload={payload as ClientDraftPayload} onCancel={onCancel} onConfirm={onConfirmClient} running={running} completed={completed} />
  if (action.tool !== 'summarize_progress') return <ActionPreview action={action} onCancel={onCancel} />
  if (payload.step === 'client' && Array.isArray(payload.candidates)) return <SummaryClientChoices candidates={payload.candidates} onSuggestion={onSuggestion} onCancel={onCancel} />
  if (payload.step === 'period' && typeof payload.clientName === 'string' && Array.isArray(payload.options)) return <SummaryPeriodChoices clientName={payload.clientName} options={payload.options} onSuggestion={onSuggestion} onCancel={onCancel} />
  if (summaryPayload(action) !== undefined) return <div className="assistant-progress-preview"><strong>{action.title}</strong><span>{action.description}</span><button type="button" onClick={onConfirm} disabled={running || completed}>{completed ? 'Сводка сформирована' : running ? 'Формирую…' : 'Сформировать сводку'}</button>{!completed && <CancelActionButton onCancel={onCancel} />}<small>Будут использованы только завершённые тренировки за выбранный период.</small></div>
  return <ActionPreview action={action} onCancel={onCancel} />
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
