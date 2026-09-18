import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { bmiLabel } from '../../data/repositories/workouts.repository'
import type { Client } from '../../shared/domain'
import { AsyncView, Page } from '../../shared/ui'
import { CloseIcon, MoreIcon, ProfileIcon, SearchIcon } from '../../shared/icons'
import { ChatStartButton } from '../chat'
import { useChatThreads } from '../chat/use-chat-threads'
import { InviteAthleteButton } from '../auth/InvitationShareActions'

// Порог, с которого список перестаёт охватываться взглядом и поиск начинает
// экономить время. Ниже него поле только занимало верх экрана: у тренера с
// тремя-четырьмя спортсменами искать нечего.
const CLIENTS_SEARCH_MIN = 6
const CLIENTS_SCROLL_KEY = 'fit.clientsListScroll'
const CLIENT_SWIPE_WIDTH = 112

interface ClientSwipeCardProps {
  client: Client
  canOpenChat: boolean
  conversationId?: string | null
  trainerId: string
  unreadCount: number
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onArchiveChange: (client: Client, archived: boolean) => void
  onBeforeOpen: () => void
}

function ClientSwipeCard({
  client, canOpenChat, conversationId, trainerId, unreadCount, open, busy,
  onOpenChange, onArchiveChange, onBeforeOpen,
}: ClientSwipeCardProps) {
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  const dragOffsetRef = useRef<number | null>(null)
  const pointer = useRef<{ id: number; x: number; y: number; axis: 'pending' | 'horizontal' | 'vertical' } | null>(null)
  const suppressClick = useRef(false)
  const archived = client.archivedAt !== null
  const baseOffset = open ? -CLIENT_SWIPE_WIDTH : 0

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (busy || event.button !== 0 || (event.target as Element).closest('button, input, textarea, select')) return
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: 'pending' }
  }
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const active = pointer.current
    if (!active || active.id !== event.pointerId || active.axis === 'vertical') return
    const deltaX = event.clientX - active.x
    const deltaY = event.clientY - active.y
    if (active.axis === 'pending') {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 8) return
      active.axis = Math.abs(deltaX) > Math.abs(deltaY) * 1.2 ? 'horizontal' : 'vertical'
      if (active.axis === 'vertical') return
    }
    event.preventDefault()
    suppressClick.current = true
    const nextOffset = Math.max(-CLIENT_SWIPE_WIDTH, Math.min(0, baseOffset + deltaX))
    dragOffsetRef.current = nextOffset
    setDragOffset(nextOffset)
  }
  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const active = pointer.current
    if (!active || active.id !== event.pointerId) return
    pointer.current = null
    if (active.axis === 'horizontal') {
      const finalOffset = dragOffsetRef.current ?? baseOffset
      onOpenChange(finalOffset <= -CLIENT_SWIPE_WIDTH / 2)
      window.setTimeout(() => { suppressClick.current = false }, 0)
    }
    dragOffsetRef.current = null
    setDragOffset(null)
  }
  const captureClick = (event: React.MouseEvent<HTMLElement>) => {
    if (suppressClick.current) {
      event.preventDefault()
      event.stopPropagation()
      suppressClick.current = false
      return
    }
    if (open && !(event.target as Element).closest('.client-card-menu')) {
      event.preventDefault()
      event.stopPropagation()
      onOpenChange(false)
    }
  }

  return <div className={`client-swipe-row${open ? ' is-open' : ''}${open || dragOffset !== null ? ' is-revealing' : ''}`} data-client-swipe-id={client.id}
    onKeyDown={(event) => { if (event.key === 'Escape') onOpenChange(false) }}>
    <div className={`client-swipe-actions${archived ? ' is-restore' : ''}`} aria-hidden={!open}>
      <button type="button" tabIndex={open ? 0 : -1} disabled={busy}
        onClick={() => onArchiveChange(client, !archived)}>
        {archived ? 'Восстановить' : 'В архив'}
      </button>
    </div>
    <article className="card client-card client-swipe-surface"
      style={{ transform: `translate3d(${dragOffset ?? baseOffset}px, 0, 0)` }}
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}
      onClickCapture={captureClick}>
      <Link className="client-card-main" to={`/clients/${client.id}`} onClick={onBeforeOpen}>
        <span className="client-avatar" aria-hidden="true"><ProfileIcon /></span>
        <span className="client-card-copy"><strong>{client.fullName}</strong><span>{client.ageYears && client.heightCm ? `${client.ageYears} лет · ${client.heightCm} см · ИМТ ${bmiLabel(client.heightCm, client.currentWeightKg)}` : 'Нужно дополнить профиль'}{client.currentWeightKg ? ` · ${client.currentWeightKg} кг` : ''}</span></span>
        {client.archivedAt && <span className="badge">Архив</span>}
      </Link>
      {canOpenChat && <ChatStartButton clientId={client.id} trainerId={trainerId}
        conversationId={conversationId} partnerName={client.fullName} unreadCount={unreadCount}
        className="client-chat-action" iconOnly back="clients" onBeforeOpen={onBeforeOpen} />}
      <button type="button" className="client-card-menu" aria-label={`Действия с клиентом ${client.fullName}`}
        aria-expanded={open} disabled={busy} onClick={() => onOpenChange(!open)}><MoreIcon /></button>
    </article>
  </div>
}

