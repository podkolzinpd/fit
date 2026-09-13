import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type TouchEvent as ReactTouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { copyText } from '../../shared/clipboard'
import type { ChatImageDraft, ChatMessage } from '../../shared/domain'
import { CloseIcon, MessageIcon, PhotoIcon, SearchIcon } from '../../shared/icons'
import { AsyncView, OverflowMenu, Page, StatePanel, useConfirm } from '../../shared/ui'
import { prepareChatImage } from './chat-image'

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ChatListPage() {
  const { actor } = useAuth()
  const { chat } = useDataBackend()
  const navigate = useNavigate()
  const homePath = actor?.role === 'trainer' ? '/today' : '/me'
  const exitChat = () => navigate(homePath, { replace: true })
  const query = useQuery({ queryKey: ['chat-threads'], queryFn: () => chat.listThreads(), refetchOnMount: 'always', refetchInterval: 5_000 })
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState(false)
  async function openChat(item: { clientId: string; trainerId: string; conversationId: string | null }) {
    if (opening) return
    setOpening(true); setOpenError(false)
    try {
      const id = item.conversationId ?? await chat.open(item.clientId, item.trainerId)
      navigate(`/chat/${id}`, { state: { chatBack: 'history' } })
    } catch { setOpenError(true) } finally { setOpening(false) }
  }
  return <Page title="Сообщения" back={homePath} onBack={exitChat} swipeBack className="chat-list-page">
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}
      empty={query.data?.length === 0} emptyTitle="Диалогов пока нет" emptyDescription="Подключите тренера или спортсмена, чтобы начать переписку.">
      <div className="chat-thread-list">{query.data?.map((item) => <button type="button" className="chat-thread" key={`${item.clientId}:${item.trainerId}`}
        disabled={opening} onClick={() => void openChat(item)}>
        <span className="chat-avatar" aria-hidden="true">{item.partnerName.slice(0, 1).toUpperCase()}</span>
        <span className="chat-thread-copy"><strong>{item.partnerName}</strong><small>{item.lastMessageBody === '' ? 'Фото' : item.lastMessageBody ?? 'Начать диалог'}</small>{!item.activeConnection && <em>Не подключён</em>}</span>
        <span className="chat-thread-meta">{item.lastMessageAt && <time>{timeLabel(item.lastMessageAt)}</time>}{item.unreadCount > 0 && <b>{item.unreadCount > 99 ? '99+' : item.unreadCount}</b>}</span>
      </button>)}</div>
      {openError && <p className="error" role="alert">Не удалось открыть диалог. Попробуйте ещё раз.</p>}
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
      .map((item) => ({ ...item, editedAt: item.editedAt ?? null, replyTo: item.replyTo ?? null,
        state: 'error', upload: item.upload ?? null }))
  } catch { return [] }
}

function replyText(message: ChatMessage['replyTo']) {
  if (!message) return ''
  if (message.deleted) return 'Сообщение удалено'
  if (message.body) return message.body
  if (message.hasImage) return 'Фото'
  return 'Сообщение'
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const normalized = query.trim()
  if (!normalized) return <>{text}</>
  const index = text.toLocaleLowerCase('ru-RU').indexOf(normalized.toLocaleLowerCase('ru-RU'))
  if (index < 0) return <>{text}</>
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + normalized.length)}</mark>{text.slice(index + normalized.length)}</>
}

function useChatLayer(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    if (!open) return
    const marker = crypto.randomUUID()
    window.history.pushState({ ...window.history.state, fitChatLayer: marker }, '')
    const pop = () => onCloseRef.current()
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') window.history.back() }
    window.addEventListener('popstate', pop)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('keydown', key) }
  }, [open])
}

