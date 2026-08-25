import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublishedTrainingSummary, TrainingSummary, Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { ClientProgressGoalSection } from './ClientProgressGoalSection'
import { ClientTrainingSummaryCard, TrainerTrainingSummaryCard } from './TrainingSummaryCard'

const repositories = vi.hoisted(() => ({
  firstCompletedWorkoutDate: vi.fn(),
  listForTrainer: vi.fn(),
  listForClient: vi.fn(),
  generate: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  goal: vi.fn(),
  workouts: vi.fn(),
}))
vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor: { timezone: 'Europe/Moscow' } }),
}))
vi.mock('../../data/repositories/training-summaries.repository', () => ({
  trainingSummariesRepository: {
    firstCompletedWorkoutDate: repositories.firstCompletedWorkoutDate,
    listForTrainer: repositories.listForTrainer,
    listForClient: repositories.listForClient,
    generate: repositories.generate,
    publish: repositories.publish,
    unpublish: repositories.unpublish,
  },
}))
vi.mock('../../data/repositories/goals.repository', () => ({
  goalsRepository: { get: repositories.goal },
}))
vi.mock('../../data/repositories/workouts.repository', () => ({
  workoutsRepository: { list: repositories.workouts },
}))
vi.mock('../../shared/yandex-metrika', () => ({ trackGoal: vi.fn() }))

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></MemoryRouter>
  }
}

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

const longExerciseName = 'Тяга верхнего блока обратным узким хватом в кроссовере с дополнительной рукоятью'
const publishedSummary: PublishedTrainingSummary = {
  id: 'published-1',
  sourceSummaryId: 'summary-1',
  clientId: 'client-1',
  periodStart: localDate('2026-07-20'),
  periodEnd: localDate('2026-08-20'),
  summary: {
    headline: 'Рабочий вес вырос на 16,67%.',
    achievements: ['Служебный custom_metric_key равен 1.25.'],
    consistency: 'Средняя частота — 1,13 в неделю.',
    encouragement: 'Продолжай в том же ритме.',
  },
  metrics: {
    completedWorkouts: 6,
    workoutsPerWeek: 1.13,
    activeWeeks: 3,
    longestGapDays: 5,
    progressFacts: [{
      exerciseName: longExerciseName,
      kind: 'strength',
      sessionCount: 3,
      changes: [{ metric: 'max_weight', from: 50, to: 68, changePercent: 36, favorable: true }],
    }],
  },
  generatedAt: '2026-08-20T08:00:00Z',
  publishedAt: '2026-08-20T08:05:00Z',
}

const trainerSummary: TrainingSummary = {
  id: 'summary-1',
  clientId: 'client-1',
  periodStart: publishedSummary.periodStart,
  periodEnd: publishedSummary.periodEnd,
  trainer: {
    headline: 'В жиме лёжа рабочий вес вырос на 10%.',
    progress: ['В жиме лёжа рабочий вес вырос на 10%.'],
    consistency: 'Выполнено 6 тренировок.',
    attention: [],
  },
  client: publishedSummary.summary,
  metrics: publishedSummary.metrics,
  generatedAt: publishedSummary.generatedAt,
  version: 1,
  published: true,
}

