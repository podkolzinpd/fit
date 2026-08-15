import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkoutRegularity } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { WorkoutRegularityCard, WorkoutRegularityContent } from './WorkoutRegularityCard'

const repository = vi.hoisted(() => ({ regularity: vi.fn() }))
vi.mock('../../data/repositories/progress.repository', () => ({
  progressRepository: { regularity: repository.regularity },
}))

const periods: WorkoutRegularity[] = [{
  period: 'week', periodStart: localDate('2026-08-10'), periodEnd: localDate('2026-08-16'),
  plannedCount: 4, completedCount: 3, completedPlannedCount: 2,
  partialCount: 1, skippedCount: 1, completionPercent: 50,
}, {
  period: 'month', periodStart: localDate('2026-08-01'), periodEnd: localDate('2026-08-31'),
  plannedCount: 0, completedCount: 0, completedPlannedCount: 0,
  partialCount: 0, skippedCount: 0, completionPercent: null,
}]

describe('WorkoutRegularityContent', () => {
  it('shows the same deterministic plan/fact fields without turning partial sets into completed workouts', () => {
    render(<WorkoutRegularityContent periods={periods} />)
    expect(screen.getByRole('heading', { name: 'Неделя' })).toBeVisible()
    expect(screen.getByText('50%')).toBeVisible()
    expect(screen.getByText('частично 1 · пропущено 1 · самостоятельно 1')).toBeVisible()
    expect(screen.getAllByText('выполнено')[0]?.previousSibling).toHaveTextContent('3')
    expect(screen.getByRole('progressbar', { name: /неделя/ })).toHaveAttribute('aria-valuenow', '50')
  })

  it('keeps an explicit empty state when there is no plan denominator', () => {
    render(<WorkoutRegularityContent periods={[periods[1]!]} />)
    expect(screen.getByText('—')).toBeVisible()
    expect(screen.getByText('Тренировок пока нет')).toBeVisible()
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
  })
})

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('WorkoutRegularityCard', () => {
  beforeEach(() => repository.regularity.mockReset())

  it('loads the shared server aggregate for the client', async () => {
    repository.regularity.mockResolvedValue(periods)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<WorkoutRegularityCard clientId="client-1" />, { wrapper: wrapper(queryClient) })

    expect(await screen.findByRole('heading', { name: 'Регулярность' })).toBeVisible()
    expect(await screen.findByText('50%')).toBeVisible()
    expect(repository.regularity).toHaveBeenCalledWith('client-1')
  })

  it('shows a retry action after a server error', async () => {
    const user = userEvent.setup()
    repository.regularity.mockRejectedValueOnce(new Error('Сводка недоступна')).mockResolvedValueOnce(periods)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<WorkoutRegularityCard clientId="client-1" />, { wrapper: wrapper(queryClient) })

    expect(await screen.findByText('Сводка недоступна')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('50%')).toBeVisible()
    expect(repository.regularity).toHaveBeenCalledTimes(2)
  })
})
