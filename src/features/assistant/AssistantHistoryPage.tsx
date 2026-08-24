import { useEffect, useState } from 'react'
import { ChevronRightIcon, MicIcon } from '../../shared/icons'
import { useAuth } from '../../app/auth-context'
import { assistantRepository, type AssistantOrchestratorAction } from '../../data/repositories/assistant.repository'

type Message = { id: string; author: string; content: string; action: AssistantOrchestratorAction | null }

export function AssistantHistoryPage() {
  const { actor } = useAuth()
  const [conversationId, setConversationId] = useState<string>()
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const [sending, setSending] = useState(false)

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

  async function send() {
    const message = text.trim()
    if (!message || !conversationId || sending) return
    setText('')
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

  return <main className="assistant-page">
    <h1 className="sr-only">Ассистент</h1>
    <p className="assistant-local-note">Ассистент сохраняет историю этой беседы. Любое изменение данных появится только в отдельной карточке подтверждения.</p>
    <section className="assistant-thread" aria-label="Диалог с ассистентом">
      {messages.map((message) => message.author === 'user'
        ? <article key={message.id} className="assistant-message assistant-message-user"><p>{message.content}</p></article>
        : <article key={message.id} className="assistant-action-card"><p>{message.content}</p>{message.action && <div className="assistant-progress-preview"><strong>{message.action.title}</strong><span>{message.action.description}</span><small>Черновик: требуется отдельное подтверждение.</small></div>}</article>)}
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
