import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { PrivateAnalyticsPage } from './PrivateAnalyticsPage'

const read = vi.hoisted(() => vi.fn())
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { userId: 'test' } }) }))
vi.mock('../../app/theme', () => ({ useAppTheme: () => 'light' }))
vi.mock('../../data/yandex-app-session-transport', () => ({ yandexAppSessionTransport: () => ({ apiBaseUrl: 'https://example.test', sessionToken: 'test' }) }))
vi.mock('../../data/queries/yandex-main.queries', () => ({ createYandexMainQueries: () => ({ read }) }))

afterEach(() => vi.resetAllMocks())
function showPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><PrivateAnalyticsPage /></QueryClientProvider>)
}

it('shows only an access error for a forbidden response', async () => {
  read.mockResolvedValue(new Response(null, { status: 403 }))
  showPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет доступа')
  expect(screen.queryByText('Клиенты у тренеров')).not.toBeInTheDocument()
})

it('shows metrics and filters client records without changing trainer metrics', async () => {
  read.mockResolvedValue(Response.json({ trainersTotal: 1, computedAt: '2026-11-05T09:00:00Z',
    trainers: [{ trainer_id: 'trainer', clients_total: 2, clients_app_linked: 1, workouts_total: 3, trainer_status: 'active' }],
    clients: [{ client_id: 'first', is_self_registered: true }, { client_id: 'second', is_self_registered: false }], feedback: [] }))
  showPage()
  expect(await screen.findByText('first')).toBeVisible()
  expect(screen.getByText('second')).toBeVisible()
  await userEvent.selectOptions(screen.getByLabelText('Регистрация'), 'self')
  expect(screen.queryByText('second')).not.toBeInTheDocument()
  expect(screen.getByText('first')).toBeVisible()
  const card = screen.getByText('Клиенты у тренеров').parentElement
  expect(card && within(card).getByText('2')).toBeInTheDocument()
})

it('hides previously loaded data when access is revoked on refresh', async () => {
  read.mockResolvedValueOnce(Response.json({ trainersTotal: 0, computedAt: '2026-11-05T09:00:00Z', trainers: [], clients: [], feedback: [{ id: 'f', message: 'Синтетический отзыв' }] }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
  showPage()
  expect(await screen.findByText('Синтетический отзыв')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Обновить' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет доступа')
  expect(screen.queryByText('Синтетический отзыв')).not.toBeInTheDocument()
})
