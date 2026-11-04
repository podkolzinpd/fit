import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client, SessionActor } from '../../shared/domain'
import type { TrainerFinanceClientBundle, TrainerFinanceRepository } from '../../data/contracts/trainer-finance'
import { PackageForm, PaymentForm, TrainerFinancePage } from './TrainerFinancePage'
import { RepositoryError } from '../../data/repositories/error'

const clientId = '1a0c5295-0a0f-4ccb-a39a-e58090967245'
const trainerId = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
const packageId = '34df7b20-a0b5-4627-bd98-d4a174625723'
const paymentId = 'ec3e661a-0ee8-48da-a269-d4f7707427cc'
const sessionId = '8938c8e0-3856-469b-b743-ab5942ce4564'
const workoutId = '77d5776a-337c-466e-a3e6-e098adb03cc7'
const client: Client = { id: clientId, canArchive: true, hasAccount: true, fullName: 'Анна Смирнова', canonicalFullName: 'анна смирнова', gender: null, ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null, currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: 1 }
const bundle: TrainerFinanceClientBundle = {
  clientId, clientName: 'Анна Смирнова',
  packages: [{ id: packageId, clientId, trainerId, kind: 'session_pack', title: 'Персональные тренировки', sessionsTotal: 10, sessionsUsed: 2, sessionsRemaining: 8, priceCents: 2500000, paidCents: 1000000, dueCents: 1500000, startsOn: '2026-09-01', endsOn: null, paymentDueOn: '2026-09-10', comment: null, packageStatus: 'active', paymentStatus: 'overdue', closedAt: null, version: 1, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' }],
  payments: [{ id: paymentId, packageId, amountCents: 1000000, receivedOn: '2026-09-01', source: 'manual', comment: null, voidedAt: null, voidReason: null, version: 1, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' }],
  sessions: [{ id: sessionId, packageId, workoutId, disposition: 'charged', source: 'automatic', comment: null, workoutDate: '2026-09-05', voidedAt: null, voidReason: null, version: 1, createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z' }],
}
const clients = vi.hoisted(() => ({ get: vi.fn() }))
const finance = vi.hoisted(() => ({ listClient: vi.fn(), createPackage: vi.fn<TrainerFinanceRepository['createPackage']>(), updatePackage: vi.fn(), addPayment: vi.fn<TrainerFinanceRepository['addPayment']>(), updatePayment: vi.fn(), voidPayment: vi.fn(), updateSession: vi.fn(), createManualSession: vi.fn<TrainerFinanceRepository['createManualSession']>() }))
const workouts = vi.hoisted(() => ({ saveCompleted: vi.fn() }))

vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { kind: 'trainer', role: 'trainer', userId: trainerId, email: null, firstName: 'Ирина', lastName: null, timezone: 'Europe/Moscow' } as SessionActor }) }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ clients, trainerFinance: finance, workouts }) }))

function renderPage(financeBackTo?: '/finance', queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 20_000 }, mutations: { retry: false } } })) {
  return render(<MemoryRouter initialEntries={[{ pathname: `/clients/${clientId}/finance`, state: financeBackTo ? { financeBackTo } : undefined }]}><QueryClientProvider client={queryClient}><Routes>
    <Route path="/clients/:clientId/finance" element={<TrainerFinancePage />} />
    <Route path="/finance" element={<p>Общий финансовый кабинет</p>} />
    <Route path="/clients/:clientId" element={<p>Профиль спортсмена</p>} />
  </Routes></QueryClientProvider></MemoryRouter>)
}

