import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
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
const sessionId = '8938c8e0-3856-469b-b743-ab5942ce4564'
const workoutId = '77d5776a-337c-466e-a3e6-e098adb03cc7'
const client: Client = { id: clientId, canArchive: true, hasAccount: true, fullName: 'Анна Смирнова', canonicalFullName: 'анна смирнова', gender: null, ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null, currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: 1 }
const bundle: TrainerFinanceClientBundle = {
  clientId,
  packages: [{ id: packageId, clientId, trainerId, kind: 'session_pack', title: 'Персональные тренировки', sessionsTotal: 10, sessionsUsed: 2, sessionsRemaining: 8, priceCents: 2500000, paidCents: 1000000, dueCents: 1500000, startsOn: '2026-09-01', endsOn: null, paymentDueOn: '2026-09-10', comment: null, packageStatus: 'active', paymentStatus: 'overdue', closedAt: null, version: 1, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' }],
  payments: [{ id: paymentId, packageId, amountCents: 1000000, receivedOn: '2026-09-01', source: 'manual', comment: null, voidedAt: null, voidReason: null, version: 1, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' }],
  sessions: [{ id: sessionId, packageId, workoutId, disposition: 'charged', source: 'automatic', comment: null, workoutDate: '2026-09-05', voidedAt: null, voidReason: null, version: 1, createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z' }],
}
const clients = vi.hoisted(() => ({ get: vi.fn() }))
const finance = vi.hoisted(() => ({ listClient: vi.fn(), createPackage: vi.fn(), updatePackage: vi.fn(), addPayment: vi.fn(), updatePayment: vi.fn(), voidPayment: vi.fn(), updateSession: vi.fn(), createManualSession: vi.fn() }))
const workouts = vi.hoisted(() => ({ saveCompleted: vi.fn() }))

vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { kind: 'trainer', role: 'trainer', userId: trainerId, email: null, firstName: 'Ирина', lastName: null, timezone: 'Europe/Moscow' } as SessionActor }) }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ clients, trainerFinance: finance, workouts }) }))