describe('ClientProgressGoalSection', () => {
  it('shows the active structured goal, stage and LLM interpretation', () => {
    render(<MemoryRouter><ClientProgressGoalSection
      goal={{
        id: 'goal-1', clientId: 'client-1', title: 'Набор мышечной массы',
        targetDate: localDate('2026-12-01'), status: 'active', version: 1,
        stages: [{
          id: 'stage-1', goalId: 'goal-1', title: 'Силовая база',
          startsOn: localDate('2026-08-01'), endsOn: localDate('2026-09-30'),
          position: 0, version: 1,
        }],
      }}
      today={localDate('2026-08-16')}
      loading={false}
      error={null}
      alignment="Рабочий вес вырос на 16,67% и поддерживает цель."
      onRetry={vi.fn()}
    /></MemoryRouter>)

    expect(screen.getByText('Набор мышечной массы')).toBeInTheDocument()
    expect(screen.getByText('Текущий этап: Силовая база')).toBeInTheDocument()
    expect(screen.getByText('Рабочий вес вырос на 17% и поддерживает цель.')).toBeInTheDocument()
  })

  it('invites the client to add a goal without blocking progress', () => {
    render(<MemoryRouter><ClientProgressGoalSection
      goal={null}
      profileGoal={null}
      today={localDate('2026-08-16')}
      loading={false}
      error={null}
      onRetry={vi.fn()}
    /></MemoryRouter>)

    expect(screen.getByText(/Добавь цель, чтобы ИИ оценивал прогресс/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Добавить цель' })).toHaveAttribute('href', '/me/edit')
  })

  it('keeps explicit loading and retry states for the optional goal', async () => {
    const retry = vi.fn()
    const { rerender } = render(<MemoryRouter><ClientProgressGoalSection
      goal={undefined} today={localDate('2026-08-20')} loading error={null} onRetry={retry}
    /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent('Проверяем цель')
    expect(screen.queryByRole('link', { name: 'Добавить цель' })).toBeNull()

    rerender(<MemoryRouter><ClientProgressGoalSection
      goal={undefined} today={localDate('2026-08-20')} loading={false}
      error={new Error('Цель недоступна')} onRetry={retry}
    /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить цель')
    expect(retry).toHaveBeenCalledOnce()
  })
})

describe('Training summary card states', () => {
  beforeEach(() => {
    Object.values(repositories).forEach((mock) => mock.mockReset())
    repositories.goal.mockResolvedValue(null)
    repositories.workouts.mockResolvedValue([])
  })

  it('does not expose period or generation actions while trainer data is loading', () => {
    repositories.firstCompletedWorkoutDate.mockReturnValue(new Promise(() => undefined))
    repositories.listForTrainer.mockReturnValue(new Promise(() => undefined))

    render(<TrainerTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect(screen.getByLabelText('ИИ-анализ тренировок')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Загрузка')
    expect(screen.queryByRole('button', { name: '1 месяц' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Создать анализ' })).toBeNull()
  })

  it('offers only retry after a trainer load error and restores the empty action after retry', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(null)
    repositories.listForTrainer.mockRejectedValueOnce(new Error('Анализ недоступен')).mockResolvedValueOnce([])

    render(<TrainerTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect(await screen.findByRole('alert')).toHaveTextContent('Анализ недоступен')
    expect(screen.queryByRole('button', { name: 'Создать анализ' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Анализ за этот период ещё не создан')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Создать анализ' })).toBeVisible()
  })

  it('accepts a short history, a long exercise name and no client goal without leaking technical text', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-08-10'))
    repositories.listForClient.mockResolvedValue([publishedSummary, {
      ...publishedSummary,
      id: 'legacy-6m',
      sourceSummaryId: 'legacy-summary-6m',
      periodStart: localDate('2026-02-21'),
    }])

    render(<ClientTrainingSummaryCard clientId="client-1" gender="female" />, { wrapper: wrapper(queryClient()) })

    expect((await screen.findAllByText((text) => text.includes(longExerciseName)))[0]).toBeVisible()
    expect(screen.getByAltText('Атлетичная женщина, вид спереди и сзади')).toBeVisible()
    expect(screen.getByLabelText('Верх спины: +36%')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Подробный анализ' }))
    expect((await screen.findAllByText(/Рабочий вес: 50 → 68 кг/))[0]).toBeVisible()
    expect(screen.getByText('3')).toBeVisible()
    expect(screen.getByText('недели с тренировками')).toBeVisible()
    expect(screen.queryByText('1,1 в неделю')).toBeNull()
    expect(screen.getByRole('button', { name: '1 месяц' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '3 месяца' })).toBeNull()
    expect(screen.queryByRole('button', { name: '6 месяцев' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Добавить цель' })).toBeVisible()
    expect(document.body).not.toHaveTextContent(/custom_metric_key|workouts_per_week/)
  })

  it('keeps the readable legacy fallback when structured progress facts are absent', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(null)
    repositories.listForClient.mockResolvedValue([{
      ...publishedSummary,
      metrics: { ...publishedSummary.metrics, progressFacts: [] },
    }])

    const user = userEvent.setup()
    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    await screen.findByText('После завершённой тренировки покажем, на какие зоны пришлась работа.')
    await user.click(screen.getByRole('button', { name: 'Подробный анализ' }))
    expect(await screen.findByText('Служебный показатель равен 1,3.')).toBeVisible()
    expect(document.body).not.toHaveTextContent('custom_metric_key')
  })

  it('replaces the trainer card with the freshly loaded analysis and confirms success', async () => {
    const user = userEvent.setup()
    const updated = {
      ...trainerSummary,
      id: 'summary-2',
      trainer: { ...trainerSummary.trainer, headline: 'В жиме лёжа рабочий вес вырос на 20%.' },
      generatedAt: '2026-08-20T10:00:00Z',
    }
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForTrainer
      .mockResolvedValueOnce([trainerSummary])
      .mockResolvedValueOnce([updated])
    repositories.generate.mockResolvedValue({ generatedAt: updated.generatedAt, cached: false })

    render(<TrainerTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect(await screen.findByText(trainerSummary.trainer.headline)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(await screen.findByText(updated.trainer.headline)).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Анализ обновлён')
    expect(repositories.listForTrainer).toHaveBeenCalledTimes(2)
  })

  it('keeps the current client analysis and exposes a readable refresh error', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([publishedSummary])
    repositories.generate.mockRejectedValue(new Error('YandexGPT временно недоступен. Попробуйте ещё раз через минуту.'))

    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect(await screen.findByLabelText('Верх спины: +36%')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('YandexGPT временно недоступен')
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeEnabled()
    expect(screen.getByLabelText('Верх спины: +36%')).toBeVisible()
  })

  it('lets the client switch to load and retry a failed workout history request', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([publishedSummary])
    repositories.workouts
      .mockRejectedValueOnce(new Error('История временно недоступна'))
      .mockResolvedValueOnce([])

    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    await user.click(await screen.findByRole('button', { name: 'Работа' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось собрать работу')
    await user.click(screen.getByRole('button', { name: 'Попробовать ещё раз' }))
    expect(await screen.findByText('После завершённой тренировки покажем, на какие зоны пришлась работа.')).toBeVisible()
    expect(repositories.workouts).toHaveBeenCalledTimes(2)
  })

  it('lets the client inspect the load behind a highlighted body zone', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([publishedSummary])
    repositories.workouts.mockResolvedValue([{
      id: 'workout-1', clientId: 'client-1', workoutDate: localDate('2026-08-18'), status: 'done',
      exercises: [{ name: 'Тяга верхнего блока', muscleGroup: 'back', sets: [
        { confirmedAt: '2026-08-18T10:00:00Z' }, { confirmedAt: '2026-08-18T10:01:00Z' },
      ] }, { name: 'Жим лёжа', muscleGroup: 'chest', sets: [
        { confirmedAt: '2026-08-18T10:02:00Z' },
      ] }],
    } as Workout])

    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    await user.click(await screen.findByRole('button', { name: 'Работа' }))
    expect(await screen.findByLabelText('Верх спины: 67%')).toBeVisible()
    await user.click(screen.getByLabelText('Грудь: 33%'))
    expect(screen.getByText('Жим лёжа: 1 подход')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Прогресс' }))
    expect(screen.getByLabelText('Верх спины: +36%')).toBeVisible()
  })
})
