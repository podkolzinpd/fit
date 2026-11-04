import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TrainerFinanceOverviewPage } from './TrainerFinanceOverviewPage'
import type { TrainerFinancePaymentHistory, TrainerFinanceReceipt } from '../../data/contracts/trainer-finance'

const backend = vi.hoisted(() => ({ listOverview: vi.fn(), listPayments: vi.fn(), updatePayment: vi.fn(), voidPayment: vi.fn() }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { role: 'trainer', userId: 'trainer-1', timezone: 'Europe/Moscow' } }) }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ trainerFinance: backend }) }))
const receipt: TrainerFinanceReceipt = { id: 'receipt', packageId: 'package', clientId: 'client', clientName: 'Дарья Иванова',
  serviceTitle: 'Персональные тренировки', archivedAt: '2026-10-01T10:00:00Z', amountCents: 1000000, receivedOn: '2026-11-03',
  source: 'opening', comment: null, voidedAt: null, voidReason: null, version: 3, createdAt: '2026-11-03T10:00:00Z', updatedAt: '2026-11-03T10:00:00Z' }
const history: TrainerFinancePaymentHistory = { month: '2026-11', clientId: null, offset: 0, limit: 50,
  totalCount: 1, totalCents: 1000000, clients: [{ id: 'client', name: receipt.clientName }], payments: [receipt] }
function setup(path = '/finance?month=2026-11&view=payments') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><Routes>
    <Route path="/finance" element={<TrainerFinanceOverviewPage />} />
  </Routes></QueryClientProvider></MemoryRouter>)
  return userEvent.setup()
}
beforeEach(() => {
  vi.clearAllMocks()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  backend.listPayments.mockResolvedValue(history)
  backend.listOverview.mockResolvedValue({ month: '2026-11', receivedCents: 1000000, dueCents: 0, attentionCount: 0, clients: [] })
  backend.updatePayment.mockResolvedValue({ ...receipt, version: 4 })
  backend.voidPayment.mockResolvedValue(undefined)
})
describe('trainer-wide receipt history', () => {
  it('uses server totals, preserves the client and resets pagination when the month changes', async () => {
    backend.listPayments.mockResolvedValue({ ...history, totalCount: 51, totalCents: 51000000 })
    const user = setup()
    await screen.findByRole('link', { name: 'Дарья Иванова' })
    expect(screen.getByText(/510\s000/)).toBeVisible()
    expect(screen.getByText('В архиве')).toBeVisible()
    expect(backend.listOverview).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Следующие' }))
    expect(backend.listPayments).toHaveBeenLastCalledWith('2026-11', undefined, 50)
    await user.selectOptions(screen.getByLabelText('Клиент оплат'), 'client')
    await screen.findByText('Получено от клиента за месяц')
    expect(backend.listPayments).toHaveBeenLastCalledWith('2026-11', 'client', 0)
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
    await screen.findByText('Октябрь 2026')
    expect(backend.listPayments).toHaveBeenLastCalledWith('2026-10', 'client', 0)
  })
  it('shows the initial paid balance once when its stored comment already contains that label', async () => {
    backend.listPayments.mockResolvedValue({ ...history, payments: [{ ...receipt, comment: 'Начальный оплаченный остаток' }] })
    setup()
    await screen.findByRole('link', { name: 'Дарья Иванова' })
    expect(screen.getAllByText(/Начальный оплаченный остаток/)).toHaveLength(1)
  })

  it('reuses versioned payment correction and refreshes the period after changing the date', async () => {
    const user = setup('/finance?month=2026-11&view=payments&client=client')
    await user.click(await screen.findByRole('button', { name: /Действия с оплатой/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Изменить' }))
    await user.clear(screen.getByLabelText('Сумма, ₽'))
    await user.type(screen.getByLabelText('Сумма, ₽'), '9000')
    await user.clear(screen.getByLabelText('Дата'))
    await user.type(screen.getByLabelText('Дата'), '2026-10-31')
    backend.listPayments.mockResolvedValue({ ...history, totalCents: 0, totalCount: 0, payments: [] })
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await screen.findByText('Оплат за этот месяц нет.')
    expect(backend.updatePayment).toHaveBeenCalledWith('receipt', { amountCents: 900000, receivedOn: '2026-10-31', comment: null, expectedVersion: 3 })
    expect(screen.getByLabelText('Клиент оплат')).toHaveValue('client')
    expect(screen.getByText('Ноябрь 2026')).toBeVisible()
  })
  it('does not restore an old period when a pending correction finishes after navigation', async () => {
    let resolve!: (value: unknown) => void
    backend.updatePayment.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const user = setup()
    await user.click(await screen.findByRole('button', { name: /Действия с оплатой/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Изменить' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
    await screen.findByText('Октябрь 2026')
    await act(async () => { resolve({ ...receipt, version: 4 }); await Promise.resolve() })
    expect(screen.getByText('Октябрь 2026')).toBeVisible()
    expect(backend.listPayments).toHaveBeenLastCalledWith('2026-10', undefined, 0)
  })

  it('confirms deletion, preserves cancel, and reports a failed write without losing history', async () => {
    const user = setup()
    const openDelete = async () => {
      await user.click(await screen.findByRole('button', { name: /Действия с оплатой/ }))
      await user.click(screen.getByRole('menuitem', { name: 'Удалить' }))
    }
    await openDelete()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Отмена' }))
    expect(backend.voidPayment).not.toHaveBeenCalled()
    backend.voidPayment.mockRejectedValueOnce(new Error('Оплата не удалена'))
    await openDelete()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Удалить' }))
    await screen.findByText('Оплата не удалена')
    expect(backend.voidPayment).toHaveBeenCalledWith('receipt', 3, 'Удалено тренером')
    expect(screen.getByRole('link', { name: 'Дарья Иванова' })).toBeVisible()
  })
})
