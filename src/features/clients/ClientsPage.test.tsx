import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatThread, Client } from '../../shared/domain'
import { ClientsPage } from './ClientsListPage'

const backend = vi.hoisted(() => ({ list: vi.fn(), setArchived: vi.fn(), listThreads: vi.fn(), open: vi.fn() }))
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ clients: { list: backend.list, setArchived: backend.setArchived }, chat: { listThreads: backend.listThreads, open: backend.open } }),
}))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { role: 'trainer', userId: 'trainer-1' } }) }))

// Из workouts.repository экрану нужен только формат ИМТ, а тест проверяет
// поиск, а не расчёт. Заглушка держит тест на одном модуле вместо всего
// репозитория тренировок.
vi.mock('../../data/repositories/workouts.repository', () => ({ bmiLabel: () => '23.3' }))

const client = (id: string, fullName: string, hasAccount = false, archivedAt: string | null = null): Client => ({
  id, canArchive: false, fullName, canonicalFullName: fullName, hasAccount, gender: null,
  ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null,
  currentWeightKg: null, archivedAt, version: 1, membershipVersion: null,
})

const thread = (clientId: string, unreadCount = 0, activeConnection = true): ChatThread => ({
  conversationId: `conversation-${clientId}`, clientId, trainerId: 'trainer-1', partnerUserId: `user-${clientId}`,
  partnerName: 'Анна Смирнова', activeConnection, lastMessageBody: 'До встречи',
  lastMessageAt: '2026-09-10T12:00:00.000Z', lastMessageSenderId: `user-${clientId}`, unreadCount,
  canMessage: true, blockedByMe: false, blockedByPartner: false,
})

const NAMES = ['Анна Смирнова', 'Борис Иванов', 'Вера Кузнецова', 'Глеб Орлов', 'Дарья Ершова', 'Егор Панов']

function renderPage(clients: Client[], initialEntry = '/clients') {
  backend.list.mockResolvedValue(clients)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<MemoryRouter initialEntries={[initialEntry]}><QueryClientProvider client={queryClient}><Routes>
    <Route path="/clients" element={<ClientsPage />} />
    <Route path="/clients/:clientId" element={<p>Профиль открыт</p>} />
    <Route path="/chat/:conversationId" element={<p>Чат открыт</p>} />
  </Routes></QueryClientProvider></MemoryRouter>)
}

beforeEach(() => {
  backend.list.mockReset()
  backend.setArchived.mockReset()
  backend.listThreads.mockReset().mockResolvedValue([])
  backend.open.mockReset().mockResolvedValue('conversation-new')
  window.localStorage?.clear()
  window.sessionStorage?.clear()
})

describe('ClientsPage archive actions', () => {
  it('shows archive controls only to the root trainer and keeps one action rail open', async () => {
    const user = userEvent.setup()
    renderPage([
      { ...client('root-1', 'Анна Смирнова'), canArchive: true },
      { ...client('root-2', 'Борис Иванов'), canArchive: true },
      client('member', 'Вера Кузнецова'),
    ])

    const first = await screen.findByRole('button', { name: 'Действия с клиентом Анна Смирнова' })
    const second = screen.getByRole('button', { name: 'Действия с клиентом Борис Иванов' })
    expect(screen.queryByRole('button', { name: 'Действия с клиентом Вера Кузнецова' })).not.toBeInTheDocument()

    await user.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    await user.click(second)
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(second).toHaveAttribute('aria-expanded', 'true')
  })

  it('archives only after the explicit action and can restore the returned version', async () => {
    const user = userEvent.setup()
    const rootClient = { ...client('root', 'Анна Смирнова'), canArchive: true }
    backend.setArchived
      .mockResolvedValueOnce({ ...rootClient, archivedAt: '2026-09-18T10:00:00.000Z', version: 2 })
      .mockResolvedValueOnce({ ...rootClient, archivedAt: null, version: 3 })
    renderPage([rootClient])

    await user.click(await screen.findByRole('button', { name: 'Действия с клиентом Анна Смирнова' }))
    expect(backend.setArchived).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'В архив' }))
    await waitFor(() => expect(backend.setArchived).toHaveBeenCalledWith(rootClient, true))
    expect(await screen.findByText('Карточка «Анна Смирнова» перемещена в архив')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Вернуть' }))
    await waitFor(() => expect(backend.setArchived).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'root', version: 2, archivedAt: '2026-09-18T10:00:00.000Z' }),
      false,
    ))
    expect(await screen.findByText('Карточка «Анна Смирнова» восстановлена')).toBeVisible()
  })

  it('offers restoration for an archived root client', async () => {
    const user = userEvent.setup()
    const archived = { ...client('archived-root', 'Архивный спортсмен', false, '2026-09-01T00:00:00.000Z'), canArchive: true }
    backend.setArchived.mockResolvedValue({ ...archived, archivedAt: null, version: 2 })
    renderPage([archived])

    await user.click(await screen.findByRole('button', { name: 'Действия с клиентом Архивный спортсмен' }))
    await user.click(screen.getByRole('button', { name: 'Восстановить' }))
    await waitFor(() => expect(backend.setArchived).toHaveBeenCalledWith(archived, false))
  })

  it('keeps the action open and shows the server error when archiving fails', async () => {
    const user = userEvent.setup()
    const rootClient = { ...client('root-error', 'Анна Смирнова'), canArchive: true }
    backend.setArchived.mockRejectedValue(new Error('Данные уже изменились. Обновите страницу и повторите.'))
    renderPage([rootClient])

    const menu = await screen.findByRole('button', { name: 'Действия с клиентом Анна Смирнова' })
    await user.click(menu)
    await user.click(screen.getByRole('button', { name: 'В архив' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Данные уже изменились')
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: 'Вернуть' })).not.toBeInTheDocument()
  })
})

