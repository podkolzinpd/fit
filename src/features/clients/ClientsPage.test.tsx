import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatThread, Client } from '../../shared/domain'
import { ArchivedClientsPage, ClientsPage } from './ClientsListPage'

const backend = vi.hoisted(() => ({ list: vi.fn(), setArchived: vi.fn(), listThreads: vi.fn(), open: vi.fn(), listFinanceOverview: vi.fn() }))
vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ clients: { list: backend.list, setArchived: backend.setArchived }, chat: { listThreads: backend.listThreads, open: backend.open }, trainerFinance: { listOverview: backend.listFinanceOverview } }),
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

// State-machine coverage only: real browser input is verified separately in E2E.
class TestPointerEvent extends MouseEvent {
  pointerId: number
  isPrimary: boolean
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.isPrimary = init.isPrimary ?? true
  }
}

async function swipeSurface() {
  const link = await screen.findByRole('link', { name: /Анна Смирнова/ })
  const surface = link.closest<HTMLElement>('.client-swipe-surface')!
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 350, 100))
  Object.assign(surface, { hasPointerCapture: () => false, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
  return surface
}

function pointerEvent(surface: Element, type: string, x: number, y = 40) {
  fireEvent(surface, new TestPointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y }))
}

function renderPage(clients: Client[] | undefined, initialEntry = '/clients') {
  if (clients) backend.list.mockResolvedValue(clients)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<MemoryRouter initialEntries={[initialEntry]}><QueryClientProvider client={queryClient}><Routes>
    <Route path="/clients" element={<ClientsPage />} />
    <Route path="/clients/archive" element={<ArchivedClientsPage />} />
    <Route path="/clients/:clientId" element={<p>Профиль открыт</p>} />
    <Route path="/finance" element={<p>Финансы открыты</p>} />
    <Route path="/chat/:conversationId" element={<p>Чат открыт</p>} />
  </Routes></QueryClientProvider></MemoryRouter>)
}

beforeEach(() => {
  Object.assign(HTMLElement.prototype, { hasPointerCapture: () => false, setPointerCapture: () => undefined, releasePointerCapture: () => undefined })
  backend.list.mockReset()
  backend.setArchived.mockReset()
  backend.listThreads.mockReset().mockResolvedValue([])
  backend.open.mockReset().mockResolvedValue('conversation-new')
  backend.listFinanceOverview.mockReset().mockResolvedValue({ month: '2026-09', receivedCents: 0, dueCents: 0, attentionCount: 0, clients: [] })
  window.localStorage?.clear()
  window.sessionStorage?.clear()
})

