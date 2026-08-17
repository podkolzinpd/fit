import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localDate } from '../../shared/local-date'
import { RunningProgressCard } from './RunningProgressCard'

const repository = vi.hoisted(() => ({ running: vi.fn() }))
vi.mock('../../data/repositories/progress.repository', () => ({ progressRepository: repository }))
vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor: { timezone: 'Europe/Moscow' } }),
}))

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('RunningProgressCard', () => {
  beforeEach(() => repository.running.mockReset())

  it('stays hidden when the client has no confirmed runs', async () => {
    repository.running.mockResolvedValue([])
    const { container } = render(<RunningProgressCard clientId="client-1" />, { wrapper: wrapper() })
    await waitFor(() => expect(repository.running).toHaveBeenCalledOnce())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows compact totals, readable pace, RPE and a comparable insight', async () => {
    repository.running.mockResolvedValue([
      { workoutId: 'w1', workoutDate: localDate('2026-08-01'), format: 'easy', distanceKm: 5, durationSec: 1800, paceSecPerKm: 360, rpe: 7 },
      { workoutId: 'w2', workoutDate: localDate('2026-08-08'), format: 'easy', distanceKm: 5.5, durationSec: 1881, paceSecPerKm: 342, rpe: 8 },
    ])
    render(<RunningProgressCard clientId="client-1" />, { wrapper: wrapper() })
    expect(await screen.findByText('2 пробежки')).toBeVisible()
    expect(screen.getByText('10,5 км · 1 ч 1 мин')).toBeVisible()
    expect(screen.getByText('5:51')).toBeVisible()
    expect(screen.getByText('7,5')).toBeVisible()
    expect(screen.getByText(/быстрее на 5%/)).toBeVisible()
    expect(screen.getByText('Последняя нагрузка: RPE 8')).toBeVisible()
  })

  it('changes the requested period without changing the LLM card', async () => {
    repository.running.mockResolvedValue([
      { workoutId: 'w1', workoutDate: localDate('2026-08-01'), format: 'easy', distanceKm: 5, durationSec: 1800, paceSecPerKm: 360 },
    ])
    render(<RunningProgressCard clientId="client-1" />, { wrapper: wrapper() })
    await screen.findByText('1 пробежка')
    await userEvent.click(screen.getByRole('tab', { name: '3 мес.' }))
    expect(repository.running).toHaveBeenCalledTimes(2)
  })
})
