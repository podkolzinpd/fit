import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrainingSummary, WorkoutRegularity } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { TrainerProgressOverviewCard, TrainerProgressOverviewContent } from './TrainerProgressOverviewCard'

const repositories = vi.hoisted(() => ({
  regularity: vi.fn(),
  listForTrainer: vi.fn(),
}))
vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor: { timezone: 'Europe/Moscow' } }),
}))
vi.mock('../../data/repositories/progress.repository', () => ({
  progressRepository: { regularity: repositories.regularity },
}))
vi.mock('../../data/repositories/training-summaries.repository', () => ({
  trainingSummariesRepository: { listForTrainer: repositories.listForTrainer },
}))

const week: WorkoutRegularity = {
  period: 'week',
  periodStart: localDate('2026-08-17'),
  periodEnd: localDate('2026-08-23'),
  plannedCount: 3,
  completedCount: 3,
  completedPlannedCount: 2,
  partialCount: 2,
  skippedCount: 0,
  completionPercent: 67,
}

const summary: TrainingSummary = {
  id: 'summary-1',
  clientId: 'client-1',
  periodStart: localDate('2026-02-17'),
  periodEnd: localDate('2026-08-16'),
  trainer: {
    headline: 'Рабочий вес вырос на 16,67%.',
    progress: ['Есть рост силовых показателей.'],
    consistency: 'Ритм нестабилен.',
    attention: ['Проверить максимальный перерыв в 21 день.', 'Сверить нагрузку с целью.'],
  },
  client: {
    headline: 'Силовые показатели растут.', achievements: [], consistency: '', encouragement: '',
  },
  metrics: { completedWorkouts: 5, workoutsPerWeek: 1.13, activeWeeks: 2, longestGapDays: 21, progressFacts: [] },
  generatedAt: '2026-08-16T11:23:56Z',
  version: 1,
  published: true,
}

describe('TrainerProgressOverviewContent', () => {
  it('answers the three trainer questions without changing source metrics', () => {
    render(<TrainerProgressOverviewContent week={week} summary={summary} />)

    expect(screen.getByText('3 тренировки за неделю')).toBeVisible()
    expect(screen.getByText('По плану 2 из 3 · 2 частично')).toBeVisible()
    expect(screen.getByText('Рабочий вес вырос на 17%.')).toBeVisible()
    expect(screen.getByText('Проверить максимальный перерыв в 21 день.')).toBeVisible()
    expect(screen.getByText('Ещё сигналов: 1')).toBeVisible()
    expect(screen.getByText('Регулярность').closest('article')).toHaveClass('is-positive')
  })

  it('does not show a success state before a workout is completed', () => {
    render(<TrainerProgressOverviewContent week={{ ...week, completedCount: 0, completedPlannedCount: 0, partialCount: 0 }} summary={summary} />)

    expect(screen.getByText('Регулярность').closest('article')).not.toHaveClass('is-positive')
  })

  it('explains what to do before the AI analysis exists', () => {
    render(<TrainerProgressOverviewContent week={week} />)

    expect(screen.getByText('ИИ-анализ за последний месяц ещё не создан')).toBeVisible()
    expect(screen.getByText('Создать его можно в подробном анализе')).toBeVisible()
    expect(screen.getByText('Появится после создания ИИ-анализа')).toBeVisible()
  })
})

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('TrainerProgressOverviewCard', () => {
  beforeEach(() => {
    repositories.regularity.mockReset()
    repositories.listForTrainer.mockReset()
  })

  it('loads the existing regularity and AI summary sources into one overview', async () => {
    repositories.regularity.mockResolvedValue([week])
    repositories.listForTrainer.mockResolvedValue([summary])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<TrainerProgressOverviewCard clientId="client-1" />, { wrapper: wrapper(queryClient) })

    expect(await screen.findByRole('heading', { name: 'Главное по клиенту' })).toBeVisible()
    expect(await screen.findByText('3 тренировки за неделю')).toBeVisible()
    expect(repositories.regularity).toHaveBeenCalledWith('client-1')
    expect(repositories.listForTrainer).toHaveBeenCalledWith('client-1')
  })

  it('keeps the retry path when one of the source queries fails', async () => {
    const user = userEvent.setup()
    repositories.regularity.mockRejectedValueOnce(new Error('Обзор недоступен')).mockResolvedValueOnce([week])
    repositories.listForTrainer.mockResolvedValue([summary])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<TrainerProgressOverviewCard clientId="client-1" />, { wrapper: wrapper(queryClient) })

    expect(await screen.findByText('Обзор недоступен')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('3 тренировки за неделю')).toBeVisible()
  })
})
