import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CorporateServiceEntry, CorporateServiceRecordPage, CorporateServicesPage } from './ServicesPage'
import { CorporateServiceStatistics } from './ServiceStatistics'
import { addDays, formatLocalDate, formatLocalDateShort, localDate, todayInTimeZone } from '../../shared/local-date'
import { CorporateServiceError, type CorporateService } from '../../data/repositories/corporate-services.repository'

const api = vi.hoisted(() => ({ access: vi.fn(), list: vi.fn(), record: vi.fn(), save: vi.fn(), void: vi.fn(), audit: vi.fn(), statistics: vi.fn() }))
const session = vi.hoisted(() => ({ role: 'trainer' }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { userId: '10000000-0000-4000-8000-000000000001', role: session.role, timezone: 'Europe/Moscow' } }) }))
vi.mock('../../data/repositories/corporate-services.repository', async original => ({ ...await original<typeof import('../../data/repositories/corporate-services.repository')>(), corporateServicesRepository: api }))
const id = '20000000-0000-4000-8000-000000000001', office = { id, city: 'Москва', name: 'Тестовый' }
const row: CorporateService = { id, kind: 'tour', officeId: id, city: office.city, officeName: office.name, occurredAt: '2026-01-01T09:15:36Z', version: 1, voidedAt: null, createdAt: '2026-01-01T09:16:00Z', updatedAt: '2026-01-01T09:16:00Z' }
const page = { records: [] as CorporateService[], offices: [office], timeZone: 'Europe/Moscow', nextCursor: null }
function Location() { return <output data-testid="location">{useLocation().pathname}{useLocation().search}</output> }
function mount(path: string, staleTime = 0) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime }, mutations: { retry: false } } })
  const router = createMemoryRouter([{ element: <><Location /><Outlet /></>, children: [
    { path: '/profile', element: <CorporateServiceEntry /> },
    { path: '/profile/yandex-services', element: <CorporateServicesPage /> },
    { path: '/profile/yandex-services/new', element: <CorporateServiceRecordPage /> },
    { path: '/profile/yandex-services/:id', element: <CorporateServiceRecordPage /> },
    { path: '/statistics', element: <CorporateServiceStatistics /> },
  ] }], { initialEntries: [path] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}
afterEach(() => { vi.useRealTimers() })
beforeEach(() => {
  vi.resetAllMocks()
  session.role = 'trainer'
  api.access.mockResolvedValue(true); api.list.mockResolvedValue(page); api.record.mockResolvedValue(row)
  api.save.mockResolvedValue({ saved: true, id, version: 1 }); api.void.mockResolvedValue({ saved: true, id, version: 2 })
  api.audit.mockResolvedValue({ events: [{ action: 'update', at: row.updatedAt, version: 2, before: row, after: { ...row, kind: 'intro' } }], nextBeforeVersion: null })
  api.statistics.mockResolvedValue({ counts: { tour: 3, consultation: 2, instruction: 1, intro: 0 }, timeZone: 'Europe/Moscow', offices: [{ ...office, archived: true }], trainers: [{ id, name: 'Тестовый тренер', active: false }] })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')) }
})
describe('corporate trainer service screens', () => {
  it('denies an athlete direct route without waiting on a disabled access query', async () => {
    session.role = 'client'; mount('/profile/yandex-services/new?kind=tour')
    expect(await screen.findByRole('heading', { name: 'Нет доступа' })).toBeVisible()
    expect(api.access).not.toHaveBeenCalled(); expect(api.list).not.toHaveBeenCalled(); expect(api.record).not.toHaveBeenCalled()
  })
  it('does not expose data to a denied trainer', async () => {
    api.access.mockResolvedValue(false); mount('/profile/yandex-services/new?kind=tour')
    expect(await screen.findByRole('heading', { name: 'Нет доступа' })).toBeVisible()
    expect(api.list).not.toHaveBeenCalled(); expect(api.record).not.toHaveBeenCalled()
  })
  it('retries access failures and navigates from the single profile entry', async () => {
    const user = userEvent.setup(); mount('/profile')
    await user.click(await screen.findByRole('link', { name: 'Работа в Яндексе' }))
    expect(await screen.findByRole('heading', { name: 'Мои услуги' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'За этот период услуг нет' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Неделя' }))
    await user.click(screen.getByRole('button', { name: 'Сегодня' }))
    await user.click(screen.getByRole('button', { name: 'Месяц' }))
    await user.click(screen.getByRole('button', { name: 'Применить период' }))
    await user.click(screen.getByRole('button', { name: 'Обновить' }))
  })
  it.each([true, false])('offers a generic profile retry without disclosing an unconfirmed feature; allowed=%s', async allowed => {
    api.access.mockRejectedValueOnce(new Error('Временная ошибка')).mockResolvedValueOnce(allowed)
    const user = userEvent.setup(); mount('/profile')
    expect(await screen.findByText('Не удалось обновить доступные разделы.')).toBeVisible()
    expect(screen.queryByText(/Яндекс/)).not.toBeInTheDocument()
    expect(api.list).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Повторить проверку' }))
    await waitFor(() => expect(screen.queryByText('Не удалось обновить доступные разделы.')).not.toBeInTheDocument())
    if (allowed) expect(screen.getByRole('link', { name: 'Работа в Яндексе' })).toBeVisible()
    else expect(screen.queryByRole('link', { name: 'Работа в Яндексе' })).not.toBeInTheDocument()
    expect(api.list).not.toHaveBeenCalled()
  })
  it('shows a failed access read and allows an explicit retry', async () => {
    const user = userEvent.setup(); api.access.mockRejectedValueOnce(new Error('Сеть недоступна')); mount('/profile/yandex-services')
    expect(await screen.findByText('Сеть недоступна')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('heading', { name: 'Мои услуги' })).toBeVisible()
  })
  it('requires an explicit office and keeps one command across a failed save', async () => {
    const user = userEvent.setup(); api.list.mockResolvedValue({ ...page, offices: [office, { ...office, id: '20000000-0000-4000-8000-000000000002', name: 'Второй' }] })
    api.save.mockRejectedValueOnce(new Error('Ответ потерян')); mount('/profile/yandex-services/new?kind=instruction')
    const submit = await screen.findByRole('button', { name: 'Сохранить услугу' })
    await user.click(submit); expect(api.save).not.toHaveBeenCalled()
    await user.selectOptions(screen.getByLabelText('Офис', { exact: true }), id)
    await user.click(submit); expect(await screen.findByText('Ответ потерян')).toBeVisible()
    expect(screen.getByLabelText('Услуга', { exact: true })).toHaveValue('instruction')
    await user.click(submit)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/profile/yandex-services?saved=1'))
    expect(api.save).toHaveBeenCalledTimes(2)
    expect(api.save.mock.calls[0]![0]).toEqual(api.save.mock.calls[1]![0])
    expect(api.save.mock.calls[0]![0]).toMatchObject({ officeId: id, kind: 'instruction', version: 0 })
  })
  it('uses the existing date picker and refuses a future fact without a request', async () => {
    const user = userEvent.setup(); mount('/profile/yandex-services/new?kind=tour')
    await user.click(await screen.findByRole('button', { name: 'Выбрать дату и время' }))
    const calendar = screen.getByRole('dialog')
    await user.click(within(calendar).getByRole('button', { name: formatLocalDate(addDays(todayInTimeZone('Europe/Moscow'), 1)) }))
    await user.click(within(calendar).getByRole('button', { name: 'Применить дату' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить услугу' }))
    expect(await screen.findByText('Нельзя отметить услугу в будущем.')).toBeVisible()
    expect(api.save).not.toHaveBeenCalled()
  })
  it('keeps correction on the same record, and exposes retained audit with confirmation before void', async () => {
    const user = userEvent.setup(); mount(`/profile/yandex-services/${id}`)
    await user.click(await screen.findByRole('button', { name: 'История изменений' }))
    expect(await screen.findByText(/До изменения: Экскурсия/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Отменить услугу' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Отмена' }))
    expect(api.void).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Отменить услугу' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Отменить услугу' }))
    await waitFor(() => expect(api.void).toHaveBeenCalledWith(id, expect.any(String), 1))
  })
  it('saves a corrected kind with the original version and instant', async () => {
    const user = userEvent.setup(); mount(`/profile/yandex-services/${id}`)
    await user.selectOptions(await screen.findByLabelText('Услуга', { exact: true }), 'consultation')
    await user.click(screen.getByRole('button', { name: 'Сохранить исправление' }))
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ id, version: 1, kind: 'consultation', occurredAt: row.occurredAt })))
  })
  it('loads an actual current record after a conflict rather than overwriting the draft silently', async () => {
    const user = userEvent.setup(); api.save.mockRejectedValueOnce(new Error('Конфликт')); mount(`/profile/yandex-services/${id}`)
    await user.selectOptions(await screen.findByLabelText('Услуга', { exact: true }), 'instruction')
    await user.click(screen.getByRole('button', { name: 'Сохранить исправление' }))
    await user.click(await screen.findByRole('button', { name: 'Загрузить сохранённую запись' }))
    api.record.mockResolvedValueOnce({ ...row, kind: 'intro', version: 2 })
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Загрузить запись' }))
    await waitFor(() => expect(screen.getByLabelText('Услуга', { exact: true })).toHaveValue('intro'))
  })
  it('offers explicit recovery after a void conflict and retries the current version', async () => {
    const user = userEvent.setup(); api.void.mockRejectedValueOnce(new Error('Конфликт отмены'))
    mount(`/profile/yandex-services/${id}`)
    await user.click(await screen.findByRole('button', { name: 'Отменить услугу' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Отменить услугу' }))
    expect(await screen.findByText('Конфликт отмены')).toBeVisible()
    api.record.mockResolvedValueOnce({ ...row, version: 2, kind: 'intro' })
    await user.click(screen.getByRole('button', { name: 'Загрузить сохранённую запись' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Загрузить запись' }))
    await waitFor(() => expect(screen.getByLabelText('Услуга', { exact: true })).toHaveValue('intro'))
    await user.click(screen.getByRole('button', { name: 'Отменить услугу' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Отменить услугу' }))
    await waitFor(() => expect(api.void).toHaveBeenLastCalledWith(id, expect.any(String), 2))
  })
  it('explicit recovery replaces unsaved input even when the server version did not change', async () => {
    const user = userEvent.setup(); api.save.mockRejectedValueOnce(new Error('Нет связи'))
    mount(`/profile/yandex-services/${id}`)
    await user.selectOptions(await screen.findByLabelText('Услуга', { exact: true }), 'instruction')
    await user.click(screen.getByRole('button', { name: 'Сохранить исправление' }))
    await user.click(await screen.findByRole('button', { name: 'Загрузить сохранённую запись' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Загрузить запись' }))
    await waitFor(() => expect(screen.getByLabelText('Услуга', { exact: true })).toHaveValue('tour'))
    expect(screen.queryByText('Нет связи')).not.toBeInTheDocument()
  })
  it('closes the form when an explicit recovery reports a revoked permission', async () => {
    const user = userEvent.setup(); api.save.mockRejectedValueOnce(new Error('Нет связи'))
    mount(`/profile/yandex-services/${id}`)
    await user.click(await screen.findByRole('button', { name: 'Сохранить исправление' }))
    await user.click(await screen.findByRole('button', { name: 'Загрузить сохранённую запись' }))
    api.record.mockRejectedValueOnce(new CorporateServiceError(403, 'Нет допуска'))
    api.access.mockResolvedValue(false)
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Загрузить запись' }))
    expect(await screen.findByRole('heading', { name: 'Нет доступа' })).toBeVisible()
    expect(screen.queryByRole('form', { name: 'Данные услуги' })).not.toBeInTheDocument()
    expect(api.save).toHaveBeenCalledTimes(1); expect(api.void).not.toHaveBeenCalled()
  })
  it('keeps a selected historical range on back and displays an old saved fact', async () => {
    const user = userEvent.setup(); mount(`/profile/yandex-services/${id}?from=2026-01-01&until=2026-01-02`)
    await user.click(await screen.findByRole('button', { name: 'Назад' }))
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ from: '2026-01-01', until: '2026-01-02' }, undefined))
  })
  it('returns a direct old record save to its own day instead of an empty current month', async () => {
    const user = userEvent.setup(); mount(`/profile/yandex-services/${id}`)
    await user.click(await screen.findByRole('button', { name: 'Сохранить исправление' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('saved=1&from=2026-01-01&until=2026-01-02'))
    // Updating the cache must not remount the form before its successful navigation.
    expect(api.record).toHaveBeenCalledTimes(1)
  })
  it('confirms pending navigation and never redirects after a confirmed departure', async () => {
    let finish!: (value: { saved: true; id: string; version: number }) => void
    api.save.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const user = userEvent.setup(); mount('/profile/yandex-services/new?kind=tour')
    await user.click(await screen.findByRole('button', { name: 'Сохранить услугу' }))
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Остаться' }))
    expect(screen.getByLabelText('Услуга', { exact: true })).toHaveValue('tour')
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Уйти' }))
    await screen.findByRole('heading', { name: 'Мои услуги' })
    await act(async () => { finish({ saved: true, id, version: 1 }); await new Promise(resolve => setTimeout(resolve, 0)) })
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/profile/yandex-services?from='))
    expect(screen.getByTestId('location').textContent).not.toContain('saved=1')
    expect(api.save).toHaveBeenCalledTimes(1)
  })
  it('keeps totals and their applied range unchanged until the draft period is applied', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T10:00:00Z'))
    api.statistics.mockImplementation((range: { until: string }) => Promise.resolve({ counts: { tour: range.until === '2026-11-03' ? 1 : 3, consultation: 0, instruction: 0, intro: 0 }, timeZone: 'Europe/Moscow', offices: [office], trainers: [] }))
    const user = userEvent.setup(); mount('/statistics')
    await waitFor(() => expect(screen.getAllByRole('definition')[0]).toHaveTextContent('3'))
    expect(screen.getByRole('button', { name: 'Месяц' })).toHaveAttribute('aria-pressed', 'true')
    const period = screen.getByLabelText('Учтённый период')
    expect(period).toHaveTextContent(formatLocalDateShort(localDate('2026-11-04')))
    await user.click(screen.getByText('Период и фильтры', { exact: true }))
    const chooseEnd = async () => {
      await user.click(screen.getByRole('button', { name: 'Конец периода' }))
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: formatLocalDate(localDate('2026-11-02')) }))
      await user.click(screen.getByRole('button', { name: 'Применить дату' }))
    }
    await chooseEnd()
    await user.click(screen.getByRole('button', { name: 'Месяц' }))
    expect(screen.queryByText(/Период изменён/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Конец периода' })).toHaveTextContent('04.11.2026')
    await chooseEnd()
    expect(screen.getByText(/Период изменён/)).toBeVisible()
    expect(period).toHaveTextContent(formatLocalDateShort(localDate('2026-11-04')))
    expect(screen.getAllByRole('definition')[0]).toHaveTextContent('3')
    expect(api.statistics).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Применить период' }))
    await waitFor(() => expect(screen.getAllByRole('definition')[0]).toHaveTextContent('1'))
    expect(period).toHaveTextContent(formatLocalDateShort(localDate('2026-11-02')))
    expect(screen.queryByText(/Период изменён/)).not.toBeInTheDocument()
    expect(api.statistics).toHaveBeenLastCalledWith({ from: '2026-11-01', until: '2026-11-03' }, '', '')
    await user.click(screen.getByRole('button', { name: 'Сегодня' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveAttribute('aria-pressed', 'true'))
  })
  it('keeps another record read alive when a departed save completes', async () => {
    const otherId = '20000000-0000-4000-8000-000000000002'
    let finishSave!: (value: { saved: true; id: string; version: number }) => void
    let finishRead!: (value: CorporateService) => void
    api.save.mockImplementation(() => new Promise(resolve => { finishSave = resolve }))
    api.record.mockImplementation((requested: string) => requested === otherId ? new Promise(resolve => { finishRead = resolve }) : Promise.resolve(row))
    const user = userEvent.setup(); const router = mount(`/profile/yandex-services/${id}`)
    await user.click(await screen.findByRole('button', { name: 'Сохранить исправление' }))
    await act(async () => { await router.navigate(`/profile/yandex-services/${otherId}`) })
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Уйти' }))
    await waitFor(() => expect(api.record).toHaveBeenCalledWith(otherId))
    await act(async () => { finishSave({ saved: true, id, version: 2 }); await new Promise(resolve => setTimeout(resolve, 0)) })
    await act(async () => { finishRead({ ...row, id: otherId, kind: 'intro' }); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(await screen.findByLabelText('Услуга', { exact: true })).toHaveValue('intro')
    expect(screen.getByTestId('location')).toHaveTextContent(otherId)
  })
  it('reads a fresh audit after correction even while the application cache is fresh', async () => {
    let saved = false
    api.save.mockImplementation(() => { saved = true; return Promise.resolve({ saved: true, id, version: 2 }) })
    api.record.mockImplementation(() => Promise.resolve({ ...row, kind: saved ? 'intro' : 'tour', version: saved ? 2 : 1 }))
    api.list.mockImplementation(() => Promise.resolve({ ...page, records: [{ ...row, kind: saved ? 'intro' : 'tour', version: saved ? 2 : 1 }] }))
    api.audit.mockImplementation(() => Promise.resolve({ events: [{ action: 'create', at: row.createdAt, version: 1, before: null, after: row }, ...(saved ? [{ action: 'update', at: row.updatedAt, version: 2, before: row, after: { ...row, kind: 'intro', version: 2 } }] : [])], nextBeforeVersion: null }))
    const user = userEvent.setup(); mount(`/profile/yandex-services/${id}`, 20_000)
    await user.click(await screen.findByRole('button', { name: 'История изменений' }))
    expect(await screen.findByText(/Создана · версия 1/)).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Услуга', { exact: true }), 'intro')
    await user.click(screen.getByRole('button', { name: 'Сохранить исправление' }))
    await user.click(await screen.findByRole('link', { name: 'Исправить' }))
    await waitFor(() => expect(screen.getByLabelText('Услуга', { exact: true })).toHaveValue('intro'))
    await user.click(await screen.findByRole('button', { name: 'История изменений' }))
    expect(await screen.findByText(/Исправлена · версия 2/)).toBeVisible()
    expect(screen.getByText(/Создана · версия 1/)).toBeVisible()
  })
  it('shows four real totals, historical filters and explicit retry', async () => {
    const user = userEvent.setup(); api.statistics.mockRejectedValueOnce(new Error('Нет связи')); mount('/statistics')
    expect(await screen.findByText('Нет связи')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Тестовый тренер (история)')).toBeInTheDocument()
    expect(screen.getByText('Москва · Тестовый (архив)')).toBeInTheDocument()
    await user.click(screen.getByText('Период и фильтры', { exact: true }))
    await user.selectOptions(screen.getByLabelText('Тренер', { exact: true }), id)
    await user.selectOptions(screen.getByLabelText('Офис', { exact: true }), id)
    await waitFor(() => expect(api.statistics).toHaveBeenLastCalledWith(expect.anything(), id, id))
    expect(screen.getByText('Экскурсии')).toBeVisible()
    expect(screen.getAllByRole('definition').map(value => value.textContent)).toEqual(['3', '2', '1', '0'])
    await user.click(screen.getByRole('button', { name: 'Обновить' }))
  })
})
