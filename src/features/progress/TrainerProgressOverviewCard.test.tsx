import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkoutRegularity } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { TrainerProgressOverviewCard, TrainerProgressOverviewContent } from './TrainerProgressOverviewCard'

const repository = vi.hoisted(() => ({ regularity: vi.fn() }))
vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor: { userId: 'trainer-1', timezone: 'Europe/Moscow' } }),
}))
vi.mock('../../data/repositories/progress.repository', () => ({
  progressRepository: repository,
}))

const week: WorkoutRegularity = {
  period: 'week',
  periodStart: localDate('2026-08-17'),
  periodEnd: localDate('2026-08-23'),
  plannedCount: 4,
  completedCount: 3,
  completedPlannedCount: 2,
  partialCount: 1,
  skippedCount: 2,
  completionPercent: 50,
}

describe('TrainerProgressOverviewContent', () => {
  it('shows the completed week without treating partial work as a missed workout', () => {
    render(<TrainerProgressOverviewContent week={week} />)

    expect(screen.getByText('3 тренировки состоялось')).toBeVisible()
    expect(screen.getByText('Из 4 по плану: 1 полностью · 1 частично · 2 не состоялись · 1 самостоятельно')).toBeVisible()
    expect(screen.getByText('Эта неделя').closest('article')).toHaveClass('is-positive')
  })

  it('keeps an empty week neutral and explains the plan', () => {
    render(<TrainerProgressOverviewContent week={{ ...week, completedCount: 0, completedPlannedCount: 0, partialCount: 0 }} />)

    expect(screen.getByText('Тренировок пока не было')).toBeVisible()
    expect(screen.getByText('Эта неделя').closest('article')).not.toHaveClass('is-positive')
  })

  it('uses the singular neutral wording for one workout that did not happen', () => {
    render(<TrainerProgressOverviewContent week={{ ...week, skippedCount: 1 }} />)

    expect(screen.getByText('Из 4 по плану: 1 полностью · 1 частично · 1 не состоялась · 1 самостоятельно')).toBeVisible()
  })
})

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('TrainerProgressOverviewCard', () => {
  beforeEach(() => repository.regularity.mockReset())

  it('loads only the current regularity source', async () => {
    repository.regularity.mockResolvedValue([week])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<TrainerProgressOverviewCard clientId="client-1" />, { wrapper: wrapper(queryClient) })

    expect(await screen.findByRole('region', { name: 'Тренировки за неделю' })).toBeVisible()
    expect(await screen.findByText('3 тренировки состоялось')).toBeVisible()
    expect(repository.regularity).toHaveBeenCalledWith('client-1')
  })

  it('keeps the retry path', async () => {
    const user = userEvent.setup()
    repository.regularity.mockRejectedValueOnce(new Error('Неделя недоступна')).mockResolvedValueOnce([week])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<TrainerProgressOverviewCard clientId="client-1" />, { wrapper: wrapper(queryClient) })

    expect(await screen.findByText('Неделя недоступна')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('3 тренировки состоялось')).toBeVisible()
  })
})
