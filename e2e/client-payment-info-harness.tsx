import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ClientFinanceSummary } from '../src/data/repositories/client-finance.repository'
import { ClientFinanceDetails, ClientFinanceHomeContent } from '../src/features/finance/ClientFinancePage'
import { AnalyticsIcon, HomeIcon, ProfileIcon, ScheduleIcon } from '../src/shared/icons'
import { Page } from '../src/shared/ui'

const finance: ClientFinanceSummary = { trainers: [
  {
    trainerId: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
    trainerName: 'Анастасия Константинопольская-Романова',
    packages: [{
      id: '34df7b20-a0b5-4627-bd98-d4a174625723',
      title: 'Персональные тренировки с очень длинным названием',
      sessionsTotal: 10, sessionsUsed: 2, sessionsRemaining: 8,
      priceCents: 2500000, paidCents: 1000000, dueCents: 1500000,
      startsOn: '2026-09-01', endsOn: '2026-11-30', paymentDueOn: '2026-10-10',
      packageStatus: 'active', paymentStatus: 'partial',
    }, {
      id: '44df7b20-a0b5-4627-bd98-d4a174625724',
      title: 'Следующий абонемент', sessionsTotal: 12, sessionsUsed: 0,
      sessionsRemaining: 12, priceCents: 3000000, paidCents: 3000000, dueCents: 0,
      startsOn: '2026-12-01', endsOn: null, paymentDueOn: null,
      packageStatus: 'upcoming', paymentStatus: 'paid',
    }],
    payments: [{
      id: 'ec3e661a-0ee8-48da-a269-d4f7707427cc',
      packageId: '34df7b20-a0b5-4627-bd98-d4a174625723',
      amountCents: 1000000, receivedOn: '2026-09-01',
    }],
  },
] }

function Navigation() {
  return <nav className="tab-bar client-tab-bar" aria-label="Основная навигация">
    <a href="/me" className="active" aria-current="page"><HomeIcon />Кабинет</a>
    <a href="/me/workouts"><ScheduleIcon />Тренировки</a>
    <a href="/me/progress"><AnalyticsIcon />Прогресс</a>
    <a href="/me/profile"><ProfileIcon />Профиль</a>
  </nav>
}

function Home() {
  return <main className="page today-page"><header className="page-header"><h1>Добрый день, Анна</h1></header><div className="client-home-overview"><ClientFinanceHomeContent finance={finance} /></div></main>
}

function Details() {
  return <Page title="Оплата тренировок" back="/me" className="client-finance-page"><ClientFinanceDetails finance={finance} /></Page>
}

function Harness() {
  return <MemoryRouter initialEntries={['/me']}><div className="phone-frame theme-light ui-identity client-home-identity client-finance-identity"><div className="content"><Routes><Route path="/me" element={<Home />} /><Route path="/me/finance" element={<Details />} /></Routes></div><Navigation /></div></MemoryRouter>
}

export function mountClientPaymentInfoHarness() {
  const original = document.getElementById('root')
  if (original) original.style.display = 'none'
  document.getElementById('client-payment-info-qa')?.remove()
  const mount = document.createElement('div')
  mount.id = 'client-payment-info-qa'
  document.body.append(mount)
  createRoot(mount).render(<Harness />)
}
