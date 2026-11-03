import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { isCoachWorkoutRedesignEnabled } from '../../app/coach-workout-redesign'
import { readCoachCalendarRoute } from '../../app/coach-calendar-navigation'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import type { TrainerFinanceOverview, TrainerFinanceOverviewClient } from '../../data/contracts/trainer-finance'
import { addMonths, formatLocalDateShort, formatMonth, localDate, todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { BackIcon, ChevronRightIcon, CloseIcon, SearchIcon } from '../../shared/icons'
import { AsyncView, Page } from '../../shared/ui'

type FinanceFilter = 'all' | 'due' | 'overdue' | 'low' | 'missing' | 'unassigned' | 'archived'

const FILTERS: Array<{ id: FinanceFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'due', label: 'К оплате' },
  { id: 'overdue', label: 'Просрочено' },
  { id: 'low', label: '1–2 занятия' },
  { id: 'missing', label: 'Нет абонемента' },
  { id: 'unassigned', label: 'Не привязано' },
  { id: 'archived', label: 'Архив' },
]

function money(cents: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100)
}

export function trainerFinanceClientLabel(client: TrainerFinanceOverviewClient): string {
  const paymentDeadline = client.dueCents > 0 && client.nearestPaymentDueOn && client.unpaidPackageCount > 0
    ? formatLocalDateShort(localDate(client.nearestPaymentDueOn)).slice(0, 5)
    : null
  const dueLabel = client.overdue ? `Просрочено ${money(client.dueCents)}` : `К оплате ${money(client.dueCents)}`
  const unassigned = client.unassignedSessions > 0 ? `Не привязано: ${client.unassignedSessions}` : null
  if (client.dueCents > 0) return `${dueLabel}${paymentDeadline
    ? client.unpaidPackageCount === 1 ? ` · до ${paymentDeadline}` : `\nБлижайший срок — ${paymentDeadline}`
    : ''}${unassigned ? `\n${unassigned}` : ''}`
  if (unassigned) return unassigned
  if (client.activePackageCount > 1) return 'Несколько абонементов'
  if (client.sessionsRemaining !== null) return `Осталось ${client.sessionsRemaining} ${client.sessionsRemaining === 1 ? 'занятие' : 'занятий'}`
  if (client.upcomingPackageCount > 0) return 'Абонемент начнётся позже'
  return client.activePackageCount === 0 ? 'Абонемента нет' : 'Оплачено'
}

function matchesFilter(client: TrainerFinanceOverviewClient, filter: FinanceFilter) {
  const active = client.archivedAt === null && client.activeClient !== false
  if (filter === 'due') return client.dueCents > 0
  if (filter === 'overdue') return client.overdue
  if (filter === 'unassigned') return client.unassignedSessions > 0
  if (filter === 'archived') return !active
  if (!active) return false
  if (filter === 'low') return client.lowSessions
  if (filter === 'missing') return client.activePackageCount === 0 && client.upcomingPackageCount === 0
  return true
}

function monthStart(value: LocalDate) {
  return localDate(`${value.slice(0, 7)}-01`)
}

function selectedMonth(value: string | null, today: LocalDate): LocalDate {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    try { return localDate(`${value}-01`) } catch { /* Invalid URL dates use the current month. */ }
  }
  return monthStart(today)
}

export function TrainerFinanceOverviewPage() {
  const { actor } = useAuth()
  const { trainerFinance } = useDataBackend()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const monthParam = params.get('month')
  const month = selectedMonth(monthParam, todayInTimeZone(actor?.timezone))
  const filter = FILTERS.find((item) => item.id === params.get('filter'))?.id ?? 'all'
  const search = params.get('q') ?? ''
  const changeSearch = (value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set('q', value); else next.delete('q')
    setParams(next, { replace: true })
  }
  const change = (nextMonth: LocalDate, nextFilter: FinanceFilter) => {
    const next = new URLSearchParams(params)
    next.set('month', nextMonth.slice(0, 7))
    if (nextFilter === 'all') next.delete('filter'); else next.set('filter', nextFilter)
    setParams(next, { replace: true })
  }
  const monthValue = month.slice(0, 7)
  const query = useQuery({
    queryKey: ['trainer-finance-overview', monthValue],
    queryFn: () => trainerFinance.listOverview(monthValue),
  })
  return <TrainerFinanceOverviewView month={month} data={query.data} loading={query.isLoading} error={query.error}
    search={search} onSearchChange={changeSearch}
    filter={filter} onFilterChange={(value) => change(month, value)} returnTo={`${location.pathname}${location.search}`}
    back={isCoachWorkoutRedesignEnabled(actor) ? readCoachCalendarRoute(actor?.userId) ?? '/today' : '/clients'}
    onPreviousMonth={() => change(addMonths(month, -1), filter)}
    onNextMonth={() => change(addMonths(month, 1), filter)}
    onRetry={() => void query.refetch()} />
}