function ChatActionSheet({ message, own, local, busy, error, onClose, onReply, onCopy, onEdit, onDelete, onOpenPhoto }:
  { message: ChatMessage; own: boolean; local: boolean; busy: boolean; error: boolean; onClose: () => void; onReply: () => void; onCopy: () => void; onEdit: () => void; onDelete: () => void; onOpenPhoto: () => void }) {
  useChatLayer(true, onClose)
  const close = () => window.history.back()
  const action = (work: () => void) => { close(); window.setTimeout(work, 0) }
  return createPortal(<div className="chat-sheet-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="chat-action-sheet" role="dialog" aria-modal="true" aria-label="Действия с сообщением">
      <div className="chat-sheet-handle" aria-hidden="true" />
      {!local && <button type="button" onClick={() => action(onReply)}>Ответить</button>}
      {message.body && <button type="button" onClick={() => action(onCopy)}>Скопировать</button>}
      {message.image?.url && <button type="button" onClick={() => action(onOpenPhoto)}>Открыть фото</button>}
      {own && !local && message.body && <button type="button" onClick={() => action(onEdit)}>Изменить</button>}
      {own && <button type="button" className="danger" disabled={busy} onClick={() => action(onDelete)}>{busy ? 'Удаляем…' : 'Удалить'}</button>}
      {error && <p role="alert">Не удалось удалить. Попробуйте ещё раз.</p>}
      <button type="button" className="chat-sheet-cancel" onClick={close}>Отмена</button>
    </section>
  </div>, document.body)
}