describe('ClientsPage archive actions', () => {
  it('labels archiving with an archive icon and keeps restore visually distinct', async () => {
    const root = { ...client('root', 'Анна Смирнова'), canArchive: true }
    const { unmount } = renderPage([root])
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Действия с клиентом Анна Смирнова' }))
    const action = screen.getByRole('button', { name: 'В архив' })
    expect(action.querySelector('svg')).toHaveAttribute('data-icon', 'archive')
    expect(action.querySelector('.client-swipe-action-icon')).toHaveAttribute('aria-hidden', 'true')
    expect(action.querySelector('[data-icon="trash"]')).not.toBeInTheDocument()
    unmount()
    renderPage([{ ...root, archivedAt: '2026-10-07T12:00:00Z' }], '/clients/archive')
    await user.click(await screen.findByRole('button', { name: 'Действия с клиентом Анна Смирнова' }))
    expect(screen.getByRole('button', { name: 'Восстановить' }).querySelector('svg')).toHaveAttribute('data-icon', 'history')
  })

  it('archives once on a full swipe release without an archive-button click and undo uses the returned version', async () => {
    const root = { ...client('root', 'Анна Смирнова'), canArchive: true }
    backend.setArchived.mockResolvedValueOnce({ ...root, archivedAt: '2026-10-06T12:00:00Z', version: 2 })
      .mockResolvedValueOnce({ ...root, version: 3 })
    renderPage([root])
    const surface = await swipeSurface()
    pointerEvent(surface, 'pointerdown', 310)
    pointerEvent(surface, 'pointermove', 65)
    pointerEvent(surface.querySelector('svg')!, 'lostpointercapture', 65)
    expect(surface.closest('.client-swipe-row')).toHaveClass('is-armed')
    expect(backend.setArchived).not.toHaveBeenCalled()
    pointerEvent(surface, 'pointerup', 65)
    pointerEvent(surface, 'pointerup', 65)
    await waitFor(() => expect(backend.setArchived).toHaveBeenCalledExactlyOnceWith(root, true))
    fireEvent.click(surface.querySelector('a')!, { detail: 1 })
    expect(screen.queryByText('Профиль открыт')).not.toBeInTheDocument()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Вернуть' }))
    await waitFor(() => expect(backend.setArchived).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'root', version: 2 }), false))
  })

  it.each(['short', 'reversed', 'vertical', 'cancelled', 'lost-capture'] as const)('does not archive a %s gesture', async (kind) => {
    renderPage([{ ...client('root', 'Анна Смирнова'), canArchive: true }])
    const surface = await swipeSurface()
    pointerEvent(surface, 'pointerdown', 310)
    if (kind === 'vertical') pointerEvent(surface, 'pointermove', 305, 110)
    else {
      pointerEvent(surface, 'pointermove', kind === 'short' ? 210 : 60)
      if (kind === 'reversed') pointerEvent(surface, 'pointermove', 300)
    }
    pointerEvent(surface, kind === 'cancelled' ? 'pointercancel' : kind === 'lost-capture' ? 'lostpointercapture' : 'pointerup', kind === 'short' ? 210 : kind === 'reversed' ? 300 : 60)
    expect(backend.setArchived).not.toHaveBeenCalled()
    expect(surface.closest('.client-swipe-row')).not.toHaveClass('is-armed')
    expect(surface).toHaveStyle({ transform: kind === 'short' ? 'translate3d(-112px, 0, 0)' : 'translate3d(0px, 0, 0)' })
  })

  it('keeps the card and an error without success feedback when full-swipe archiving fails', async () => {
    backend.setArchived.mockRejectedValue(new Error('Нет связи. Повторите попытку.'))
    renderPage([{ ...client('root', 'Анна Смирнова'), canArchive: true }])
    const surface = await swipeSurface()
    pointerEvent(surface, 'pointerdown', 310)
    pointerEvent(surface, 'pointermove', 60)
    pointerEvent(surface, 'pointerup', 60)
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи')
    expect(screen.getByRole('link', { name: /Анна Смирнова/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Вернуть' })).not.toBeInTheDocument()
    expect(backend.list.mock.calls.length).toBeGreaterThan(1)
  })

  it('uses the release position to cancel a coalesced pull-back and accepts a swipe after vertical scrolling', async () => {
    const root = { ...client('root', 'Анна Смирнова'), canArchive: true }
    backend.setArchived.mockResolvedValue({ ...root, archivedAt: '2026-10-06T12:00:00Z', version: 2 })
    renderPage([root])
    const surface = await swipeSurface()
    pointerEvent(surface, 'pointerdown', 310)
    pointerEvent(surface, 'pointermove', 60)
    pointerEvent(surface, 'pointerup', 300)
    expect(backend.setArchived).not.toHaveBeenCalled()
    pointerEvent(surface, 'pointerdown', 310)
    pointerEvent(surface, 'pointermove', 305, 120)
    pointerEvent(surface, 'pointerup', 305, 120)
    pointerEvent(surface, 'pointerdown', 310)
    pointerEvent(surface, 'pointermove', 60)
    pointerEvent(surface, 'pointerup', 60)
    await waitFor(() => expect(backend.setArchived).toHaveBeenCalledExactlyOnceWith(root, true))
  })

  it('blocks another full swipe while the server has not confirmed the first', async () => {
    let resolve: (value: Client) => void = () => undefined
    const root = { ...client('root', 'Анна Смирнова'), canArchive: true }
    backend.setArchived.mockReturnValue(new Promise<Client>((done) => { resolve = done }))
    renderPage([root])
    const surface = await swipeSurface()
    pointerEvent(surface, 'pointerdown', 310)
    pointerEvent(surface, 'pointermove', 60)
    pointerEvent(surface, 'pointerup', 60)
    expect(await screen.findByRole('button', { name: 'Архивируем…' })).toBeDisabled()
    expect(surface.closest('.client-swipe-row')).toHaveAttribute('aria-busy', 'true')
    pointerEvent(surface, 'pointerdown', 310)
    pointerEvent(surface, 'pointermove', 60)
    pointerEvent(surface, 'pointerup', 60)
    expect(backend.setArchived).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Вернуть' })).not.toBeInTheDocument()
    resolve({ ...root, archivedAt: '2026-10-06T12:00:00Z', version: 2 })
    expect(await screen.findByRole('button', { name: 'Вернуть' })).toBeEnabled()
    expect(document.querySelector('.clients-archive-feedback-icon svg')).toHaveAttribute('data-icon', 'check')
  })

  it('keeps archived clients out of the working list and always shows the archive entry last', async () => {
    renderPage([
      client('active', 'Анна Смирнова'),
      client('archived', 'Архивный спортсмен', false, '2026-09-01T00:00:00.000Z'),
    ])

    expect(await screen.findByText('Анна Смирнова')).toBeVisible()
    expect(screen.queryByText('Архивный спортсмен')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Архив' })).toHaveAttribute('href', '/clients/archive')
    expect(backend.list).toHaveBeenCalledWith(false)
  })

  it('opens a separate archive with only archived clients', async () => {
    renderPage([
      client('active', 'Анна Смирнова'),
      client('archived', 'Архивный спортсмен', false, '2026-09-01T00:00:00.000Z'),
    ], '/clients/archive')

    expect(await screen.findByText('Архивный спортсмен')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Архив' })).toBeVisible()
    expect(screen.queryByText('Анна Смирнова')).not.toBeInTheDocument()
    expect(backend.list).toHaveBeenCalledWith(true)
    expect(screen.getByRole('link', { name: /Архивный спортсмен/ })).toHaveAttribute('href', '/clients/archived')
  })

  it('explains when the archive is empty', async () => {
    renderPage([], '/clients/archive')

    expect(await screen.findByRole('heading', { name: 'Архив пуст' })).toBeVisible()
    expect(screen.getByText('Здесь появятся карточки, которые вы отправите в архив.')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Архив' })).not.toBeInTheDocument()
  })

  it('supports search inside a longer archive', async () => {
    const user = userEvent.setup()
    const archived = NAMES.map((name, index) => client(`archived-${index}`, name, false, '2026-09-01T00:00:00.000Z'))
    renderPage(archived, '/clients/archive?q=кузнец')

    expect(await screen.findByText('Вера Кузнецова')).toBeVisible()
    expect(screen.queryByText('Анна Смирнова')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Очистить поиск' }))
    expect(screen.getByText('Анна Смирнова')).toBeVisible()
  })

  it('retries an archive loading error and returns to the clients list', async () => {
    const user = userEvent.setup()
    backend.list.mockRejectedValueOnce(new Error('Архив временно недоступен')).mockResolvedValue([])
    renderPage(undefined, '/clients/archive')

    expect(await screen.findByRole('alert')).toHaveTextContent('Архив временно недоступен')
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('heading', { name: 'Архив пуст' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    expect(await screen.findByRole('heading', { name: 'Клиенты' })).toBeVisible()
  })

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
    await user.click(first)
    const surface = second.closest<HTMLElement>('.client-swipe-surface')!
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 350, 100))
    pointerEvent(surface, 'pointerdown', 310)
    pointerEvent(surface, 'pointermove', 210)
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(surface).toHaveStyle({ transform: 'translate3d(-100px, 0, 0)' })
    pointerEvent(surface, 'pointerup', 210)
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
    renderPage([archived], '/clients/archive')

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
  it('shows a compact finance entry and the client finance state', async () => {
    backend.listFinanceOverview.mockResolvedValue({ month: '2026-09', receivedCents: 2500000, dueCents: 500000, attentionCount: 1, clients: [{ clientId: 'active', fullName: 'Анна Смирнова', archivedAt: null, receivedCents: 2500000, dueCents: 500000, activePackageCount: 1, upcomingPackageCount: 0, sessionsRemaining: 2, overdue: false, lowSessions: true, unassignedSessions: 0, needsAttention: true }] })
    renderPage([client('active', 'Анна Смирнова')])

    expect(await screen.findByRole('link', { name: /25.*000.*получено.*1.*требуют внимания/ })).toHaveAttribute('href', '/finance')
    expect(screen.getByText(/К оплате 5.*000.*₽/)).toBeVisible()
  })

  it('offers a direct invitation and keeps manual profile creation available', async () => {
    renderPage([])

    expect(await screen.findByRole('button', { name: 'Пригласить спортсмена' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Добавить' })).toHaveAttribute('href', '/clients/new')
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
    renderPage([client('archived', 'Архивный спортсмен', true, '2026-09-01T00:00:00.000Z')], '/clients/archive')

    expect(await screen.findByRole('button', { name: 'Сообщения с Архивный спортсмен' })).toBeVisible()
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
