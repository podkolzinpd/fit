import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TrainerFinanceOverviewPage } from './TrainerFinanceOverviewPage'

const listOverview = vi.hoisted(() => vi.fn())
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { role: 'trainer', userId: 'trainer-1', timezone: 'Europe/Moscow' } }) }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ trainerFinance: { listOverview } }) }))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<MemoryRouter initialEntries={['/finance']}><QueryClientProvider client={queryClient}><Routes>
    <Route path="/finance" element={<TrainerFinanceOverviewPage />} />
    <Route path="/clients/:clientId/finance" element={<p>Финансы клиента</p>} />
  </Routes></QueryClientProvider></MemoryRouter>)
}

describe('TrainerFinanceOverviewPage', () => {
  beforeEach(() => {
    listOverview.mockReset().mockResolvedValue({
      month: '2026-09', receivedCents: 2500000, dueCents: 500000, attentionCount: 1,
      clients: [
        { clientId: '1a0c5295-0a0f-4ccb-a39a-e58090967245', fullName: 'Анна Смирнова', archivedAt: null, receivedCents: 2500000, dueCents: 500000, activePackageCount: 1, upcomingPackageCount: 0, sessionsRemaining: 2, overdue: true, lowSessions: true, unassignedSessions: 0, needsAttention: true },
        { clientId: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b', fullName: 'Борис Иванов', archivedAt: null, receivedCents: 0, dueCents: 0, activePackageCount: 0, upcomingPackageCount: 0, sessionsRemaining: null, overdue: false, lowSessions: false, unassignedSessions: 0, needsAttention: false },
        { clientId: '3fe240f2-6d78-4b02-a807-1b93194596d7', fullName: 'Вера Петрова', archivedAt: null, receivedCents: 0, dueCents: 0, activePackageCount: 0, upcomingPackageCount: 1, sessionsRemaining: null, overdue: false, lowSessions: false, unassignedSessions: 0, needsAttention: false },
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
})
