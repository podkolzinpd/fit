import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CorporateAdminPage } from './AdminPage'

const api = vi.hoisted(() => ({ access: vi.fn(), bundle: vi.fn(), saveOffice: vi.fn(), saveTrainer: vi.fn() }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { userId: '10000000-0000-4000-8000-000000000001', role: 'client', timezone: 'Europe/Moscow' } }) }))
vi.mock('../../app/theme', async original => ({ ...await original<typeof import('../../app/theme')>(), useAppTheme: () => 'light' }))
vi.mock('../../data/repositories/corporate-admin.repository', () => ({ corporateAdminRepository: api }))
const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeEach(() => { vi.resetAllMocks(); Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() }) })
afterEach(() => { if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scroll); else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView') })

it('does not close a different office editor when an earlier save finishes', async () => {
  const first = { id: '20000000-0000-4000-8000-000000000001', city: 'Москва', name: 'Первый', address: 'Тестовый адрес', archived: false, version: 1 }
  const second = { ...first, id: '20000000-0000-4000-8000-000000000002', name: 'Второй' }
  api.access.mockResolvedValue(true); api.bundle.mockResolvedValue({ offices: [first, second], trainers: [] })
  let finish!: () => void
  api.saveOffice.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/admin?tab=offices']}><CorporateAdminPage /></MemoryRouter></QueryClientProvider>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Изменить офис Первый' }))
  await user.clear(screen.getByLabelText('Город')); await user.type(screen.getByLabelText('Город'), 'Сохранённый город')
  await user.click(screen.getByRole('button', { name: 'Сохранить офис' }))
  expect(api.saveOffice).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Изменить офис Второй' }))
  await user.clear(screen.getByLabelText('Город')); await user.type(screen.getByLabelText('Город'), 'Новый черновик')
  await act(async () => { finish(); await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(screen.getByLabelText('Город')).toHaveValue('Новый черновик')
  expect(screen.getByLabelText('Название офиса')).toHaveValue('Второй')
  expect(api.saveOffice).toHaveBeenCalledWith(expect.objectContaining({ id: first.id, city: 'Сохранённый город', version: 1 }))
})

it('does not close a different trainer editor when an earlier save finishes', async () => {
  const office = { id: '20000000-0000-4000-8000-000000000001', city: 'Москва', name: 'Тестовый', address: 'Тестовый адрес', archived: false, version: 1 }
  const first = { id: '30000000-0000-4000-8000-000000000001', name: 'Первый', isYandex: true, officeIds: [office.id], version: 1 }
  const second = { ...first, id: '30000000-0000-4000-8000-000000000002', name: 'Второй' }
  api.access.mockResolvedValue(true); api.bundle.mockResolvedValue({ offices: [office], trainers: [first, second] })
  let finish!: () => void
  api.saveTrainer.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/admin']}><CorporateAdminPage /></MemoryRouter></QueryClientProvider>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Настроить тренера Первый' }))
  await user.click(screen.getByRole('checkbox', { name: 'Тренер Яндекса' }))
  await user.click(screen.getByRole('button', { name: 'Сохранить тренера' }))
  expect(api.saveTrainer).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Настроить тренера Второй' }))
  await user.click(screen.getByRole('checkbox', { name: 'Тренер Яндекса' }))
  await act(async () => { finish(); await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(screen.getByRole('form', { name: 'Настройки Второй' })).toBeVisible()
  expect(screen.getByRole('checkbox', { name: 'Тренер Яндекса' })).not.toBeChecked()
  expect(api.saveTrainer).toHaveBeenCalledWith(expect.objectContaining({ id: first.id, isYandex: false, version: 1 }))
})
