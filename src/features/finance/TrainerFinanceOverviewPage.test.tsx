import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrainerFinanceOverviewClient } from '../../data/repositories/trainer-finance.repository'
import { TrainerFinanceOverviewPage, trainerFinanceClientLabel } from './TrainerFinanceOverviewPage'

const listOverview = vi.hoisted(() => vi.fn())
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { role: 'trainer', userId: 'trainer-1', timezone: 'Europe/Moscow' } }) }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ trainerFinance: { listOverview } }) }))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<MemoryRouter initialEntries={['/finance']}><QueryClientProvider client={queryClient}><Routes>
    <Route path="/finance" element={<TrainerFinanceOverviewPage />} />
    <Route path="/clients/:clientId/finance" element={<FinanceTarget />} />
  </Routes></QueryClientProvider></MemoryRouter>)
}

function FinanceTarget() {
  const location = useLocation()
  const routeState: unknown = location.state
  const financeBackTo = routeState && typeof routeState === 'object' && 'financeBackTo' in routeState
    ? String(routeState.financeBackTo)
    : ''
  return <p>Финансы клиента · возврат {financeBackTo}</p>
}

describe('trainerFinanceClientLabel deadlines', () => {
  const client: TrainerFinanceOverviewClient = {
    clientId: 'client', fullName: 'Клиент', archivedAt: null, receivedCents: 0, dueCents: 250000,
    nearestPaymentDueOn: '2026-10-08', unpaidPackageCount: 1, activePackageCount: 1, upcomingPackageCount: 0,
    sessionsRemaining: 5, overdue: false, lowSessions: false, unassignedSessions: 0, needsAttention: false,
  }
  it('shows one calendar deadline next to the debt', () => {
    expect(trainerFinanceClientLabel(client)).toMatch(/^К оплате 2\s500\s₽ · до 08\.10$/)
  })
  it('keeps the aggregate debt separate from the nearest deadline of multiple packages', () => {
    expect(trainerFinanceClientLabel({ ...client, unpaidPackageCount: 2 })).toMatch(/^К оплате 2\s500\s₽\nБлижайший срок — 08\.10$/)
  })
  it('does not invent a date when the deadline or additive API fields are missing', () => {
    expect(trainerFinanceClientLabel({ ...client, nearestPaymentDueOn: null })).not.toMatch(/до|срок/)
    expect(trainerFinanceClientLabel({ ...client, unpaidPackageCount: 0 })).not.toMatch(/до|срок/)
  })
  it('does not show an obsolete deadline for a paid client', () => {
    expect(trainerFinanceClientLabel({ ...client, dueCents: 0 })).not.toMatch(/до|срок/)
  })
  it('preserves the overdue state and deadline', () => {
    expect(trainerFinanceClientLabel({ ...client, overdue: true })).toMatch(/^Просрочено .* · до 08\.10$/)
  })
  it('preserves the unassigned-session priority without hiding the nearest deadline', () => {
    expect(trainerFinanceClientLabel({ ...client, unassignedSessions: 2 })).toBe('Не привязано: 2\nБлижайший срок — 08.10')
  })
})

describe('TrainerFinanceOverviewPage', () => {
  beforeEach(() => {
    listOverview.mockReset().mockResolvedValue({
      month: '2026-09', receivedCents: 2500000, dueCents: 500000, attentionCount: 1,
      clients: [
        { clientId: '1a0c5295-0a0f-4ccb-a39a-e58090967245', fullName: 'Анна Смирнова', archivedAt: null, receivedCents: 2500000, dueCents: 500000, nearestPaymentDueOn: null, unpaidPackageCount: 0, activePackageCount: 1, upcomingPackageCount: 0, sessionsRemaining: 2, overdue: true, lowSessions: true, unassignedSessions: 0, needsAttention: true },
        { clientId: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b', fullName: 'Борис Иванов', archivedAt: null, receivedCents: 0, dueCents: 0, nearestPaymentDueOn: null, unpaidPackageCount: 0, activePackageCount: 0, upcomingPackageCount: 0, sessionsRemaining: null, overdue: false, lowSessions: false, unassignedSessions: 0, needsAttention: false },
        { clientId: '3fe240f2-6d78-4b02-a807-1b93194596d7', fullName: 'Вера Петрова', archivedAt: null, receivedCents: 0, dueCents: 0, nearestPaymentDueOn: null, unpaidPackageCount: 0, activePackageCount: 0, upcomingPackageCount: 1, sessionsRemaining: null, overdue: false, lowSessions: false, unassignedSessions: 0, needsAttention: false },
      ],
    })
  })

  it('shows the monthly summary and filters clients by actionable state', async () => {
    const user = userEvent.setup()
    renderPage()

    const summary = await screen.findByRole('region', { name: 'Финансовая сводка' })
    expect(within(summary).getByText(/25.*000.*₽/)).toBeVisible()
    expect(within(summary).getByText(/^5.*000.*₽$/)).toBeVisible()
    expect(screen.getByRole('link', { name: /Анна Смирнова/ })).toHaveAttribute('href', '/clients/1a0c5295-0a0f-4ccb-a39a-e58090967245/finance')
    expect(screen.getByText('Борис Иванов')).toBeVisible()
    expect(screen.getByText('Абонемент начнётся позже')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Просрочено' }))
    expect(screen.getByText('Анна Смирнова')).toBeVisible()
    expect(screen.queryByText('Борис Иванов')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Нет абонемента' }))
    expect(screen.getByText('Борис Иванов')).toBeVisible()
    expect(screen.queryByText('Вера Петрова')).not.toBeInTheDocument()
  })

  it('keeps the finance overview as the return destination', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('link', { name: /Анна Смирнова/ }))
    expect(screen.getByText('Финансы клиента · возврат /finance')).toBeVisible()
  })
})