describe('TrainerFinancePage', () => {
  it('refreshes overview months after payment even while their cached balances are fresh', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 20_000 } } })
    const months = ['2026-08', '2026-09']
    months.forEach(month => queryClient.setQueryData(['trainer-finance-overview', month], { dueCents: 1500000 }))
    finance.listClient.mockResolvedValueOnce(bundle).mockResolvedValue({ ...bundle,
      packages: [{ ...bundle.packages[0]!, dueCents: 1000000, paidCents: 1500000 }] })
    const user = userEvent.setup()
    renderPage(undefined, queryClient)
    await user.click(await screen.findByRole('button', { name: 'Внести оплату' }))
    await user.clear(screen.getByLabelText('Сумма, ₽'))
    await user.type(screen.getByLabelText('Сумма, ₽'), '5000')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await screen.findByRole('button', { name: 'Внести оплату' })
    const read = vi.fn<() => Promise<{ dueCents: number }>>().mockResolvedValue({ dueCents: 1000000 })
    for (const month of months) {
      expect(await queryClient.fetchQuery({ queryKey: ['trainer-finance-overview', month], queryFn: read })).toEqual({ dueCents: 1000000 })
    }
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('opens authorized former-client finance without requesting private client data', async () => {
    clients.get.mockRejectedValue(new RepositoryError('PT404', 'Нет доступа к карточке'))
    finance.listClient.mockResolvedValue({ ...bundle, clientName: 'Бывший клиент', canCreate: false,
      packages: [{ ...bundle.packages[0]!, packageStatus: 'expired' }] })
    const user = userEvent.setup()
    renderPage('/finance')
    expect(await screen.findByText('Бывший клиент')).toBeVisible()
    await user.click(screen.getByText('История', { selector: '.finance-history summary span' }))
    expect(screen.getByRole('heading', { name: 'Персональные тренировки' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Новая' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Продлить' })).not.toBeInTheDocument()
    expect(clients.get).not.toHaveBeenCalled()
    expect(screen.queryByText('Нет доступа к карточке')).not.toBeInTheDocument()
  })
  it.each([true, false])('shows full or partial opening payment with its actual date: Lime=%s', async (lime) => {
    const user = userEvent.setup()
    const submit = vi.fn()
    render(<PackageForm lime={lime} today="2026-10-07" saving={false} error={null} onCancel={vi.fn()} onSubmit={submit} />)
    expect(screen.getByLabelText('Уже оплачено, ₽')).toBeVisible()
    expect(screen.queryByLabelText('Дата получения')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Стоимость, ₽'), '30000')
    await user.click(screen.getByRole('button', { name: 'Вся сумма' }))
    expect(screen.getByLabelText('Уже оплачено, ₽')).toHaveValue(30000)
    await user.clear(screen.getByLabelText('Уже оплачено, ₽'))
    await user.type(screen.getByLabelText('Уже оплачено, ₽'), '10000')
    await user.clear(screen.getByLabelText('Дата получения'))
    await user.type(screen.getByLabelText('Дата получения'), '2026-08-27')
    await user.clear(screen.getByLabelText('Начало'))
    await user.type(screen.getByLabelText('Начало'), '2026-09-01')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 3000000, openingPaidCents: 1000000, openingReceivedOn: '2026-08-27', startsOn: '2026-09-01' }))
  })

  it('prefills each selected service debt and preserves an edited payment amount', async () => {
    const user = userEvent.setup()
    const second = { ...bundle.packages[0]!, id: 'second', title: 'Онлайн', dueCents: 400000 }
    const view = render(<PaymentForm packages={[bundle.packages[0]!, second]} packageId={packageId} today="2026-10-07" saving={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('Сумма, ₽')).toHaveValue(15000)
    await user.selectOptions(screen.getByLabelText('Услуга'), 'second')
    expect(screen.getByLabelText('Сумма, ₽')).toHaveValue(4000)
    view.unmount()
    render(<PaymentForm current={bundle.payments[0]} packages={[bundle.packages[0]!]} packageId={packageId} today="2026-10-07" saving={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('Сумма, ₽')).toHaveValue(10000)
  })

  it('adds a partial payment directly to the selected service', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Внести оплату' }))
    expect(screen.getByLabelText('Сумма, ₽')).toHaveValue(15000)
    expect(screen.queryByLabelText('Услуга')).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Сумма, ₽'))
    await user.type(screen.getByLabelText('Сумма, ₽'), '7500')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(finance.addPayment).toHaveBeenCalledWith(packageId, expect.objectContaining({ amountCents: 750000 })))
    expect(await screen.findByRole('tab', { name: 'Услуги: 1' })).toHaveAttribute('aria-selected', 'true')
  })

  it('waits for the updated balance before allowing the next direct payment', async () => {
    const user = userEvent.setup()
    let finishRefresh!: (value: TrainerFinanceClientBundle) => void
    finance.listClient.mockResolvedValueOnce(bundle).mockImplementationOnce(() => new Promise<TrainerFinanceClientBundle>((resolve) => { finishRefresh = resolve }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Внести оплату' }))
    await user.clear(screen.getByLabelText('Сумма, ₽'))
    await user.type(screen.getByLabelText('Сумма, ₽'), '5000')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(finance.listClient).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Внести оплату' })).not.toBeInTheDocument()
    finishRefresh({ ...bundle, packages: [{ ...bundle.packages[0]!, paidCents: 1500000, dueCents: 1000000 }] })
    await user.click(await screen.findByRole('button', { name: 'Внести оплату' }))
    expect(screen.getByLabelText('Сумма, ₽')).toHaveValue(10000)
    expect(finance.addPayment).toHaveBeenCalledTimes(1)
  })

  it('Lime shows opening payment directly and saves unchanged financial units', async () => {
    const user = userEvent.setup()
    const submit = vi.fn()
    render(<PackageForm lime today="2026-10-04" saving={false} error={null} onCancel={vi.fn()} onSubmit={submit} />)
    expect(screen.getByLabelText('Уже оплачено, ₽')).toBeVisible()
    await user.type(screen.getByLabelText('Стоимость, ₽'), '30000')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ sessionsTotal: 10, priceCents: 3000000, openingUsedSessions: 0, openingPaidCents: 0 }))
  })

  it('Lime opens and focuses invalid balances without clearing other values', async () => {
    const user = userEvent.setup()
    const submit = vi.fn()
    render(<PackageForm lime today="2026-10-04" saving={false} error={null} onCancel={vi.fn()} onSubmit={submit} />)
    await user.type(screen.getByLabelText('Стоимость, ₽'), '30000')
    await user.click(screen.getByText('Уже проведённые занятия'))
    const used = screen.getByLabelText('Уже проведено, занятий')
    await user.clear(used)
    await user.type(used, '30000')
    await user.click(screen.getByText('Уже проведённые занятия'))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(used).toBeVisible()
    expect(used).toHaveFocus()
    expect(used).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Проведённых занятий не может быть больше общего количества')
    expect(screen.getByLabelText('Стоимость, ₽')).toHaveValue(30000)
    expect(submit).not.toHaveBeenCalled()
    await user.clear(used)
    await user.type(used, '2')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ openingUsedSessions: 2, priceCents: 3000000 }))
  })

  it('Lime validates payment and dates inline and keeps a retryable form', async () => {
    const user = userEvent.setup()
    const submit = vi.fn()
    render(<PackageForm lime today="2026-10-04" saving={false} error={null} onCancel={vi.fn()} onSubmit={submit} />)
    await user.type(screen.getByLabelText('Стоимость, ₽'), '100')
    await user.click(screen.getByText('Уже проведённые занятия'))
    const paid = screen.getByLabelText('Уже оплачено, ₽')
    await user.clear(paid)
    await user.type(paid, '101')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(paid).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent('Оплата не может быть больше стоимости')
    await user.clear(paid)
    await user.type(paid, '50')
    await user.type(screen.getByLabelText('Окончание'), '2026-10-03')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByLabelText('Окончание')).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent('не раньше начала')
    expect(submit).not.toHaveBeenCalled()
  })

  beforeEach(() => {
    clients.get.mockReset().mockResolvedValue(client)
    finance.listClient.mockReset().mockResolvedValue(bundle)
    finance.createPackage.mockReset().mockResolvedValue(bundle.packages[0]!)
    finance.updatePackage.mockReset().mockResolvedValue(bundle.packages[0]!)
    finance.addPayment.mockReset().mockResolvedValue(bundle.payments[0]!)
    finance.updatePayment.mockReset().mockResolvedValue(bundle.payments[0]!)
    finance.voidPayment.mockReset().mockResolvedValue(undefined)
    finance.updateSession.mockReset().mockResolvedValue({ ...bundle.sessions[0], disposition: 'free', packageId: null, version: 2 })
    finance.createManualSession.mockReset().mockResolvedValue(bundle.sessions[0]!)
    workouts.saveCompleted.mockReset().mockResolvedValue(workoutId)
  })

  it('shows remaining sessions, payment balance and existing payments', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Персональные тренировки' })).toBeVisible()
    expect(screen.getByText('8 из 10')).toBeVisible()
    expect(screen.getByText('К оплате', { selector: '.finance-service-money span' }).closest('p')).toHaveTextContent(/15\s000/)
    for (const date of screen.getAllByText('1 сентября 2026 г.')) expect(date).not.toBeVisible()
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
    await user.clear(screen.getByLabelText('Сумма, ₽'))
    await user.type(screen.getByLabelText('Сумма, ₽'), '7500')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(finance.addPayment).toHaveBeenCalledWith(packageId, expect.objectContaining({
      amountCents: 750000, comment: null,
    })))
  })

  it('reuses the payment request after an uncertain response and allows a separate next payment', async () => {
    const user = userEvent.setup()
    finance.addPayment.mockRejectedValueOnce(new Error('Нет связи')).mockResolvedValue(bundle.payments[0]!)
    renderPage()
    await user.click(await screen.findByRole('tab', { name: 'Оплаты: 1' }))
    await user.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Добавить' }))
    await user.clear(screen.getByLabelText('Сумма, ₽'))
    await user.type(screen.getByLabelText('Сумма, ₽'), '7500')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(finance.addPayment).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Повторить сохранение' }))
    await waitFor(() => expect(finance.addPayment).toHaveBeenCalledTimes(2))
    const firstRequest = finance.addPayment.mock.calls[0]![1].requestId
    expect(firstRequest).toEqual(expect.any(String))
    expect(finance.addPayment.mock.calls[1]![1].requestId).toBe(firstRequest)
    await user.click(within(await screen.findByRole('tabpanel')).getByRole('button', { name: 'Добавить' }))
    await user.clear(screen.getByLabelText('Сумма, ₽'))
    await user.type(screen.getByLabelText('Сумма, ₽'), '1000')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(finance.addPayment).toHaveBeenCalledTimes(3))
    expect(finance.addPayment.mock.calls[2]![1].requestId).not.toBe(firstRequest)
  })

  it('reuses the service request after an uncertain response', async () => {
    const user = userEvent.setup()
    finance.createPackage.mockRejectedValueOnce(new Error('Нет связи')).mockResolvedValue(bundle.packages[0]!)
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Новая' }))
    await user.type(screen.getByLabelText('Стоимость, ₽'), '25000')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(finance.createPackage).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Повторить сохранение' }))
    await waitFor(() => expect(finance.createPackage).toHaveBeenCalledTimes(2))
    expect(finance.createPackage.mock.calls[0]![1].requestId).toEqual(expect.any(String))
    expect(finance.createPackage.mock.calls[1]![1].requestId).toBe(finance.createPackage.mock.calls[0]![1].requestId)
  })

  it('confirms deletion and refreshes the paid amount and debt without changing sessions', async () => {
    const user = userEvent.setup()
    finance.voidPayment.mockImplementation(() => {
      finance.listClient.mockResolvedValue({ ...bundle, packages: [{ ...bundle.packages[0], paidCents: 0, dueCents: 2500000 }], payments: [{ ...bundle.payments[0], voidedAt: '2026-10-06T12:00:00Z' }] })
      return Promise.resolve()
    })
    renderPage()
    await user.click(await screen.findByRole('tab', { name: 'Оплаты: 1' }))
    await user.click(screen.getByRole('button', { name: /Действия с оплатой/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Удалить' }))
    expect(finance.voidPayment).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(finance.voidPayment).toHaveBeenCalledWith(paymentId, 1, 'Удалено тренером'))
    expect(await screen.findByRole('tab', { name: 'Оплаты: 0' })).toBeVisible()
    const total = within(screen.getByRole('tabpanel')).getByText('К оплате').closest('p')!
    expect(total).toHaveTextContent(/25\s000/)
    await user.click(screen.getByRole('tab', { name: 'Услуги: 1' }))
    expect(screen.getByText('8 из 10')).toBeVisible()
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

  it('resolves a lost manual response after cancel before accepting a new operation', async () => {
    const user = userEvent.setup()
    finance.createManualSession.mockRejectedValueOnce(new Error('Нет сети'))
      .mockRejectedValueOnce(new RepositoryError('PT404', 'Связь временно недоступна'))
      .mockResolvedValue(bundle.sessions[0]!)
    renderPage()
    await screen.findByRole('heading', { name: 'Персональные тренировки' })
    await user.click(screen.getByRole('tab', { name: 'Занятия: 1' }))
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await user.type(screen.getByLabelText('Комментарий'), 'Занятие вне Fit')
    await user.selectOptions(screen.getByLabelText('Учёт'), 'trial')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await screen.findByText('Сохранение не подтверждено')
    expect(screen.getByLabelText('Комментарий')).toHaveValue('Занятие вне Fit')
    expect(screen.getByLabelText('Комментарий')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(finance.createManualSession).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Проверить сохранение' }))
    expect(screen.getByLabelText('Комментарий')).toHaveValue('Занятие вне Fit')
    expect(screen.getByLabelText('Учёт')).toHaveValue('trial')
    await user.click(screen.getByRole('button', { name: 'Повторить сохранение' }))
    await waitFor(() => expect(finance.createManualSession).toHaveBeenCalledTimes(2))
    expect(finance.createManualSession.mock.calls[1]).toEqual(finance.createManualSession.mock.calls[0])
    // A later access rejection does not prove that the first lost response
    // represented a rollback. Keep that operation until a successful replay.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Повторить сохранение' })).toBeEnabled())
    expect(screen.getByLabelText('Комментарий')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Повторить сохранение' }))
    await waitFor(() => expect(finance.createManualSession).toHaveBeenCalledTimes(3))
    expect(finance.createManualSession.mock.calls[2]).toEqual(finance.createManualSession.mock.calls[0])
    await waitFor(() => expect(screen.queryByLabelText('Дата занятия')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await user.type(screen.getByLabelText('Комментарий'), 'Другое занятие')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(finance.createManualSession).toHaveBeenCalledTimes(4))
    expect(finance.createManualSession.mock.calls[3]![1].requestId).not.toBe(finance.createManualSession.mock.calls[0]![1].requestId)
    expect(workouts.saveCompleted).not.toHaveBeenCalled()
  })

  it.each(['payment', 'package'] as const)('allows correcting a rejected %s creation with a new operation', async (kind) => {
    const user = userEvent.setup()
    const create = kind === 'payment' ? finance.addPayment : finance.createPackage
    create.mockRejectedValueOnce(new RepositoryError('PT422', 'Проверьте данные'))
    renderPage()
    await user.click(await screen.findByRole('button', { name: kind === 'payment' ? 'Внести оплату' : 'Новая' }))
    if (kind === 'package') await user.type(screen.getByLabelText('Стоимость, ₽'), '5000')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await screen.findByText('Проверьте данные')
    expect(screen.getByLabelText('Комментарий')).toBeEnabled()
    await user.type(screen.getByLabelText('Комментарий'), 'Исправленная запись')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create.mock.calls[1]![1].requestId).not.toBe(create.mock.calls[0]![1].requestId)
    expect(create.mock.calls[1]![1].comment).toBe('Исправленная запись')
  })

  it.each(['payment', 'package'] as const)('replays an uncertain %s creation after cancel without creating a second operation', async (kind) => {
    const user = userEvent.setup()
    const create = kind === 'payment' ? finance.addPayment : finance.createPackage
    create.mockRejectedValueOnce(new Error('Нет сети'))
      .mockRejectedValueOnce(new RepositoryError('PT404', 'Связь временно недоступна'))
    renderPage()
    await screen.findByRole('heading', { name: 'Персональные тренировки' })
    const open = async () => user.click(screen.getByRole('button', { name: kind === 'payment' ? 'Внести оплату' : 'Новая' }))
    await open()
    if (kind === 'package') {
      await user.type(screen.getByLabelText('Стоимость, ₽'), '5000')
      await user.clear(screen.getByLabelText('Уже оплачено, ₽'))
      await user.type(screen.getByLabelText('Уже оплачено, ₽'), '2500')
      fireEvent.change(screen.getByLabelText('Дата получения'), { target: { value: '2026-09-09' } })
    } else {
      await user.clear(screen.getByLabelText('Сумма, ₽'))
      await user.type(screen.getByLabelText('Сумма, ₽'), '2500')
      fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-09-09' } })
    }
    await user.type(screen.getByLabelText('Комментарий'), 'Получено переводом')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await screen.findByText('Сохранение не подтверждено')
    expect(screen.getByLabelText('Комментарий')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    await open()
    expect(screen.getByLabelText('Комментарий')).toHaveValue('Получено переводом')
    expect(screen.getByLabelText(kind === 'payment' ? 'Дата' : 'Дата получения')).toHaveValue('2026-09-09')
    expect(screen.getByLabelText(kind === 'payment' ? 'Сумма, ₽' : 'Уже оплачено, ₽')).toHaveValue(2500)
    await user.click(screen.getByRole('button', { name: 'Повторить сохранение' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Повторить сохранение' })).toBeEnabled())
    expect(screen.getByLabelText('Комментарий')).toBeDisabled()
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0])
    await user.click(screen.getByRole('button', { name: 'Повторить сохранение' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3))
    expect(create.mock.calls[2]).toEqual(create.mock.calls[0])
    await waitFor(() => expect(screen.queryByLabelText('Комментарий')).not.toBeInTheDocument())
    await open()
    expect(screen.getByLabelText('Комментарий')).toBeEnabled()
    if (kind === 'package') await user.type(screen.getByLabelText('Стоимость, ₽'), '5000')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(4))
    expect(create.mock.calls[3]![1].requestId).not.toBe(create.mock.calls[0]![1].requestId)
  })

  it('offers manual packages by entered date including a package expired today', async () => {
    finance.listClient.mockResolvedValue({ ...bundle, packages: [
      { ...bundle.packages[0]!, title: 'Сентябрь', endsOn: '2026-09-30', packageStatus: 'expired' },
      { ...bundle.packages[0]!, id: 'november', title: 'Ноябрь', startsOn: '2026-11-01', endsOn: '2026-11-30' },
    ] })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('tab', { name: 'Занятия: 1' }))
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    fireEvent.change(screen.getByLabelText('Дата занятия'), { target: { value: '2026-09-20' } })
    expect(screen.getByRole('option', { name: 'Списать: Сентябрь' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Списать: Ноябрь' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Учёт'), `charged:${packageId}`)
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(finance.createManualSession).toHaveBeenCalledWith(clientId, expect.objectContaining({
      workoutDate: '2026-09-20', disposition: 'charged', packageId,
    })))
  })

  it('allows correction after an explicit transaction rejection without replaying the rejected draft', async () => {
    finance.createManualSession.mockRejectedValueOnce(new RepositoryError('PT422', 'Проверьте дату'))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('tab', { name: 'Занятия: 1' }))
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    fireEvent.change(screen.getByLabelText('Дата занятия'), { target: { value: '2026-10-20' } })
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await screen.findByText('Проверьте дату')
    expect(screen.getByLabelText('Дата занятия')).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Дата занятия'), { target: { value: '2026-10-21' } })
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(finance.createManualSession).toHaveBeenCalledTimes(2))
    expect(finance.createManualSession.mock.calls[1]![1].requestId).not.toBe(finance.createManualSession.mock.calls[0]![1].requestId)
  })

  it('recomputes eligible packages after editing a date and credits the existing charge', async () => {
    finance.listClient.mockResolvedValue({ ...bundle, packages: [
      { ...bundle.packages[0]!, title: 'Сентябрь', sessionsTotal: 2, sessionsUsed: 2, sessionsRemaining: 0, endsOn: '2026-09-30', packageStatus: 'completed' },
      { ...bundle.packages[0]!, id: 'november', title: 'Ноябрь', startsOn: '2026-11-01', endsOn: '2026-11-30' },
    ] })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('tab', { name: 'Занятия: 1' }))
    await user.click(screen.getByRole('button', { name: 'Действия с занятием 5 сентября 2026 г.' }))
    await user.click(screen.getByRole('menuitem', { name: 'Изменить учёт' }))
    expect(screen.getByRole('option', { name: 'Списать: Сентябрь' })).toBeInTheDocument()
    expect(screen.getByLabelText('Учёт')).toHaveValue(`charged:${packageId}`)
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-11-10' } })
    expect(screen.queryByRole('option', { name: 'Списать: Сентябрь' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Учёт')).toHaveValue('unassigned')
    await user.selectOptions(screen.getByLabelText('Учёт'), 'charged:november')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(finance.updateSession).toHaveBeenCalledWith(sessionId, {
      expectedVersion: 1, disposition: 'charged', packageId: 'november', workoutDate: '2026-11-10', comment: null,
    }))
    expect(finance.createManualSession).not.toHaveBeenCalled()
  })

  it('shows free, trial and unassigned sessions in the non-charged filter', async () => {
    finance.listClient.mockResolvedValue({ ...bundle, sessions: [bundle.sessions[0], ...(['free','trial','unassigned'] as const).map((disposition) => ({ ...bundle.sessions[0], id: disposition, disposition, packageId: null, comment: `Запись ${disposition}` }))] })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('tab', { name: 'Занятия: 4' }))
    await user.click(screen.getByRole('button', { name: 'Без списания' }))
    const list = document.querySelector('.finance-session-list')!
    expect(list.children).toHaveLength(3)
    expect(list).toHaveTextContent('Без списания')
    expect(list).toHaveTextContent('Пробное')
    expect(list).toHaveTextContent('Нужно выбрать абонемент')
    expect(list).not.toHaveTextContent('Списано')
  })

  it('renews the period from today or the day after the current end', () => {
    const item = { ...bundle.packages[0]!, startsOn: '2026-09-01', endsOn: '2026-09-30' }
    const view = render(<PackageForm template={item} today="2026-10-02" saving={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('Начало')).toHaveValue('2026-10-02')
    expect(screen.getByLabelText('Окончание')).toHaveValue('2026-10-31')
    expect(screen.getByLabelText('Окончание')).toHaveAttribute('min','2026-10-02')
    view.unmount()
    render(<PackageForm template={item} today="2026-09-15" saving={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('Начало')).toHaveValue('2026-10-01')
    expect(screen.getByLabelText('Окончание')).toHaveValue('2026-10-30')
  })

  it('keeps expired and exhausted debt in the payments total', async () => {
    finance.listClient.mockResolvedValue({ ...bundle, packages: [
      { ...bundle.packages[0], packageStatus: 'expired', dueCents: 100000 },
      { ...bundle.packages[0], id: 'second', packageStatus: 'completed', dueCents: 200000 },
      { ...bundle.packages[0], id: 'closed', packageStatus: 'closed', closedAt: '2026-09-20T00:00:00Z', dueCents: 500000 },
    ] })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('tab', { name: 'Оплаты: 1' }))
    const total = within(screen.getByRole('tabpanel')).getByText('К оплате').closest('p')!
    expect(total).toHaveTextContent(/3\s000/)
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
    await user.clear(screen.getByLabelText('Начало'))
    await user.type(screen.getByLabelText('Начало'), '2026-10-01')
    await user.type(screen.getByLabelText('Окончание'), '2026-10-31')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(finance.createPackage).toHaveBeenCalledWith(clientId, expect.objectContaining({
      kind: 'online_coaching', sessionsTotal: 0, openingUsedSessions: 0,
      priceCents: 1200000, startsOn: '2026-10-01', endsOn: '2026-10-31',
    })))
  })
})
