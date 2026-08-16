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
  plannedCount: 1, completedCount: 3, completedPlannedCount: 1,
  partialCount: 0, skippedCount: 0, completionPercent: 100,
}, {
  period: 'month', periodStart: localDate('2026-08-01'), periodEnd: localDate('2026-08-31'),
  plannedCount: 0, completedCount: 0, completedPlannedCount: 0,
  partialCount: 0, skippedCount: 0, completionPercent: null,
}]

describe('WorkoutRegularityContent', () => {
  it('makes all completed workouts primary and keeps plan adherence secondary', async () => {
    const user = userEvent.setup()
    render(<WorkoutRegularityContent periods={periods} />)
    expect(screen.getByRole('tab', { name: 'Неделя' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('3 тренировки')).toBeVisible()
    expect(screen.getByLabelText('Состав завершённых тренировок')).toHaveTextContent('1 по плану')
    expect(screen.getByLabelText('Состав завершённых тренировок')).toHaveTextContent('2 самостоятельно')
    expect(screen.getByText(/План тренера:/)).toHaveTextContent('1 из 1 выполнено')
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Месяц' }))
    expect(screen.getByText('Пока без тренировок')).toBeVisible()
  })

  it('keeps partial and skipped workouts explicit without adding them to completed', () => {
    render(<WorkoutRegularityContent periods={[{ ...periods[0]!, partialCount: 1, skippedCount: 1 }]} />)
    expect(screen.getByText('3 тренировки')).toBeVisible()
    expect(screen.getByText('Частично выполнено: 1 · Пропущено: 1')).toBeVisible()
  })

  it('keeps an explicit empty state when there is no plan denominator', () => {
    render(<WorkoutRegularityContent periods={[periods[1]!]} />)
    expect(screen.getByText('Пока без тренировок')).toBeVisible()
    expect(screen.getByText('Здесь появится первая завершённая тренировка')).toBeVisible()
    expect(screen.getByText('План тренера на этот период не назначен')).toBeVisible()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('explains completed workouts when there is no assigned plan', () => {
    render(<WorkoutRegularityContent periods={[{ ...periods[1]!, completedCount: 2 }]} />)
    expect(screen.getByText('2 тренировки')).toBeVisible()
    expect(screen.getByLabelText('Состав завершённых тренировок')).toHaveTextContent('2 самостоятельно')
    expect(screen.getByText('План тренера на этот период не назначен')).toBeVisible()
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

    expect(await screen.findByRole('heading', { name: 'Тренировки' })).toBeVisible()
    expect(await screen.findByText('3 тренировки')).toBeVisible()
    expect(repository.regularity).toHaveBeenCalledWith('client-1')
  })

  it('shows a retry action after a server error', async () => {
    const user = userEvent.setup()
    repository.regularity.mockRejectedValueOnce(new Error('Сводка недоступна')).mockResolvedValueOnce(periods)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<WorkoutRegularityCard clientId="client-1" />, { wrapper: wrapper(queryClient) })

    expect(await screen.findByText('Сводка недоступна')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('3 тренировки')).toBeVisible()
    expect(repository.regularity).toHaveBeenCalledTimes(2)
  })
})
