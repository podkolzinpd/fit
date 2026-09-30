import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import type { TrainerFinanceOverview, TrainerFinanceOverviewClient } from '../../data/repositories/trainer-finance.repository'
import { addMonths, formatMonth, localDate, todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { BackIcon, ChevronRightIcon } from '../../shared/icons'
import { AsyncView, Page } from '../../shared/ui'

type FinanceFilter = 'all' | 'due' | 'overdue' | 'low' | 'missing' | 'unassigned'

const FILTERS: Array<{ id: FinanceFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'due', label: 'К оплате' },
  { id: 'overdue', label: 'Просрочено' },
  { id: 'low', label: '1–2 занятия' },
  { id: 'missing', label: 'Нет абонемента' },
  { id: 'unassigned', label: 'Не привязано' },
]

function money(cents: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100)
}

export function trainerFinanceClientLabel(client: TrainerFinanceOverviewClient): string {
  if (client.unassignedSessions > 0) return `Не привязано: ${client.unassignedSessions}`
  if (client.overdue && client.dueCents > 0) return `Просрочено ${money(client.dueCents)}`
  if (client.dueCents > 0) return `К оплате ${money(client.dueCents)}`
  if (client.activePackageCount > 1) return 'Несколько абонементов'
  if (client.sessionsRemaining !== null) return `Осталось ${client.sessionsRemaining} ${client.sessionsRemaining === 1 ? 'занятие' : 'занятий'}`
  return client.activePackageCount === 0 ? 'Абонемента нет' : 'Оплачено'
}

function matchesFilter(client: TrainerFinanceOverviewClient, filter: FinanceFilter) {
  if (filter === 'due') return client.dueCents > 0
  if (filter === 'overdue') return client.overdue
  if (filter === 'low') return client.lowSessions
  if (filter === 'missing') return client.activePackageCount === 0
  if (filter === 'unassigned') return client.unassignedSessions > 0
  return true
}

function monthStart(value: LocalDate) {
  return localDate(`${value.slice(0, 7)}-01`)
}

export function TrainerFinanceOverviewPage() {
  const { actor } = useAuth()
  const { trainerFinance } = useDataBackend()
  const [month, setMonth] = useState(() => monthStart(todayInTimeZone(actor?.timezone)))
  const monthValue = month.slice(0, 7)
  const query = useQuery({
    queryKey: ['trainer-finance-overview', monthValue],
    queryFn: () => trainerFinance.listOverview(monthValue),
  })
  return <TrainerFinanceOverviewView month={month} data={query.data} loading={query.isLoading} error={query.error}
    onPreviousMonth={() => setMonth((value) => addMonths(value, -1))}
    onNextMonth={() => setMonth((value) => addMonths(value, 1))}
    onRetry={() => void query.refetch()} />
}

export function TrainerFinanceOverviewView({ month, data, loading = false, error = null, onPreviousMonth, onNextMonth, onRetry }: {
  month: LocalDate
  data?: TrainerFinanceOverview
  loading?: boolean
  error?: Error | null
  onPreviousMonth: () => void
  onNextMonth: () => void
  onRetry?: () => void
}) {
  const [filter, setFilter] = useState<FinanceFilter>('all')
  const clients = useMemo(() => (data?.clients ?? []).filter((client) => matchesFilter(client, filter)), [filter, data?.clients])
  return <Page title="Финансы" back="/clients" swipeBack className="finance-overview-page">
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
        <div className="finance-filter-row" role="group" aria-label="Фильтр клиентов">{FILTERS.map((item) => <button key={item.id} type="button" className={filter === item.id ? 'is-active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
        <div className="finance-overview-list">{clients.map((client) => <Link className={`card finance-overview-client${client.needsAttention ? ' needs-attention' : ''}`} to={`/clients/${client.clientId}/finance`} key={client.clientId}><span><strong>{client.fullName}</strong>{client.archivedAt && <small>В архиве</small>}</span><span>{trainerFinanceClientLabel(client)}</span><ChevronRightIcon /></Link>)}</div>
        {clients.length === 0 && <p className="finance-empty">В этом разделе клиентов нет.</p>}
      </>}
    </AsyncView>
  </Page>
}
