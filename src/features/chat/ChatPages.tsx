import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import type { ChatImageDraft, ChatMessage } from '../../shared/domain'
import { CloseIcon, MessageIcon, PhotoIcon } from '../../shared/icons'
import { AsyncView, Page, StatePanel } from '../../shared/ui'
import { prepareChatImage } from './chat-image'

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function ChatListPage() {
  const { actor } = useAuth()
  const { chat } = useDataBackend()
  const navigate = useNavigate()
  const homePath = actor?.role === 'trainer' ? '/today' : '/me'
  const exitChat = () => navigate(homePath, { replace: true })
  const query = useQuery({ queryKey: ['chat-threads'], queryFn: () => chat.listThreads(), refetchOnMount: 'always', refetchInterval: 5_000 })
  const open = useMutation({ mutationFn: (item: { clientId: string; trainerId: string }) => chat.open(item.clientId, item.trainerId), onSuccess: (id) => navigate(`/chat/${id}`, { state: { chatBack: 'history' } }) })
  return <Page title="Сообщения" back={homePath} onBack={exitChat} swipeBack className="chat-list-page">
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}
      empty={query.data?.length === 0} emptyTitle="Диалогов пока нет" emptyDescription="Подключите тренера или спортсмена, чтобы начать переписку.">
      <div className="chat-thread-list">{query.data?.map((item) => <button type="button" className="chat-thread" key={`${item.clientId}:${item.trainerId}`}
        disabled={open.isPending} onClick={() => item.conversationId ? navigate(`/chat/${item.conversationId}`, { state: { chatBack: 'history' } }) : open.mutate(item)}>
        <span className="chat-avatar" aria-hidden="true">{item.partnerName.slice(0, 1).toUpperCase()}</span>
        <span className="chat-thread-copy"><strong>{item.partnerName}</strong><small>{item.lastMessageBody === '' ? 'Фото' : item.lastMessageBody ?? 'Начать диалог'}</small>{!item.activeConnection && <em>Связь отключена</em>}</span>
        <span className="chat-thread-meta">{item.lastMessageAt && <time>{timeLabel(item.lastMessageAt)}</time>}{item.unreadCount > 0 && <b>{item.unreadCount > 99 ? '99+' : item.unreadCount}</b>}</span>
      </button>)}</div>
      {open.error && <p className="error">Не удалось открыть диалог. Попробуйте ещё раз.</p>}
    </AsyncView>
  </Page>
}

type PendingMessage = ChatMessage & { state: 'sending' | 'error'; upload: ChatImageDraft | null }

function storedPending(key: string): PendingMessage[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is PendingMessage => typeof item === 'object' && item !== null
      && typeof (item as PendingMessage).id === 'string' && typeof (item as PendingMessage).body === 'string')
      .map((item) => ({ ...item, state: 'error', upload: (item as PendingMessage).upload ?? null }))
  } catch { return [] }
}

