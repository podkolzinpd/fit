import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientFinanceSummary } from '../../data/repositories/client-finance.repository'
import { ClientFinanceHomeCard, ClientFinancePage } from './ClientFinancePage'

const trainerId = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
const clientUserId = '974f21af-f304-421f-81bd-050dbfabdd46'
const packageId = '34df7b20-a0b5-4627-bd98-d4a174625723'
const paymentId = 'ec3e661a-0ee8-48da-a269-d4f7707427cc'
const getMine = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => ({ userId: '974f21af-f304-421f-81bd-050dbfabdd46' }))

const summary: ClientFinanceSummary = { trainers: [{
  trainerId,
  trainerName: 'Анастасия Константинопольская',
  packages: [{
    id: packageId, title: 'Персональные тренировки', sessionsTotal: 10,
    sessionsUsed: 2, sessionsRemaining: 8, priceCents: 2500000,
    paidCents: 1000000, dueCents: 1500000, startsOn: '2026-09-01',
    endsOn: '2026-11-30', paymentDueOn: '2026-10-10', packageStatus: 'active',
    paymentStatus: 'partial',
  }],
  payments: [{ id: paymentId, packageId, amountCents: 1000000, receivedOn: '2026-09-01' }],
}] }

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor: { kind: 'client', role: 'client', userId: authState.userId } }),
}))
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ clientFinance: { getMine } }),
}))

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderHome(client = queryClient()) {
  return render(<MemoryRouter><QueryClientProvider client={client}><ClientFinanceHomeCard /></QueryClientProvider></MemoryRouter>)
}

function renderPage() {
  return render(<MemoryRouter initialEntries={['/me/finance']}><QueryClientProvider client={queryClient()}><Routes>
    <Route path="/me/finance" element={<ClientFinancePage />} />
    <Route path="/me/profile" element={<p>Профиль клиента</p>} />
  </Routes></QueryClientProvider></MemoryRouter>)
}

describe('Client finance', () => {
  beforeEach(() => {
    authState.userId = clientUserId
    getMine.mockReset().mockResolvedValue(summary)
  })

  it('shows one compact home entry without edit actions', async () => {
    renderHome()
    expect(await screen.findByRole('heading', { name: 'Абонементы' })).toBeVisible()
    expect(screen.getByText('Анастасия Константинопольская')).toBeVisible()
    expect(screen.getByText('8 из 10')).toBeVisible()
    expect(screen.getByText(/К оплате 15.*000/)).toBeVisible()
    expect(screen.getByRole('link', { name: /Подробнее/ })).toHaveAttribute('href', '/me/finance')
    expect(screen.queryByRole('button', { name: /изменить|удалить|оплатить/i })).not.toBeInTheDocument()
  })

  it('shows read-only package and payment information', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Анастасия Константинопольская' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Персональные тренировки' })).toBeVisible()
    expect(screen.getByText('25 000 ₽')).toBeVisible()
    expect(screen.getAllByText(/15.*000 ₽/)).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Оплаты' })).toBeVisible()
    expect(screen.getByText('1 сентября 2026 г.')).toBeVisible()
    expect(screen.queryByRole('button', { name: /добавить|изменить|удалить|сохранить/i })).not.toBeInTheDocument()
  })

  it('keeps the home entry visible and shows a simple empty state without finance records', async () => {
    getMine.mockResolvedValue({ trainers: [] })
    const home = renderHome()
    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('heading', { name: 'Абонементы' })).toBeVisible()
    expect(screen.getByText('Абонементов пока нет')).toBeVisible()
    expect(screen.getByRole('link', { name: /Подробнее/ })).toHaveAttribute('href', '/me/finance')
    home.unmount()
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Оплат пока нет' })).toBeVisible()
  })

  it('keeps the finance entry available when the compact read fails', async () => {
    getMine.mockRejectedValue(new Error('offline'))
    renderHome()
    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('heading', { name: 'Абонементы' })).toBeVisible()
    expect(screen.getByText('Не удалось загрузить данные')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('scopes the query cache by authenticated user', async () => {
    const client = queryClient()
    const first = renderHome(client)
    await screen.findByRole('heading', { name: 'Абонементы' })
    first.unmount()

    authState.userId = '71ace3ce-ac6d-4a32-b2fd-faa6370f32ea'
    getMine.mockResolvedValue({ trainers: [] })
    renderHome(client)
    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('heading', { name: 'Абонементы' })).toBeVisible()
    expect(screen.getByText('Абонементов пока нет')).toBeVisible()
  })
})