export function ClientsPage() {
  const { actor } = useAuth()
  const { clients: clientsRepository } = useDataBackend()
  const queryClient = useQueryClient()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const pageRef = useRef<HTMLDivElement>(null)
  const [openClientId, setOpenClientId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ client: Client; message: string; canUndo: boolean } | null>(null)
  const showArchived = window.localStorage?.getItem('fit.showArchivedClients') === 'true'
  // Список — рабочая очередь тренера, поэтому при каждом входе показываем
  // актуальную активность, а не данные из короткого SPA-кэша.
  const query = useQuery({ queryKey: ['clients', showArchived], queryFn: () => clientsRepository.list(showArchived), refetchOnMount: 'always' })
  const threads = useChatThreads()
  const search = searchParams.get('q') ?? ''
  const threadByClientId = useMemo(() => new Map((threads.data ?? []).map((thread) => [thread.clientId, thread])), [threads.data])
  // Порог считаем по всему списку, а не по отфильтрованному: иначе поле
  // исчезало бы прямо во время ввода, как только совпадений станет мало.
  const showSearch = (query.data?.length ?? 0) >= CLIENTS_SEARCH_MIN
  const clients = useMemo(() => {
    // Если список успел сократиться ниже порога, набранный ранее запрос не
    // должен продолжать скрывать карточки: поля для его сброса уже нет.
    const normalizedSearch = showSearch ? search.trim().toLocaleLowerCase('ru') : ''
    return query.data
      ?.filter((client) => !normalizedSearch || client.fullName.toLocaleLowerCase('ru').includes(normalizedSearch))
      .sort((left, right) => (right.lastActivityAt ?? '').localeCompare(left.lastActivityAt ?? '')) ?? []
  }, [query.data, search, showSearch])
  const archive = useMutation({
    mutationFn: ({ client, archived }: { client: Client; archived: boolean }) => clientsRepository.setArchived(client, archived),
    onSuccess: async (updated, variables) => {
      setOpenClientId(null)
      setFeedback({
        client: updated,
        message: variables.archived ? `Карточка «${updated.fullName}» перемещена в архив` : `Карточка «${updated.fullName}» восстановлена`,
        canUndo: variables.archived,
      })
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
  })

  const updateSearch = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('q', value); else next.delete('q')
    setSearchParams(next, { replace: true })
  }
  const rememberListPosition = () => {
    const viewport = pageRef.current?.closest<HTMLElement>('.content')
    if (!viewport || !window.sessionStorage) return
    window.sessionStorage.setItem(CLIENTS_SCROLL_KEY, JSON.stringify({ path: `${location.pathname}${location.search}`, top: viewport.scrollTop }))
  }
  useEffect(() => {
    if (!query.isSuccess || !window.sessionStorage) return
    let stored: { path?: string; top?: number } | null = null
    try { stored = JSON.parse(window.sessionStorage.getItem(CLIENTS_SCROLL_KEY) ?? 'null') as { path?: string; top?: number } | null } catch { stored = null }
    if (!stored) return
    if (stored.path !== `${location.pathname}${location.search}` || typeof stored.top !== 'number') {
      window.sessionStorage.removeItem(CLIENTS_SCROLL_KEY)
      return
    }
    let frame = 0
    let attempts = 0
    const restore = () => {
      const viewport = pageRef.current?.closest<HTMLElement>('.content')
      const target = stored?.top ?? 0
      viewport?.scrollTo(0, target)
      attempts += 1
      if (viewport && (Math.abs(viewport.scrollTop - target) <= 1 || attempts >= 12)) {
        window.sessionStorage.removeItem(CLIENTS_SCROLL_KEY)
        return
      }
      frame = window.requestAnimationFrame(restore)
    }
    frame = window.requestAnimationFrame(restore)
    return () => window.cancelAnimationFrame(frame)
  }, [location.pathname, location.search, query.isSuccess])

  const pageActions = <div className="clients-page-header-actions">
    <Link className="button secondary" to="/clients/new">Добавить</Link>
    <InviteAthleteButton className="button" label="Пригласить" />
  </div>

  return <div ref={pageRef} onPointerDownCapture={(event) => {
    if (!openClientId) return
    const row = (event.target as Element).closest<HTMLElement>('[data-client-swipe-id]')
    if (row?.dataset.clientSwipeId !== openClientId) setOpenClientId(null)
  }}><Page title="Клиенты" className="clients-page" action={pageActions}>
    {feedback && <div className="clients-archive-feedback" role="status">
      <span>{feedback.message}</span>
      {feedback.canUndo && <button type="button" className="link" disabled={archive.isPending}
        onClick={() => archive.mutate({ client: feedback.client, archived: false })}>Вернуть</button>}
      <button type="button" className="clients-archive-feedback-close" aria-label="Закрыть сообщение" onClick={() => setFeedback(null)}><CloseIcon /></button>
    </div>}
    {archive.error && <p className="error clients-archive-error" role="alert">{archive.error.message}</p>}
    <AsyncView loading={query.isLoading} error={query.error} empty={!query.data?.length} onRetry={() => void query.refetch()}
      emptyTitle="Клиентов пока нет"
      emptyDescription="Пригласите первого спортсмена или создайте его профиль вручную."
      emptyAction={<Link className="button secondary" to="/clients/new">Создать профиль вручную</Link>}>
      {showSearch && <div className="clients-search">
          <SearchIcon aria-hidden="true" />
          <input type="search" aria-label="Поиск клиента" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Поиск по имени" autoComplete="off" />
          {search !== '' && <button type="button" className="clients-search-clear" aria-label="Очистить поиск" onClick={() => updateSearch('')}><CloseIcon /></button>}
        </div>}
      {clients.length > 0 ? <div className="cards clients-list">{clients.map((client) => {
        const thread = threadByClientId.get(client.id)
        const canOpenChat = Boolean(actor?.role === 'trainer' && (thread?.conversationId || (client.hasAccount && !client.archivedAt)))
        if (!client.canArchive) return <article className="card client-card" key={client.id}>
            <Link className="client-card-main" to={`/clients/${client.id}`} onClick={rememberListPosition}>
              <span className="client-avatar" aria-hidden="true"><ProfileIcon /></span>
              <span className="client-card-copy"><strong>{client.fullName}</strong><span>{client.ageYears && client.heightCm ? `${client.ageYears} лет · ${client.heightCm} см · ИМТ ${bmiLabel(client.heightCm, client.currentWeightKg)}` : 'Нужно дополнить профиль'}{client.currentWeightKg ? ` · ${client.currentWeightKg} кг` : ''}</span></span>
              {client.archivedAt && <span className="badge">Архив</span>}
            </Link>
            {canOpenChat && <ChatStartButton clientId={client.id} trainerId={thread?.trainerId ?? actor!.userId}
              conversationId={thread?.conversationId} partnerName={client.fullName} unreadCount={thread?.unreadCount ?? 0}
              className="client-chat-action" iconOnly back="clients" onBeforeOpen={rememberListPosition} />}
          </article>
        return <ClientSwipeCard key={client.id} client={client} canOpenChat={canOpenChat}
          conversationId={thread?.conversationId} trainerId={thread?.trainerId ?? actor!.userId}
          unreadCount={thread?.unreadCount ?? 0} open={openClientId === client.id}
          busy={archive.isPending} onOpenChange={(open) => setOpenClientId(open ? client.id : null)}
          onArchiveChange={(target, archived) => archive.mutate({ client: target, archived })}
          onBeforeOpen={rememberListPosition} />
      })}</div> : <p className="clients-search-empty">По этому имени клиентов не найдено.</p>}
    </AsyncView>
    <Link className="clients-code-fallback" aria-label="Ввести код" to="/join">Ввести код приглашения</Link>
  </Page></div>
}