export function ChatConversationPage() {
  const { conversationId = '' } = useParams()
  const { actor } = useAuth()
  const { chat } = useDataBackend()
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const threads = useQuery({ queryKey: ['chat-threads'], queryFn: () => chat.listThreads() })
  const messages = useQuery({ queryKey: ['chat-messages', conversationId], queryFn: () => chat.listMessages(conversationId), enabled: Boolean(conversationId) })
  const [older, setOlder] = useState<ChatMessage[]>([])
  const pendingKey = `fit:chat-pending:${actor?.userId}:${conversationId}`
  const [pending, setPending] = useState<PendingMessage[]>(() => storedPending(pendingKey))
  const [nextCursor, setNextCursor] = useState<{ createdAt: string; id: string } | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const thread = threads.data?.find((item) => item.conversationId === conversationId)
  const draftKey = `fit:chat-draft:${actor?.userId}:${conversationId}`
  const [draft, setDraft] = useState(() => localStorage.getItem(draftKey) ?? '')
  const [photo, setPhoto] = useState<ChatImageDraft | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { localStorage.setItem(draftKey, draft) }, [draft, draftKey])
  useEffect(() => { localStorage.setItem(pendingKey, JSON.stringify(pending)) }, [pending, pendingKey])
  useEffect(() => { if (messages.data) setNextCursor(messages.data.nextCursor) }, [messages.data])
  useEffect(() => {
    if (!messages.data) return
    const deliveredIds = new Set(messages.data.messages.map((item) => item.id))
    setPending((current) => current.some((item) => deliveredIds.has(item.id))
      ? current.filter((item) => !deliveredIds.has(item.id))
      : current)
  }, [messages.data])
  useEffect(() => chat.subscribe(conversationId, () => {
    void messages.refetch(); void queryClient.invalidateQueries({ queryKey: ['chat-threads'] })
  }), [chat, conversationId, messages.refetch, queryClient])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') { void messages.refetch(); void threads.refetch() } }
    document.addEventListener('visibilitychange', refresh); window.addEventListener('pageshow', refresh); window.addEventListener('online', refresh)
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('pageshow', refresh); window.removeEventListener('online', refresh) }
  }, [messages.refetch, threads.refetch])
  useEffect(() => {
    if (!messages.data) return
    void chat.markRead(conversationId).then(() => queryClient.invalidateQueries({ queryKey: ['chat-threads'] }))
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [chat, conversationId, messages.data, queryClient])

  const visible = useMemo(() => {
    const items = [...older, ...(messages.data?.messages ?? []), ...pending]
    return [...new Map(items.map((item) => [item.id, item])).values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  }, [messages.data?.messages, older, pending])

  async function deliver(item: PendingMessage) {
    setPending((current) => current.map((message) => message.id === item.id ? { ...message, state: 'sending' } : message))
    try {
      await chat.send(conversationId, item.id, item.body, item.upload)
      setPending((current) => current.filter((message) => message.id !== item.id))
      await Promise.all([messages.refetch(), queryClient.invalidateQueries({ queryKey: ['chat-threads'] })])
    } catch {
      setPending((current) => current.map((message) => message.id === item.id ? { ...message, state: 'error' } : message))
    }
  }
  function send() {
    const body = draft.trim()
    if ((!body && !photo) || !actor || photoBusy) return
    const preview = photo ? { url: photo.dataUrl, mimeType: photo.mimeType, width: photo.width, height: photo.height, sizeBytes: photo.sizeBytes } : null
    const item: PendingMessage = { id: crypto.randomUUID(), conversationId, senderId: actor.userId, body, image: preview, upload: photo, createdAt: new Date().toISOString(), state: 'sending' }
    setDraft(''); setPhoto(null); setPhotoError(null); localStorage.removeItem(draftKey); setPending((current) => [...current, item]); void deliver(item)
  }
  async function choosePhoto(file: File | undefined) {
    if (!file) return
    setPhotoBusy(true); setPhotoError(null)
    try { setPhoto(await prepareChatImage(file)) }
    catch (error) { setPhoto(null); setPhotoError(error instanceof Error ? error.message : 'Не удалось подготовить фото') }
    finally { setPhotoBusy(false); if (photoInputRef.current) photoInputRef.current.value = '' }
  }
  async function loadOlder() {
    const cursor = nextCursor
    if (!cursor) return
    setLoadingOlder(true)
    try {
      const page = await chat.listMessages(conversationId, cursor)
      setOlder((current) => [...page.messages, ...current])
      setNextCursor(page.nextCursor)
    } finally { setLoadingOlder(false) }
  }

  const leaveConversation = () => location.state && (location.state as { chatBack?: string }).chatBack === 'history'
    ? navigate(-1)
    : navigate('/chat', { replace: true })

  return <Page title={thread?.partnerName ?? 'Диалог'} subtitle={!thread?.activeConnection && thread ? 'Связь отключена' : undefined}
    back="/chat" onBack={leaveConversation} swipeBack className="chat-conversation-page">
    <AsyncView loading={messages.isLoading || threads.isLoading} error={messages.error ?? threads.error} onRetry={() => { void messages.refetch(); void threads.refetch() }}>
      <section className="chat-surface" aria-label="Переписка">
        {nextCursor && <button type="button" className="link chat-load-older" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Загружаем…' : 'Ранее'}</button>}
        {visible.length === 0 && <StatePanel compact tone="info" title="Начните диалог" description="Напишите первое сообщение." />}
        <div className="chat-messages">{visible.map((item) => {
          const local = pending.find((candidate) => candidate.id === item.id)
          const own = item.senderId === actor?.userId
          return <article className={`chat-message ${own ? 'own' : 'partner'} ${item.image ? 'with-photo' : ''}`} key={item.id}>
            {item.image?.url
              ? <a className="chat-photo-link" href={item.image.url} target="_blank" rel="noreferrer" aria-label="Открыть фото"><img src={item.image.url} alt="Фото в сообщении" width={item.image.width} height={item.image.height} /></a>
              : item.image && <div className="chat-photo-unavailable">Фото недоступно</div>}
            {item.body && <p>{item.body}</p>}<small><time>{timeLabel(item.createdAt)}</time>{own && <span>{local?.state === 'sending' ? 'Отправляется' : local?.state === 'error' ? 'Ошибка' : 'Отправлено'}</span>}</small>{local?.state === 'error' && <button type="button" className="link" onClick={() => void deliver(local)}>Повторить</button>}</article>
        })}<div ref={endRef} /></div>
      </section>
      <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); send() }}>
        {photo && <div className="chat-photo-preview"><img src={photo.dataUrl} alt="Фото для отправки" /><button type="button" aria-label="Убрать фото" onClick={() => setPhoto(null)}><CloseIcon /></button></div>}
        {photoError && <p className="chat-photo-error" role="alert">{photoError}</p>}
        <div className="chat-composer-row">
          <input ref={photoInputRef} hidden type="file" accept="image/*" aria-label="Выбрать фото" onChange={(event) => void choosePhoto(event.target.files?.[0])} />
          <button type="button" className="chat-attach" disabled={photoBusy} aria-label={photoBusy ? 'Подготавливаем фото' : 'Прикрепить фото'} onClick={() => photoInputRef.current?.click()}><PhotoIcon /></button>
          <label className="sr-only" htmlFor="chat-message">Сообщение</label>
          <textarea id="chat-message" value={draft} maxLength={4000} rows={1} placeholder={photo ? 'Добавить подпись' : 'Сообщение'} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() }
          }} />
          <button type="submit" className="chat-send" disabled={(!draft.trim() && !photo) || photoBusy} aria-label="Отправить"><MessageIcon /></button>
        </div>
      </form>
    </AsyncView>
  </Page>
}