export function TrainerFinanceOverviewView({ month, data, loading = false, error = null, onPreviousMonth, onNextMonth, onRetry, filter: controlledFilter, onFilterChange, search: controlledSearch, onSearchChange, returnTo = '/finance', back = '/clients' }: {
  search?: string
  onSearchChange?: (value: string) => void
  filter?: FinanceFilter
  onFilterChange?: (filter: FinanceFilter) => void
  returnTo?: string
  back?: string
  month: LocalDate
  data?: TrainerFinanceOverview
  loading?: boolean
  error?: Error | null
  onPreviousMonth: () => void
  onNextMonth: () => void
  onRetry?: () => void
}) {
  const [localFilter, setLocalFilter] = useState<FinanceFilter>('all')
  const [localSearch, setLocalSearch] = useState('')
  const filter = controlledFilter ?? localFilter
  const setFilter = onFilterChange ?? setLocalFilter
  const search = controlledSearch ?? localSearch
  const setSearch = onSearchChange ?? setLocalSearch
  const clients = useMemo(() => {
    const name = search.trim().toLocaleLowerCase('ru')
    return (data?.clients ?? []).filter(client => matchesFilter(client, filter)
      && (!name || client.fullName.toLocaleLowerCase('ru').includes(name)))
  }, [filter, search, data?.clients])
  return <Page title="Финансы" back={back} swipeBack className="finance-overview-page">
    <div className="finance-period-block">
      <span>Период</span>
      <div className="finance-month-switcher" aria-label="Месяц финансов">
      <button type="button" aria-label="Предыдущий месяц" onClick={onPreviousMonth}><BackIcon /></button>
      <strong>{formatMonth(month)}</strong>
      <button type="button" aria-label="Следующий месяц" onClick={onNextMonth}><ChevronRightIcon /></button>
      </div>
    </div>
    <AsyncView loading={loading} error={error} onRetry={onRetry}>
      {data && <>
        <section className="finance-overview-summary" aria-label="Финансовая сводка">
          <p><span>Получено за месяц</span><strong>{money(data.receivedCents)}</strong></p>
          <p><span>К оплате сейчас</span><strong>{money(data.dueCents)}</strong></p>
          <p><span>Требуют внимания сейчас</span><strong>{data.attentionCount}</strong></p>
        </section>
        {(data.clients.length > 0 || search) && <div className="clients-search finance-overview-search">
          <SearchIcon aria-hidden="true" /><input type="search" aria-label="Поиск клиента" placeholder="Поиск по имени" autoComplete="off" value={search} onChange={event => setSearch(event.target.value)} />
          {search !== '' && <button type="button" className="clients-search-clear" aria-label="Очистить поиск" onClick={() => setSearch('')}><CloseIcon /></button>}
        </div>}
        <div className="finance-filter-row" role="group" aria-label="Фильтр клиентов">{FILTERS.map((item) => <button key={item.id} type="button" className={filter === item.id ? 'is-active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
        <div className="finance-overview-list">{clients.map((client) => <Link className={`card finance-overview-client${client.needsAttention ? ' needs-attention' : ''}`} to={`/clients/${client.clientId}/finance`} state={{ financeBackTo: returnTo }} key={client.clientId}><span><strong>{client.fullName}</strong>{client.archivedAt ? <small>В архиве</small> : client.activeClient === false ? <small>Связь завершена</small> : null}</span><span>{trainerFinanceClientLabel(client)}</span><ChevronRightIcon /></Link>)}</div>
        {clients.length === 0 && <p className="finance-empty">{search.trim() ? 'Ничего не найдено.' : 'В этом разделе клиентов нет.'}</p>}
      </>}
    </AsyncView>
  </Page>
}