describe('ClientsPage search', () => {
  it('keeps client-code entry visible even before the trainer has clients', async () => {
    renderPage([])

    expect(await screen.findByRole('link', { name: 'Ввести код' })).toHaveAttribute('href', '/join')
  })

  it('filters by name and clears the query from the field itself', async () => {
    const user = userEvent.setup()
    renderPage(NAMES.map((name, index) => client(`c${index}`, name)))

    const field = await screen.findByLabelText('Поиск клиента')
    expect(screen.queryByRole('button', { name: 'Очистить поиск' })).not.toBeInTheDocument()

    await user.type(field, 'кузнец')
    expect(screen.getByText('Вера Кузнецова')).toBeVisible()
    expect(screen.queryByText('Анна Смирнова')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Очистить поиск' }))
    expect(field).toHaveValue('')
    expect(screen.getByText('Анна Смирнова')).toBeVisible()
  })

  it('explains an empty result instead of showing a bare list', async () => {
    const user = userEvent.setup()
    renderPage(NAMES.map((name, index) => client(`c${index}`, name)))

    await user.type(await screen.findByLabelText('Поиск клиента'), 'Ярослав')
    expect(screen.getByText('По этому имени клиентов не найдено.')).toBeVisible()
  })

  it('hides the field while the list is still short enough to scan', async () => {
    renderPage(NAMES.slice(0, 5).map((name, index) => client(`c${index}`, name)))

    expect(await screen.findByText('Анна Смирнова')).toBeVisible()
    expect(screen.queryByLabelText('Поиск клиента')).not.toBeInTheDocument()
  })
})

describe('ClientsPage chat actions', () => {
  it('opens an existing conversation directly and shows a capped unread badge', async () => {
    const user = userEvent.setup()
    backend.listThreads.mockResolvedValue([thread('c1', 105)])
    renderPage([client('c1', 'Анна Смирнова', true)])

    const action = await screen.findByRole('button', { name: 'Сообщения с Анна Смирнова, непрочитанных: 105' })
    expect(action).toHaveTextContent('99+')
    await user.click(action)

    expect(await screen.findByText('Чат открыт')).toBeVisible()
    expect(backend.open).not.toHaveBeenCalled()
  })

  it('creates a missing conversation once while a rapid second click is blocked', async () => {
    const user = userEvent.setup()
    let finish: ((value: string) => void) | undefined
    backend.open.mockReturnValue(new Promise<string>((resolve) => { finish = resolve }))
    renderPage([client('c1', 'Анна Смирнова', true), client('c2', 'Борис Иванов', true)])

    const action = await screen.findByRole('button', { name: 'Сообщения с Анна Смирнова' })
    await user.dblClick(action)
    expect(backend.open).toHaveBeenCalledTimes(1)
    expect(action).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Сообщения с Борис Иванов' })).toBeEnabled()

    finish?.('conversation-new')
    expect(await screen.findByText('Чат открыт')).toBeVisible()
  })

  it('keeps history available for an archived client and hides chat without account or history', async () => {
    backend.listThreads.mockResolvedValue([thread('archived', 0, false)])
    renderPage([
      client('archived', 'Архивный спортсмен', true, '2026-09-01T00:00:00.000Z'),
      client('offline', 'Без аккаунта'),
    ])

    expect(await screen.findByRole('button', { name: 'Сообщения с Архивный спортсмен' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Сообщения с Без аккаунта' })).not.toBeInTheDocument()
  })

  it('shows a local retry state without blocking the client profile', async () => {
    const user = userEvent.setup()
    backend.open.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('conversation-new')
    renderPage([client('c1', 'Анна Смирнова', true)])

    await user.click(await screen.findByRole('button', { name: 'Сообщения с Анна Смирнова' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Повторить')
    expect(screen.getByRole('link', { name: /Анна Смирнова/ })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Сообщения с Анна Смирнова' }))
    await waitFor(() => expect(screen.getByText('Чат открыт')).toBeVisible())
  })
})
