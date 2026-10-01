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
      kind: 'session_pack',
      title: 'Персональные тренировки с очень длинным названием',
      sessionsTotal: 10, sessionsUsed: 2, sessionsRemaining: 8,
      priceCents: 2500000, paidCents: 1000000, dueCents: 1500000,
      startsOn: '2026-09-01', endsOn: '2026-11-30', paymentDueOn: '2026-10-10',
      packageStatus: 'active', paymentStatus: 'partial',
    }, {
      id: '44df7b20-a0b5-4627-bd98-d4a174625724',
      kind: 'session_pack',
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
    <a href="/me"><HomeIcon />Кабинет</a>
    <a href="/me/workouts"><ScheduleIcon />Тренировки</a>
    <a href="/me/progress"><AnalyticsIcon />Прогресс</a>
    <a href="/me/profile" className="active" aria-current="page"><ProfileIcon />Профиль</a>
  </nav>
}

function Home({ summary }: { summary: ClientFinanceSummary }) {
  return <main className="page client-profile-page"><header className="page-header"><h1>Профиль</h1></header><section className="client-home-connections" aria-label="Связь с тренером"><div className="client-home-section-head"><div><p className="eyebrow">СВЯЗЬ С ТРЕНЕРОМ</p><h2>Мои тренеры</h2></div></div><article className="card client-trainer-connection-card"><span className="client-trainer-avatar">А</span><div className="client-trainer-person"><strong>Анастасия</strong><p>Основной тренер</p></div></article><ClientFinanceHomeContent finance={summary} /><a className="button secondary client-trainer-search" href="/me/trainers">Найти тренера</a></section></main>
}

function Details({ summary }: { summary: ClientFinanceSummary }) {
  return <Page title="Оплата тренировок" back="/me/profile" className="client-finance-page"><ClientFinanceDetails finance={summary} /></Page>
}

function Harness({ summary }: { summary: ClientFinanceSummary }) {
  return <MemoryRouter initialEntries={['/me/profile']}><div className="phone-frame theme-light ui-identity client-profile-shell-identity client-finance-identity"><div className="content"><Routes><Route path="/me/profile" element={<Home summary={summary} />} /><Route path="/me/finance" element={<Details summary={summary} />} /></Routes></div><Navigation /></div></MemoryRouter>
}

export function mountClientPaymentInfoHarness(empty = false) {
  const original = document.getElementById('root')
  if (original) original.style.display = 'none'
  document.getElementById('client-payment-info-qa')?.remove()
  const mount = document.createElement('div')
  mount.id = 'client-payment-info-qa'
  document.body.append(mount)
  createRoot(mount).render(<Harness summary={empty ? { trainers: [] } : finance} />)
}
