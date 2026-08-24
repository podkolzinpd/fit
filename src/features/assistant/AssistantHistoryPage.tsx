import { useEffect, useState } from 'react'
import { ChevronRightIcon, MicIcon } from '../../shared/icons'
import { useAuth } from '../../app/auth-context'
import { assistantRepository, type AssistantOrchestratorAction } from '../../data/repositories/assistant.repository'
import { trainingSummariesRepository } from '../../data/repositories/training-summaries.repository'

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

  return <main className="assistant-page">
    <h1 className="sr-only">Ассистент</h1>
    <p className="assistant-local-note">Ассистент сохраняет историю этой беседы. Любое изменение данных появится только в отдельной карточке подтверждения.</p>
    <section className="assistant-thread" aria-label="Диалог с ассистентом">
      {messages.map((message) => message.author === 'user'
        ? <article key={message.id} className="assistant-message assistant-message-user"><p>{message.content}</p></article>
        : <article key={message.id} className="assistant-action-card"><p>{message.content}</p>{message.action && <AssistantAction action={message.action} onSuggestion={(value) => void send(value)} onConfirm={() => void confirmSummary(message.id, message.action!)} running={runningSummaryIds.includes(message.id)} completed={completedSummaryIds.includes(message.id)} />}</article>)}
      {error && <p className="assistant-card-hint" role="alert">{error}</p>}
    </section>
    <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
      <label className="sr-only" htmlFor="assistant-history-message">Сообщение ассистенту</label>
      <input id="assistant-history-message" value={text} onChange={(event) => setText(event.target.value)} placeholder="Чем могу помочь?" disabled={!conversationId || sending} />
      <button type="button" className="assistant-icon-button" disabled aria-label="Голосовой ввод появится в следующем этапе"><MicIcon /></button>
      <button type="submit" className="assistant-icon-button" disabled={!conversationId || sending} aria-label="Отправить сообщение"><ChevronRightIcon /></button>
    </form>
  </main>
}

type SummaryPayload = { step: string; clientId?: string; clientName?: string; candidates?: { id: string; fullName: string }[]; options?: string[]; periodStart?: string; periodEnd?: string; periodLabel?: string }

function summaryPayload(action: AssistantOrchestratorAction): { clientId: string; periodStart: string; periodEnd: string } | undefined {
  const payload = action.payload as SummaryPayload
  return action.tool === 'summarize_progress' && payload.step === 'confirm' && typeof payload.clientId === 'string' && typeof payload.periodStart === 'string' && typeof payload.periodEnd === 'string'
    ? { clientId: payload.clientId, periodStart: payload.periodStart, periodEnd: payload.periodEnd }
    : undefined
}

function AssistantAction({ action, onSuggestion, onConfirm, running, completed }: { action: AssistantOrchestratorAction; onSuggestion: (value: string) => void; onConfirm: () => void; running: boolean; completed: boolean }) {
  const payload = action.payload as SummaryPayload
  if (action.tool !== 'summarize_progress') return <div className="assistant-progress-preview"><strong>{action.title}</strong><span>{action.description}</span><small>Черновик: требуется отдельное подтверждение.</small></div>
  if (payload.step === 'client' && Array.isArray(payload.candidates)) return <SummaryClientChoices candidates={payload.candidates} onSuggestion={onSuggestion} />
  if (payload.step === 'period' && typeof payload.clientName === 'string' && Array.isArray(payload.options)) return <SummaryPeriodChoices clientName={payload.clientName} options={payload.options} onSuggestion={onSuggestion} />
  if (summaryPayload(action) !== undefined) return <div className="assistant-progress-preview"><strong>{action.title}</strong><span>{action.description}</span><button type="button" onClick={onConfirm} disabled={running || completed}>{completed ? 'Сводка сформирована' : running ? 'Формирую…' : 'Сформировать сводку'}</button><small>Будут использованы только завершённые тренировки за выбранный период.</small></div>
  return <div className="assistant-progress-preview"><strong>{action.title}</strong><span>{action.description}</span></div>
}

function SummaryClientChoices({ candidates, onSuggestion }: { candidates: { id: string; fullName: string }[]; onSuggestion: (value: string) => void }) {
  return <div className="assistant-progress-preview"><strong>Совпадения</strong><table className="assistant-choice-table"><tbody>{candidates.map((candidate) => <tr key={candidate.id}><td>{candidate.fullName}</td><td><button type="button" onClick={() => onSuggestion(`Сводка прогресса для ${candidate.fullName}`)}>Выбрать</button></td></tr>)}</tbody></table></div>
}

function SummaryPeriodChoices({ clientName, options, onSuggestion }: { clientName: string; options: string[]; onSuggestion: (value: string) => void }) {
  return <div className="assistant-progress-preview"><strong>{clientName}</strong><div className="assistant-period-options">{options.map((option) => <button key={option} type="button" onClick={() => onSuggestion(`Сводка прогресса для ${clientName} за ${option}`)}>{option}</button>)}</div><small>Можно также написать период в формате: с ГГГГ-ММ-ДД по ГГГГ-ММ-ДД.</small></div>
}
