import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { TrainerFinanceOverviewView } from '../src/features/finance/TrainerFinanceOverviewPage'
import { AssistantIcon, ClientsIcon, ScheduleIcon, TodayIcon } from '../src/shared/icons'
import { localDate } from '../src/shared/local-date'

const data = {
  month: '2026-09',
  receivedCents: 12500000,
  dueCents: 3500000,
  attentionCount: 2,
  clients: [
    { clientId: '11111111-1111-4111-8111-111111111111', fullName: 'Анна Смирнова', archivedAt: null, receivedCents: 7500000, dueCents: 2500000, activePackageCount: 1, upcomingPackageCount: 0, sessionsRemaining: 2, overdue: true, lowSessions: true, unassignedSessions: 0, needsAttention: true },
    { clientId: '22222222-2222-4222-8222-222222222222', fullName: 'Александр Константинопольский', archivedAt: null, receivedCents: 5000000, dueCents: 1000000, activePackageCount: 1, upcomingPackageCount: 0, sessionsRemaining: 8, overdue: false, lowSessions: false, unassignedSessions: 1, needsAttention: true },
    { clientId: '33333333-3333-4333-8333-333333333333', fullName: 'Василий Петров', archivedAt: null, receivedCents: 0, dueCents: 0, activePackageCount: 1, upcomingPackageCount: 0, sessionsRemaining: 10, overdue: false, lowSessions: false, unassignedSessions: 0, needsAttention: false },
  ],
}

function Harness() {
  return <MemoryRouter initialEntries={['/finance']}>
    <div className="phone-frame theme-light ui-identity trainer-finance-identity">
      <div className="content">
        <TrainerFinanceOverviewView month={localDate('2026-09-01')} data={data}
          onPreviousMonth={() => undefined} onNextMonth={() => undefined} />
      </div>
      <nav className="tab-bar trainer-tab-bar" aria-label="Основная навигация">
        <a href="/today"><TodayIcon />Сегодня</a>
        <a href="/clients" className="active" aria-current="page"><ClientsIcon />Клиенты</a>
        <a href="/assistant"><AssistantIcon />Ассистент</a>
        <a href="/schedule"><ScheduleIcon />Расписание</a>
      </nav>
    </div>
  </MemoryRouter>
}

export function mountFinanceOverviewHarness() {
  const original = document.getElementById('root')
  if (original) original.style.display = 'none'
  const mount = document.createElement('div')
  mount.id = 'finance-overview-qa'
  document.body.append(mount)
  createRoot(mount).render(<Harness />)
}