function ChatPhotoViewer({ message, onClose }: { message: ChatMessage; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const gesture = useRef<{ x: number; y: number; distance: number | null } | null>(null)
  useChatLayer(true, onClose)
  const close = () => window.history.back()
  async function save() {
    if (!message.image?.url || saving) return
    setSaving(true); setError(false)
    try {
      const blob = await (await fetch(message.image.url)).blob()
      const file = new File([blob], `fit-${message.id}.jpg`, { type: 'image/jpeg' })
      if (navigator.share && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] })
      else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a'); link.href = url; link.download = file.name; link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
      }
    } catch { setError(true) } finally { setSaving(false) }
  }
  function distance(event: ReactTouchEvent) {
    const first = event.touches[0]; const second = event.touches[1]
    return first && second ? Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY) : null
  }
  function beginGesture(event: ReactTouchEvent) {
    const touch = event.touches[0]
    if (touch) gesture.current = { x: touch.clientX, y: touch.clientY, distance: distance(event) }
  }
  function moveGesture(event: ReactTouchEvent) {
    const start = gesture.current; const touch = event.touches[0]
    if (!start || !touch) return
    const nextDistance = distance(event)
    if (nextDistance !== null && start.distance !== null) {
      const startDistance = start.distance
      setZoom((value) => Math.min(3, Math.max(1, value * nextDistance / startDistance)))
      gesture.current = { x: touch.clientX, y: touch.clientY, distance: nextDistance }; return
    }
    if (zoom > 1) {
      setOffset((value) => ({ x: value.x + touch.clientX - start.x, y: value.y + touch.clientY - start.y }))
      gesture.current = { x: touch.clientX, y: touch.clientY, distance: null }
    }
  }
  function endGesture(event: ReactTouchEvent) {
    const start = gesture.current; const touch = event.changedTouches[0]
    gesture.current = null
    if (zoom === 1 && start && touch && touch.clientY - start.y > 90 && Math.abs(touch.clientX - start.x) < 60) close()
  }
  function changeZoom(next: number) { setZoom(next); if (next === 1) setOffset({ x: 0, y: 0 }) }
  return createPortal(<section className="chat-photo-viewer" role="dialog" aria-modal="true" aria-label="Просмотр фото">
    <header><button type="button" aria-label="Закрыть фото" onClick={close}><CloseIcon /></button><button type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</button></header>
    <div className="chat-photo-stage" onDoubleClick={() => changeZoom(zoom === 1 ? 2 : 1)} onTouchStart={beginGesture} onTouchMove={moveGesture} onTouchEnd={endGesture}>
      <img src={message.image?.url ?? ''} alt="Фото в сообщении" style={{ transform: `translate(${offset.x}px,${offset.y}px) scale(${zoom})` }} />
    </div>
    <div className="chat-photo-controls" aria-label="Масштаб"><button type="button" aria-label="Уменьшить" disabled={zoom <= 1} onClick={() => changeZoom(Math.max(1, zoom - .5))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Увеличить" disabled={zoom >= 3} onClick={() => changeZoom(Math.min(3, zoom + .5))}>+</button></div>
    {error && <p role="alert">Не удалось сохранить фото</p>}
  </section>, document.body)
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
  const unread = useQuery({ queryKey: ['chat-unread', conversationId], queryFn: () => chat.unreadState(conversationId), enabled: Boolean(conversationId), staleTime: Infinity })
  const connection = useQuery({ queryKey: ['chat-connection', conversationId], queryFn: () => chat.connectionState(conversationId), enabled: Boolean(conversationId) })
  const [older, setOlder] = useState<ChatMessage[]>([])
  const [contextMessages, setContextMessages] = useState<ChatMessage[]>([])
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
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null)
  const [photoMessage, setPhotoMessage] = useState<ChatMessage | null>(null)
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [composerBusy, setComposerBusy] = useState(false)
  const [composerError, setComposerError] = useState<string | null>(null)
  const resumedDraftRef = useRef('')
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [deleteErrorMessageId, setDeleteErrorMessageId] = useState<string | null>(null)
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(() => new Set())
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const search = useQuery({ queryKey: ['chat-search', conversationId, searchTerm], queryFn: () => chat.search(conversationId, searchTerm), enabled: searchTerm.length >= 2 })
  const [confirm, confirmDialog] = useConfirm()
  const photoInputRef = useRef<HTMLInputElement>(null)
  const messageInputRef = useRef<HTMLTextAreaElement>(null)
  const surfaceRef = useRef<HTMLElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const initialScrollDone = useRef(false)
  useChatLayer(searchOpen, () => setSearchOpen(false))

  const refreshConversationState = async () => {
    await Promise.all([
      connection.refetch(),
      queryClient.invalidateQueries({ queryKey: ['chat-threads'] }),
      queryClient.invalidateQueries({ queryKey: ['client-trainers'] }),
    ])
  }
  const invite = useMutation({ mutationFn: () => chat.inviteToConnect(conversationId), onSuccess: refreshConversationState })
  const accept = useMutation({ mutationFn: () => chat.acceptConnection(conversationId), onSuccess: refreshConversationState })
  const block = useMutation({ mutationFn: (blocked: boolean) => chat.setBlocked(conversationId, blocked), onSuccess: refreshConversationState })

  useEffect(() => { if (!editing) localStorage.setItem(draftKey, draft) }, [draft, draftKey, editing])
  useEffect(() => {
    const field = messageInputRef.current
    if (!field) return
    field.style.height = 'auto'; field.style.height = `${Math.min(field.scrollHeight, 120)}px`
  }, [draft])
  useEffect(() => { localStorage.setItem(pendingKey, JSON.stringify(pending)) }, [pending, pendingKey])
  useEffect(() => { if (messages.data) setNextCursor(messages.data.nextCursor) }, [messages.data])
  useEffect(() => {
    if (!messages.data) return
    const deliveredIds = new Set(messages.data.messages.map((item) => item.id))
    setPending((current) => current.some((item) => deliveredIds.has(item.id)) ? current.filter((item) => !deliveredIds.has(item.id)) : current)
  }, [messages.data])
  useEffect(() => chat.subscribe(conversationId, () => {
    void messages.refetch(); void queryClient.invalidateQueries({ queryKey: ['chat-threads'] })
  }), [chat, conversationId, messages.refetch, queryClient])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') { void messages.refetch(); void threads.refetch() } }
    document.addEventListener('visibilitychange', refresh); window.addEventListener('pageshow', refresh); window.addEventListener('online', refresh)
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('pageshow', refresh); window.removeEventListener('online', refresh) }
  }, [messages.refetch, threads.refetch])

  const visible = useMemo(() => {
    const items = [...older, ...contextMessages, ...(messages.data?.messages ?? []), ...pending]
    return [...new Map(items.map((item) => [item.id, item])).values()].filter((item) => !hiddenMessageIds.has(item.id))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  }, [contextMessages, hiddenMessageIds, messages.data?.messages, older, pending])

  function scrollToMessage(id: string, behavior: ScrollBehavior = 'smooth') {
    surfaceRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior })
  }
  async function revealMessage(id: string) {
    if (!visible.some((item) => item.id === id)) setContextMessages(await chat.window(conversationId, id))
    window.requestAnimationFrame(() => { scrollToMessage(id); setHighlightedId(id); window.setTimeout(() => setHighlightedId(null), 1_600) })
  }
  useEffect(() => {
    if (initialScrollDone.current || !messages.data || !unread.data) return
    initialScrollDone.current = true
    const id = unread.data.firstMessageId
    if (id) void revealMessage(id)
    else endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.data, unread.data])
  useEffect(() => {
    if (!actor || !surfaceRef.current || typeof IntersectionObserver === 'undefined') return
    let through: ChatMessage | null = null
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < .65) continue
        const id = (entry.target as HTMLElement).dataset.messageId
        const item = visible.find((candidate) => candidate.id === id)
        if (item && item.senderId !== actor.userId && (!through || (item.createdAt > through.createdAt || (item.createdAt === through.createdAt && item.id > through.id)))) through = item
      }
      if (through) void chat.markRead(conversationId, through.id).then(() => {
        void queryClient.invalidateQueries({ queryKey: ['chat-threads'] })
        void queryClient.invalidateQueries({ queryKey: ['chat-unread', conversationId] })
      })
    }, { root: surfaceRef.current, threshold: [.65] })
    surfaceRef.current.querySelectorAll('[data-message-id]').forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [actor, chat, conversationId, queryClient, visible])

  async function deliver(item: PendingMessage) {
    setPending((current) => current.map((message) => message.id === item.id ? { ...message, state: 'sending' } : message))
    try {
      await chat.send(conversationId, item.id, item.body, item.upload, item.replyTo?.messageId)
      setPending((current) => current.filter((message) => message.id !== item.id))
      await Promise.all([messages.refetch(), queryClient.invalidateQueries({ queryKey: ['chat-threads'] })])
    } catch { setPending((current) => current.map((message) => message.id === item.id ? { ...message, state: 'error' } : message)) }
  }
  async function submit() {
    const body = draft.trim()
    if (editing) {
      if (!body || composerBusy) return
      setComposerBusy(true); setComposerError(null)
      try {
        await chat.edit(conversationId, editing.id, body)
        setEditing(null); setDraft(resumedDraftRef.current); resumedDraftRef.current = ''
        await messages.refetch()
      } catch { setComposerError('Не удалось сохранить изменения') } finally { setComposerBusy(false) }
      return
    }
    if ((!body && !photo) || !actor || photoBusy) return
    const preview = photo ? { url: photo.dataUrl, mimeType: photo.mimeType, width: photo.width, height: photo.height, sizeBytes: photo.sizeBytes } : null
    const replyTo = replyingTo ? { messageId: replyingTo.id, senderId: replyingTo.senderId, body: replyingTo.body || null,
      hasImage: Boolean(replyingTo.image), deleted: false } : null
    const item: PendingMessage = { id: crypto.randomUUID(), conversationId, senderId: actor.userId, body, image: preview,
      upload: photo, createdAt: new Date().toISOString(), editedAt: null, replyTo, state: 'sending' }
    setDraft(''); setPhoto(null); setReplyingTo(null); setPhotoError(null); localStorage.removeItem(draftKey)
    setPending((current) => [...current, item]); endRef.current?.scrollIntoView({ block: 'end' }); void deliver(item)
  }
  function startEdit(item: ChatMessage) {
    resumedDraftRef.current = draft; setReplyingTo(null); setPhoto(null); setEditing(item); setDraft(item.body); setComposerError(null)
    window.setTimeout(() => messageInputRef.current?.focus(), 0)
  }
  function cancelEdit() { setEditing(null); setDraft(resumedDraftRef.current); resumedDraftRef.current = ''; setComposerError(null) }
  async function choosePhoto(file: File | undefined) {
    if (!file) return
    setPhotoBusy(true); setPhotoError(null)
    try { setPhoto(await prepareChatImage(file)) }
    catch (error) { setPhoto(null); setPhotoError(error instanceof Error ? error.message : 'Не удалось подготовить фото') }
    finally { setPhotoBusy(false); if (photoInputRef.current) photoInputRef.current.value = '' }
  }
  async function loadOlder() {
    if (!nextCursor) return
    setLoadingOlder(true)
    try { const page = await chat.listMessages(conversationId, nextCursor); setOlder((current) => [...page.messages, ...current]); setNextCursor(page.nextCursor) }
    finally { setLoadingOlder(false) }
  }
  async function removeMessage(item: ChatMessage, local: PendingMessage | undefined) {
    const accepted = await confirm({ message: 'Удалить это сообщение у обоих?', confirmLabel: 'Удалить', danger: true })
    if (!accepted) return
    setDeletingMessageId(item.id); setDeleteErrorMessageId(null)
    try {
      if (local) setPending((current) => current.filter((message) => message.id !== item.id)); else await chat.remove(conversationId, item.id)
      setHiddenMessageIds((current) => new Set(current).add(item.id)); setOlder((current) => current.filter((message) => message.id !== item.id))
      await Promise.all([messages.refetch(), queryClient.invalidateQueries({ queryKey: ['chat-threads'] })])
    } catch { setDeleteErrorMessageId(item.id) } finally { setDeletingMessageId(null) }
  }
  async function copyMessage(item: ChatMessage) {
    try { await copyText(item.body); setNotice('Скопировано') } catch { setNotice('Не удалось скопировать') }
    window.setTimeout(() => setNotice(null), 1_500)
  }
  function openSearchResult(item: ChatMessage) {
    window.history.back(); setSearchInput(''); setSearchTerm('')
    window.setTimeout(() => void revealMessage(item.id), 0)
  }

  const leaveConversation = () => location.state && (location.state as { chatBack?: string }).chatBack ? navigate(-1) : navigate('/chat', { replace: true })
  const searchAction = <button type="button" className="chat-page-search" aria-label={searchOpen ? 'Закрыть поиск' : 'Поиск по переписке'} onClick={() => searchOpen ? window.history.back() : setSearchOpen(true)}>{searchOpen ? <CloseIcon /> : <SearchIcon />}</button>
  const blockedByMe = thread?.blockedByMe === true
  const chatAction = <div className="chat-page-actions">{searchAction}<OverflowMenu label="Действия с диалогом" items={[{
    label: blockedByMe ? 'Разблокировать' : 'Заблокировать', danger: !blockedByMe, disabled: block.isPending,
    onClick: () => void (async () => {
      if (!blockedByMe && !await confirm({ message: 'Заблокировать этот диалог?', confirmLabel: 'Заблокировать', danger: true })) return
      block.mutate(!blockedByMe)
    })(),
  }]} /></div>
  const connected = connection.data?.activeConnection ?? thread?.activeConnection ?? false
  const connectionError = invite.error || accept.error

  return <><Page title={thread?.partnerName ?? 'Диалог'} subtitle={!connected && thread ? 'Не подключён' : undefined}
    back="/chat" onBack={leaveConversation} swipeBack className="chat-conversation-page" action={chatAction}>
    <AsyncView loading={messages.isLoading || threads.isLoading || unread.isLoading || connection.isLoading} error={messages.error ?? threads.error ?? unread.error ?? connection.error} onRetry={() => { void messages.refetch(); void threads.refetch(); void unread.refetch(); void connection.refetch() }}>
      {searchOpen && <section className="chat-search" aria-label="Поиск по переписке">
        <form onSubmit={(event) => { event.preventDefault(); setSearchTerm(searchInput.trim()) }}><SearchIcon /><input autoFocus type="search" value={searchInput} maxLength={100} placeholder="Найти сообщение" aria-label="Текст для поиска" onChange={(event) => setSearchInput(event.target.value)} /><button type="submit" disabled={searchInput.trim().length < 2}>Найти</button></form>
        {searchTerm && <div className="chat-search-results">{search.isFetching && <p>Ищем…</p>}{search.error && <div className="chat-search-error" role="alert"><span>Не удалось выполнить поиск</span><button type="button" onClick={() => void search.refetch()}>Повторить</button></div>}{search.data?.length === 0 && <p>Ничего не найдено</p>}{search.data?.map((item) => <button type="button" key={item.id} onClick={() => void openSearchResult(item)}><strong>{item.senderId === actor?.userId ? 'Вы' : thread?.partnerName ?? 'Собеседник'}</strong><span><HighlightedText text={item.body} query={searchTerm} /></span><time>{dateLabel(item.createdAt)}</time></button>)}</div>}
      </section>}
      <section ref={surfaceRef} className="chat-surface" aria-label="Переписка">
        {!connected && connection.data && <section className="chat-connection-card" aria-label="Связь с тренером">
          {connection.data.trainerSwitchRequired
            ? <><strong>У вас уже есть тренер</strong><span>Сначала отключите его в профиле.</span></>
            : actor?.role === 'trainer'
              ? connection.data.invitationPending
                ? <><strong>Приглашение отправлено</strong><span>Спортсмен увидит его здесь.</span></>
                : <><strong>Начать совместные тренировки?</strong><button type="button" className="secondary" disabled={!connection.data.canInvite || invite.isPending} onClick={() => invite.mutate()}>{invite.isPending ? 'Отправляем…' : 'Предложить тренировки'}</button></>
              : connection.data.invitationPending
                ? <><strong>Тренер предлагает заниматься вместе</strong><button type="button" className="primary" disabled={!connection.data.canAccept || accept.isPending} onClick={() => accept.mutate()}>{accept.isPending ? 'Подключаем…' : 'Подключиться'}</button></>
                : <><strong>Можно общаться без подключения</strong><span>Тренировки пока недоступны тренеру.</span></>}
          {connectionError && <span className="error" role="alert">Не удалось выполнить действие</span>}
        </section>}
        {nextCursor && <button type="button" className="link chat-load-older" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Загружаем…' : 'Ранее'}</button>}
        {visible.length === 0 && <StatePanel compact tone="info" title="Начните диалог" description="Напишите первое сообщение." />}
        <div className="chat-messages">{visible.map((item) => {
          const local = pending.find((candidate) => candidate.id === item.id)
          const own = item.senderId === actor?.userId
          return <div key={item.id} className="chat-message-wrap">
            {unread.data?.firstMessageId === item.id && <div className="chat-unread-divider"><span>Новые сообщения</span></div>}
            <article data-message-id={item.id} className={`chat-message ${own ? 'own' : 'partner'} ${item.image ? 'with-photo' : ''} ${highlightedId === item.id ? 'highlighted' : ''}`}
              role="button" tabIndex={0} aria-label={`Открыть действия: ${item.body || 'Фото'}`} onClick={() => setActionMessage(item)}
              onKeyDown={(event: ReactKeyboardEvent) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setActionMessage(item) } }}>
              {item.replyTo && <button type="button" className="chat-reply-quote" onClick={(event) => { event.stopPropagation(); const reply = item.replyTo; if (reply && !reply.deleted) void revealMessage(reply.messageId) }}><strong>{item.replyTo.senderId === actor?.userId ? 'Вы' : thread?.partnerName ?? 'Собеседник'}</strong><span>{replyText(item.replyTo)}</span></button>}
              {item.image?.url ? <button type="button" className="chat-photo-link" aria-label="Открыть фото" onClick={(event) => { event.stopPropagation(); setPhotoMessage(item) }}><img src={item.image.url} alt="Фото в сообщении" width={item.image.width} height={item.image.height} /></button> : item.image && <div className="chat-photo-unavailable">Фото недоступно</div>}
              {item.body && <p>{item.body}</p>}<small><time>{timeLabel(item.createdAt)}</time>{item.editedAt && <span>изменено</span>}{own && <span>{local?.state === 'sending' ? 'Отправляется' : local?.state === 'error' ? 'Ошибка' : 'Отправлено'}</span>}</small>
              {local?.state === 'error' && <button type="button" className="link" onClick={(event) => { event.stopPropagation(); void deliver(local) }}>Повторить</button>}
            </article>
          </div>
        })}<div ref={endRef} /></div>
        {unread.data && unread.data.unreadCount > 0 && <button type="button" className="chat-new-button" onClick={() => unread.data?.firstMessageId && void revealMessage(unread.data.firstMessageId)}>К новым <b>{unread.data.unreadCount}</b></button>}
      </section>
      {thread?.canMessage === false ? <div className="chat-blocked-state" role="status"><strong>{thread.blockedByMe ? 'Диалог заблокирован' : 'Сообщения недоступны'}</strong>{thread.blockedByMe && <button type="button" className="secondary" disabled={block.isPending} onClick={() => block.mutate(false)}>Разблокировать</button>}</div> : <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        {editing && <div className="chat-composer-context"><div><strong>Изменить сообщение</strong><span>{editing.body}</span></div><button type="button" aria-label="Отменить изменение" onClick={cancelEdit}><CloseIcon /></button></div>}
        {replyingTo && !editing && <div className="chat-composer-context"><div><strong>Ответ</strong><span>{replyingTo.body || (replyingTo.image ? 'Фото' : 'Сообщение')}</span></div><button type="button" aria-label="Отменить ответ" onClick={() => setReplyingTo(null)}><CloseIcon /></button></div>}
        {photo && <div className="chat-photo-preview"><img src={photo.dataUrl} alt="Фото для отправки" /><button type="button" aria-label="Убрать фото" onClick={() => setPhoto(null)}><CloseIcon /></button></div>}
        {photoError && <p className="chat-photo-error" role="alert">{photoError}</p>}{composerError && <p className="chat-photo-error" role="alert">{composerError}</p>}
        <div className="chat-composer-row">
          <input ref={photoInputRef} hidden type="file" accept="image/*" aria-label="Выбрать фото" onChange={(event) => void choosePhoto(event.target.files?.[0])} />
          <button type="button" className="chat-attach" disabled={photoBusy || Boolean(editing)} aria-label={photoBusy ? 'Подготавливаем фото' : 'Прикрепить фото'} onClick={() => photoInputRef.current?.click()}><PhotoIcon /></button>
          <label className="sr-only" htmlFor="chat-message">Сообщение</label>
          <textarea ref={messageInputRef} id="chat-message" value={draft} maxLength={4000} rows={1} placeholder={photo ? 'Добавить подпись' : 'Сообщение'} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="chat-send" disabled={(!draft.trim() && !photo) || photoBusy || composerBusy} aria-label={editing ? 'Сохранить изменения' : 'Отправить'}><MessageIcon /></button>
        </div>
      </form>}
    </AsyncView>
  </Page>
  {actionMessage && <ChatActionSheet message={actionMessage} own={actionMessage.senderId === actor?.userId} local={pending.some((item) => item.id === actionMessage.id)} busy={deletingMessageId === actionMessage.id} error={deleteErrorMessageId === actionMessage.id}
    onClose={() => setActionMessage(null)} onReply={() => { setReplyingTo(actionMessage); setEditing(null); messageInputRef.current?.focus() }} onCopy={() => void copyMessage(actionMessage)} onEdit={() => startEdit(actionMessage)} onDelete={() => void removeMessage(actionMessage, pending.find((item) => item.id === actionMessage.id))} onOpenPhoto={() => setPhotoMessage(actionMessage)} />}
  {photoMessage && <ChatPhotoViewer message={photoMessage} onClose={() => setPhotoMessage(null)} />}
  {notice && <div className="chat-notice" role="status">{notice}</div>}
  {confirmDialog}</>
}
