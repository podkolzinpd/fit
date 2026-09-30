import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client, SessionActor } from '../../shared/domain'
import type { TrainerFinanceClientBundle } from '../../data/repositories/trainer-finance.repository'
import { TrainerFinancePage } from './TrainerFinancePage'

const clientId = '1a0c5295-0a0f-4ccb-a39a-e58090967245'
const trainerId = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
const packageId = '34df7b20-a0b5-4627-bd98-d4a174625723'
const paymentId = 'ec3e661a-0ee8-48da-a269-d4f7707427cc'
const client: Client = { id: clientId, canArchive: true, hasAccount: true, fullName: 'Анна Смирнова', canonicalFullName: 'анна смирнова', gender: null, ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null, currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: 1 }
const bundle: TrainerFinanceClientBundle = {
  clientId,
  packages: [{ id: packageId, clientId, trainerId, title: 'Персональные тренировки', sessionsTotal: 10, sessionsUsed: 2, sessionsRemaining: 8, priceCents: 2500000, paidCents: 1000000, dueCents: 1500000, startsOn: '2026-09-01', endsOn: null, paymentDueOn: '2026-09-10', comment: null, packageStatus: 'active', paymentStatus: 'overdue', closedAt: null, version: 1, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' }],
  payments: [{ id: paymentId, packageId, amountCents: 1000000, receivedOn: '2026-09-01', source: 'manual', comment: null, voidedAt: null, voidReason: null, version: 1, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' }],
}
const clients = vi.hoisted(() => ({ get: vi.fn() }))
const finance = vi.hoisted(() => ({ listClient: vi.fn(), createPackage: vi.fn(), updatePackage: vi.fn(), addPayment: vi.fn(), updatePayment: vi.fn(), voidPayment: vi.fn() }))

vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { kind: 'trainer', role: 'trainer', userId: trainerId, email: null, firstName: 'Ирина', lastName: null, timezone: 'Europe/Moscow' } as SessionActor }) }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ clients, trainerFinance: finance }) }))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<MemoryRouter initialEntries={[`/clients/${clientId}/finance`]}><QueryClientProvider client={queryClient}><Routes><Route path="/clients/:clientId/finance" element={<TrainerFinancePage />} /></Routes></QueryClientProvider></MemoryRouter>)
}

describe('TrainerFinancePage', () => {
  beforeEach(() => {
    clients.get.mockReset().mockResolvedValue(client)
    finance.listClient.mockReset().mockResolvedValue(bundle)
    finance.createPackage.mockReset().mockResolvedValue(bundle.packages[0])
    finance.updatePackage.mockReset().mockResolvedValue(bundle.packages[0])
    finance.addPayment.mockReset().mockResolvedValue(bundle.payments[0])
    finance.updatePayment.mockReset().mockResolvedValue(bundle.payments[0])
    finance.voidPayment.mockReset().mockResolvedValue(undefined)
  })

  it('shows remaining sessions, payment balance and existing payments', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Персональные тренировки' })).toBeVisible()
    expect(screen.getByText('8')).toBeVisible()
    expect(screen.getByText(/Осталось оплатить 15.*000/)).toBeVisible()
    expect(screen.getAllByText(/10.*000/).length).toBeGreaterThan(0)
  })

  it('creates a package with opening sessions and payment in kopecks', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Персональные тренировки' })
    await user.click(screen.getByRole('button', { name: 'Новый абонемент' }))
    await user.clear(screen.getByLabelText('Стоимость, ₽'))
    await user.type(screen.getByLabelText('Стоимость, ₽'), '25000')
    await user.clear(screen.getByLabelText('Уже оплачено, ₽'))
    await user.type(screen.getByLabelText('Уже оплачено, ₽'), '10000')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(finance.createPackage).toHaveBeenCalledWith(clientId, expect.objectContaining({ priceCents: 2500000, openingPaidCents: 1000000, sessionsTotal: 10 })))
  })
})
