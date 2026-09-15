import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { bmiLabel } from '../../data/repositories/workouts.repository'
import { AsyncView, Page } from '../../shared/ui'
import { CloseIcon, ProfileIcon, SearchIcon } from '../../shared/icons'
import { ChatStartButton } from '../chat'
import { useChatThreads } from '../chat/use-chat-threads'

// Порог, с которого список перестаёт охватываться взглядом и поиск начинает
// экономить время. Ниже него поле только занимало верх экрана: у тренера с
// тремя-четырьмя спортсменами искать нечего.
const CLIENTS_SEARCH_MIN = 6
const CLIENTS_SCROLL_KEY = 'fit.clientsListScroll'

export function ClientsPage() {
  const { actor } = useAuth()
  const { clients: clientsRepository } = useDataBackend()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const pageRef = useRef<HTMLDivElement>(null)
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

  return <div ref={pageRef}><Page title="Клиенты" className="clients-page" action={query.data?.length ? <Link className="button" to="/clients/new">Добавить</Link> : undefined}>
    <AsyncView loading={query.isLoading} error={query.error} empty={!query.data?.length} onRetry={() => void query.refetch()}
      emptyTitle="Клиентов пока нет"
      emptyDescription="Добавьте первого клиента, чтобы планировать тренировки и отслеживать прогресс."
      emptyAction={<Link className="button" to="/clients/new">Добавить клиента</Link>}>
      {showSearch && <div className="clients-search">
          <SearchIcon aria-hidden="true" />
          <input type="search" aria-label="Поиск клиента" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Поиск по имени" autoComplete="off" />
          {search !== '' && <button type="button" className="clients-search-clear" aria-label="Очистить поиск" onClick={() => updateSearch('')}><CloseIcon /></button>}
        </div>}
      {clients.length > 0 ? <div className="cards clients-list">{clients.map((client) => {
        const thread = threadByClientId.get(client.id)
        const canOpenChat = Boolean(actor?.role === 'trainer' && (thread?.conversationId || (client.hasAccount && !client.archivedAt)))
        return <article className="card client-card" key={client.id}>
          <Link className="client-card-main" to={`/clients/${client.id}`} onClick={rememberListPosition}>
            <span className="client-avatar" aria-hidden="true"><ProfileIcon /></span>
            <span className="client-card-copy"><strong>{client.fullName}</strong><span>{client.ageYears && client.heightCm ? `${client.ageYears} лет · ${client.heightCm} см · ИМТ ${bmiLabel(client.heightCm, client.currentWeightKg)}` : 'Нужно дополнить профиль'}{client.currentWeightKg ? ` · ${client.currentWeightKg} кг` : ''}</span></span>
            {client.archivedAt && <span className="badge">Архив</span>}
          </Link>
          {canOpenChat && <ChatStartButton clientId={client.id} trainerId={thread?.trainerId ?? actor!.userId}
            conversationId={thread?.conversationId} partnerName={client.fullName} unreadCount={thread?.unreadCount ?? 0}
            className="client-chat-action" iconOnly back="clients" onBeforeOpen={rememberListPosition} />}
        </article>
      })}</div> : <p className="clients-search-empty">По этому имени клиентов не найдено.</p>}
    </AsyncView>
  </Page></div>
}