function renderPage(financeBackTo?: '/finance') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<MemoryRouter initialEntries={[{ pathname: `/clients/${clientId}/finance`, state: financeBackTo ? { financeBackTo } : undefined }]}><QueryClientProvider client={queryClient}><Routes>
    <Route path="/clients/:clientId/finance" element={<TrainerFinancePage />} />
    <Route path="/finance" element={<p>Общий финансовый кабинет</p>} />
    <Route path="/clients/:clientId" element={<p>Профиль спортсмена</p>} />
  </Routes></QueryClientProvider></MemoryRouter>)
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
    finance.updateSession.mockReset().mockResolvedValue({ ...bundle.sessions[0], disposition: 'free', packageId: null, version: 2 })
    finance.createManualSession.mockReset().mockResolvedValue(bundle.sessions[0])
    workouts.saveCompleted.mockReset().mockResolvedValue(workoutId)
  })

  it('shows remaining sessions, payment balance and existing payments', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Персональные тренировки' })).toBeVisible()
    expect(screen.getByText('8 из 10')).toBeVisible()
    expect(screen.getByText(/К оплате 15.*000/)).toBeVisible()
    expect(screen.getByText('1 сентября 2026 г.')).not.toBeVisible()
    expect(screen.getByRole('tab', { name: 'Услуги: 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Занятия: 1' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Оплаты: 1' })).toHaveAttribute('aria-selected', 'false')
  })

  it('returns to the finance overview when opened from the finance cabinet', async () => {
    const user = userEvent.setup()
    renderPage('/finance')
    await screen.findByRole('heading', { name: 'Персональные тренировки' })
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    expect(screen.getByText('Общий финансовый кабинет')).toBeVisible()
  })

  it('returns to the athlete profile when opened directly from the profile', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Персональные тренировки' })
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    expect(screen.getByText('Профиль спортсмена')).toBeVisible()
  })

  it('creates a package with opening sessions and payment in kopecks', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Персональные тренировки' })
    await user.click(screen.getByRole('button', { name: 'Новая' }))
    await user.clear(screen.getByLabelText('Стоимость, ₽'))
    await user.type(screen.getByLabelText('Стоимость, ₽'), '25000')
    await user.clear(screen.getByLabelText('Уже оплачено, ₽'))
    await user.type(screen.getByLabelText('Уже оплачено, ₽'), '10000')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(finance.createPackage).toHaveBeenCalledWith(clientId, expect.objectContaining({ priceCents: 2500000, openingPaidCents: 1000000, sessionsTotal: 10 })))
  })

  it('adds a payment and keeps its amount in kopecks', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Персональные тренировки' })
    await user.click(screen.getByRole('tab', { name: 'Оплаты: 1' }))
    await user.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Добавить' }))
    await user.type(screen.getByLabelText('Сумма, ₽'), '7500')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(finance.addPayment).toHaveBeenCalledWith(packageId, expect.objectContaining({
      amountCents: 750000, comment: null,
    })))
  })

  it('adds a completed session and lets the trainer correct its accounting', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Персональные тренировки' })
    await user.click(screen.getByRole('tab', { name: 'Занятия: 1' }))
    await user.click(screen.getByRole('button', { name: 'Действия с занятием 5 сентября 2026 г.' }))
    await user.click(screen.getByRole('menuitem', { name: 'Изменить учёт' }))
    await user.selectOptions(screen.getByLabelText('Учёт'), 'free')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(finance.updateSession).toHaveBeenCalledWith(sessionId, {
      expectedVersion: 1, disposition: 'free', packageId: null, comment: null, workoutDate: '2026-09-05',
    }))

    await user.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Добавить' }))
    const date = screen.getByLabelText('Дата занятия')
    await user.clear(date)
    await user.type(date, '2026-09-20')
    await user.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(finance.createManualSession).toHaveBeenCalledWith(clientId, expect.objectContaining({
      workoutDate: '2026-09-20', disposition: 'unassigned', comment: null, packageId: null,
    })))
  })

  it('keeps the manual operation identity and input after a lost response', async () => {
    const user = userEvent.setup()
    finance.createManualSession.mockRejectedValueOnce(new Error('Нет сети')).mockResolvedValue(bundle.sessions[0])
    renderPage()
    await screen.findByRole('heading', { name: 'Персональные тренировки' })
    await user.click(screen.getByRole('tab', { name: 'Занятия: 1' }))
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await user.type(screen.getByLabelText('Комментарий'), 'Занятие вне Fit')
    await user.selectOptions(screen.getByLabelText('Учёт'), 'trial')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await screen.findByText('Нет сети')
    expect(screen.getByLabelText('Комментарий')).toHaveValue('Занятие вне Fit')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(finance.createManualSession).toHaveBeenCalledTimes(2))
    expect(finance.createManualSession.mock.calls[1]).toEqual(finance.createManualSession.mock.calls[0])
    expect(workouts.saveCompleted).not.toHaveBeenCalled()
  })

  it('renews an existing package without changing the original record', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Персональные тренировки' })
    await user.click(screen.getByRole('button', { name: 'Действия с услугой Персональные тренировки' }))
    await user.click(screen.getByRole('menuitem', { name: 'Продлить' }))
    expect(screen.getByRole('heading', { name: 'Продление' })).toBeVisible()
    expect(screen.getByLabelText('Название')).toHaveValue('Персональные тренировки')
    expect(screen.getByLabelText('Всего занятий')).toHaveValue(10)
    expect(screen.getByLabelText('Стоимость, ₽')).toHaveValue(25000)
    expect(screen.getByLabelText('Уже проведено')).toHaveValue(0)
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(finance.createPackage).toHaveBeenCalledWith(clientId, expect.objectContaining({
      title: 'Персональные тренировки', sessionsTotal: 10, openingUsedSessions: 0, priceCents: 2500000,
    })))
    expect(finance.updatePackage).not.toHaveBeenCalled()
  })

  it('creates online coaching for a period without session fields', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Персональные тренировки' })
    await user.click(screen.getByRole('button', { name: 'Новая' }))
    await user.selectOptions(screen.getByLabelText('Тип'), 'online_coaching')
    expect(screen.queryByLabelText('Всего занятий')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Уже проведено')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toHaveValue('Онлайн-сопровождение')
    await user.clear(screen.getByLabelText('Стоимость, ₽'))
    await user.type(screen.getByLabelText('Стоимость, ₽'), '12000')
    await user.type(screen.getByLabelText('Окончание'), '2026-10-31')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(finance.createPackage).toHaveBeenCalledWith(clientId, expect.objectContaining({
      kind: 'online_coaching', sessionsTotal: 0, openingUsedSessions: 0,
      priceCents: 1200000, endsOn: '2026-10-31',
    })))
  })
})
