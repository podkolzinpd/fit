import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublishedTrainingSummary, TrainingSummary, Workout } from '../../shared/domain'
import { addDays, localDate, todayInTimeZone } from '../../shared/local-date'
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
  progress: vi.fn(),
  metrics: vi.fn(),
  workouts: vi.fn(),
  personalRecords: vi.fn(),
}))
vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor: { userId: 'viewer-1', role: 'client', timezone: 'Europe/Moscow' } }),
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
vi.mock('../../data/repositories/progress.repository', () => ({
  progressRepository: { list: repositories.progress, listMetrics: repositories.metrics },
}))
vi.mock('../../data/repositories/workouts.repository', () => ({
  workoutsRepository: { list: repositories.workouts, personalRecords: repositories.personalRecords },
}))
vi.mock('../../shared/yandex-metrika', () => ({ trackGoal: vi.fn() }))

afterEach(() => {
  vi.useRealTimers()
})

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
  periodStart: localDate('2026-07-21'),
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
        criteria: [],
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

    expect(screen.getByText(/Добавь ориентир/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Добавить цель' })).toHaveAttribute('href', '/me/goal')
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
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'))
    Object.values(repositories).forEach((mock) => mock.mockReset())
    repositories.goal.mockResolvedValue(null)
    repositories.progress.mockResolvedValue([])
    repositories.metrics.mockResolvedValue([])
    repositories.workouts.mockResolvedValue([])
    repositories.personalRecords.mockResolvedValue([])
    repositories.generate.mockResolvedValue({ generatedAt: publishedSummary.generatedAt, cached: true })
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

  it('offers only retry after a trainer load error and restores a short empty state', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(null)
    repositories.listForTrainer.mockRejectedValueOnce(new Error('Анализ недоступен')).mockResolvedValueOnce([])

    render(<TrainerTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect(await screen.findByRole('alert')).toHaveTextContent('Анализ недоступен')
    expect(screen.queryByRole('button', { name: 'Создать анализ' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Пока нет анализа за этот период')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Создать анализ' })).toBeNull()
    expect(repositories.generate).not.toHaveBeenCalled()
  })

  it('keeps client measurement management available before the first summary exists', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(null)
    repositories.listForClient.mockResolvedValue([])

    render(<ClientTrainingSummaryCard
      clientId="client-1"
      measurementManagement={<button type="button">Добавить замер</button>}
    />, { wrapper: wrapper(queryClient()) })

    expect(await screen.findByRole('heading', { name: 'ИИ-анализ' })).toBeVisible()
    const measurements = screen.getByRole('region', { name: 'Замеры' })
    expect(within(measurements).getByRole('button', { name: 'Добавить замер' })).toBeVisible()
    await waitFor(() => expect(repositories.progress).toHaveBeenCalledWith('client-1'))
    expect(repositories.generate).not.toHaveBeenCalled()
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
    await userEvent.setup().click(await screen.findByText('Карта тела'))

    expect(screen.getByRole('group', { name: 'Атлетичная женщина, вид сзади' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Сзади' })).toBeNull()
    expect(screen.getByLabelText('Верх спины. Результат зоны: +36%')).toBeVisible()
    expect(document.querySelector('.body-progress-zone')).toBeNull()
    const detailsTrigger = screen.getByRole('button', { name: 'Выводы и рекомендации' })
    expect(detailsTrigger.closest('.client-ai-analysis')).not.toBeNull()
    await user.click(detailsTrigger)
    const details = await screen.findByRole('dialog', { name: 'Подробный анализ' })
    expect(within(details).getByRole('heading', { name: 'Результат периода' })).toBeVisible()
    expect(within(details).getByRole('heading', { name: 'Связь с целью' })).toBeVisible()
    expect(within(details).getByRole('heading', { name: 'На что обратить внимание' })).toBeVisible()
    expect(screen.getByRole('button', { name: '1 месяц' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '3 месяца' })).toBeNull()
    expect(screen.queryByRole('button', { name: '6 месяцев' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Добавить цель' })).toBeVisible()
    await user.click(within(details).getByRole('button', { name: 'Закрыть' }))
    await user.click(screen.getByText('Сравнить периоды', { exact: true }))
    expect(screen.getByText('Сравнение появится, когда будут данные за два периода.')).toBeVisible()
    expect(document.body).not.toHaveTextContent(/custom_metric_key|workouts_per_week/)
  })

  it('uses the matching male figure without changing the calculated zones', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-08-10'))
    repositories.listForClient.mockResolvedValue([publishedSummary])

    render(<ClientTrainingSummaryCard clientId="client-1" gender="male" />, { wrapper: wrapper(queryClient()) })
    await userEvent.setup().click(await screen.findByText('Карта тела'))

    expect(await screen.findByRole('group', { name: 'Атлетичный мужчина, вид сзади' })).toBeVisible()
    expect(screen.getByLabelText('Верх спины. Результат зоны: +36%')).toBeVisible()
  })

  it('turns the client summary into a factual period, goal and upcoming-plan story', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'))
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([publishedSummary])
    repositories.goal.mockResolvedValue({
      id: 'goal-1', clientId: 'client-1', title: 'Набрать мышечную массу и укрепить спину',
      targetDate: null, status: 'active', version: 1, stages: [], criteria: [{
        id: 'criterion-1', goalId: 'goal-1', metric: 'weight', operation: 'increase_to',
        targetValue: 85, rangeMin: null, rangeMax: null, unit: 'кг',
        baselineValue: null, baselineRecordedOn: null,
        confirmationStatus: 'confirmed', position: 0, version: 1,
      }],
    })
    repositories.progress.mockResolvedValue([{
      id: 'measurement-1', clientId: 'client-1', createdBy: 'client-1',
      recordedOn: localDate('2026-07-20'), weightKg: 80, customMetrics: [], version: 1,
    }, {
      id: 'measurement-2', clientId: 'client-1', createdBy: 'client-1',
      recordedOn: localDate('2026-08-20'), weightKg: 81.5, customMetrics: [], version: 1,
    }])
    repositories.workouts.mockResolvedValue([{
      id: 'previous', clientId: 'client-1', workoutDate: localDate('2026-07-10'), status: 'done',
      exercises: [{ name: 'Тяга верхнего блока', muscleGroup: 'back', sets: [{ confirmedAt: '2026-07-10T10:00:00Z' }] }],
    }, {
      id: 'current-1', clientId: 'client-1', workoutDate: localDate('2026-08-10'), status: 'done',
      exercises: [{ name: 'Тяга верхнего блока', muscleGroup: 'back', sets: [
        { confirmedAt: '2026-08-10T10:00:00Z' }, { confirmedAt: '2026-08-10T10:01:00Z' },
      ] }],
    }, {
      id: 'current-2', clientId: 'client-1', workoutDate: localDate('2026-08-17'), status: 'done',
      exercises: [{ name: 'Тяга нижнего блока', muscleGroup: 'back', sets: [
        { confirmedAt: '2026-08-17T10:00:00Z' }, { confirmedAt: null },
      ] }],
    }, {
      id: 'next', clientId: 'client-1', workoutDate: localDate('2026-08-28'), startTime: '18:30',
      status: 'planned', stageTitle: 'Спина и плечи', exercises: [{
        name: 'Тяга верхнего блока', muscleGroup: 'back',
        sets: [{ weightKg: 70, reps: 10 }, { weightKg: 70, reps: 10 }, { weightKg: 70, reps: 10 }],
      }],
    }] as Workout[])

    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    const user = userEvent.setup()
    const goal = await screen.findByRole('region', { name: 'Твоя цель' })
    expect(await within(goal).findByRole('heading', { name: 'Набрать мышечную массу и укрепить спину' })).toBeVisible()
    expect(within(goal).getByText('85 кг')).toBeVisible()
    expect(within(goal).getByText('81,5 кг')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Ты приближаешься к цели' })).toBeNull()
    await user.click(within(goal).getByText('Дата замера'))
    expect(within(goal).getByText(/81,5 кг/)).toBeVisible()
    const measurements = screen.getByRole('region', { name: 'Замеры' })
    expect(within(measurements).getByText('Вес (кг)')).toBeVisible()
    expect(within(measurements).getByText('Связан с целью')).not.toBeVisible()
    await user.click(within(measurements).getByText('Подробности замеров'))
    expect(within(measurements).getByText('Связан с целью')).toBeVisible()
    await user.click(screen.getByText('Регулярность тренировок'))
    expect(screen.getByRole('list', { name: 'Завершённые тренировки по неделям' })).toBeVisible()
    await user.click(screen.getByText('Сравнить периоды', { exact: true }))
    const comparison = document.querySelector('.client-progress-comparison')!
    expect(comparison).toHaveTextContent('Выполненные подходы')
    const ordered = ['.client-current-week', '.progress-story-period', '.client-progress-goal-story', '.period-exercise-results', '.client-progress-measurements-story', '.client-body-map-disclosure', '.period-rhythm', '.client-progress-comparison', '.client-ai-analysis']
    const children = Array.from(document.querySelector('.progress-story-card')!.children)
    const positions = ordered.map((selector) => children.findIndex((element) => element.matches(selector)))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(document.querySelector('.client-progress-main-now')).toBeNull()
    expect(document.querySelector('.client-progress-next-step')).toBeNull()
    expect(document.body).not.toHaveTextContent('Прогресс уже заметен, ты на верном пути')
  })

  it('combines the main result with the goal and shows no more than two criteria at first', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([publishedSummary])
    repositories.goal.mockResolvedValue({
      id: 'goal-1', clientId: 'client-1', title: 'Держать вес и тренироваться регулярно',
      targetDate: null, status: 'active', version: 1, stages: [], criteria: [{
        id: 'criterion-1', goalId: 'goal-1', metric: 'weight', operation: 'maintain_range',
        targetValue: null, rangeMin: 58.5, rangeMax: 59.5, unit: 'кг',
        baselineValue: null, baselineRecordedOn: null,
        confirmationStatus: 'confirmed', position: 0, version: 1,
      }, {
        id: 'criterion-2', goalId: 'goal-1', metric: 'workout_regularity', operation: 'increase_to',
        targetValue: 2, rangeMin: null, rangeMax: null, unit: 'трен.',
        baselineValue: null, baselineRecordedOn: null, regularityPeriod: 'week', regularityMode: 'each_period',
        confirmationStatus: 'confirmed', position: 1, version: 1,
      }, {
        id: 'criterion-3', goalId: 'goal-1', metric: 'waist', operation: 'decrease_to',
        targetValue: 80, rangeMin: null, rangeMax: null, unit: 'см',
        baselineValue: null, baselineRecordedOn: null,
        confirmationStatus: 'confirmed', position: 2, version: 1,
      }],
    })
    repositories.progress.mockResolvedValue([{
      id: 'measurement-1', clientId: 'client-1', createdBy: 'client-1',
      recordedOn: localDate('2026-08-15'), weightKg: 59, customMetrics: [], version: 1,
    }])
    repositories.workouts.mockResolvedValue([])

    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    const goal = (await screen.findByRole('heading', { name: 'Держать вес и тренироваться регулярно' })).closest('section')
    expect(goal).not.toBeNull()
    expect(goal).toHaveClass('client-progress-goal-story', 'standalone')
    expect(within(goal!).queryByText('Главное сейчас', { exact: true })).toBeNull()
    expect(within(goal!).getByText('Регулярность тренировок')).toBeVisible()
    expect(within(goal!).getByText('Талия')).not.toBeVisible()
    await user.click(within(goal!).getByText('Все показатели · 1'))
    expect(within(goal!).getByText('Талия')).toBeVisible()
    await user.click(within(goal!).getByText('Все показатели · 1'))
    expect(within(goal!).getByText('Талия')).not.toBeVisible()
  })

  it('hides low-value legacy fallback and keeps the structured detailed-analysis sections', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(null)
    repositories.listForClient.mockResolvedValue([{
      ...publishedSummary,
      metrics: { ...publishedSummary.metrics, progressFacts: [] },
    }])

    const user = userEvent.setup()
    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })
    await userEvent.setup().click(await screen.findByText('Карта тела'))

    await screen.findByText('Здесь появится распределение после тренировки.')
    await user.click(screen.getByRole('button', { name: 'Выводы и рекомендации' }))
    const details = await screen.findByRole('dialog', { name: 'Подробный анализ' })
    expect(within(details).getByText('Все подтверждённые результаты уже показаны в карточках выше.')).toBeVisible()
    expect(within(details).queryByText('Служебный показатель равен 1,3.')).toBeNull()
    expect(document.body).not.toHaveTextContent('custom_metric_key')
  })

  it('automatically replaces the trainer card with a freshly loaded analysis', async () => {
    const updated = {
      ...trainerSummary,
      id: 'summary-2',
      metrics: {
        ...trainerSummary.metrics,
        progressFacts: [{
          ...trainerSummary.metrics.progressFacts[0]!,
          changes: [{ metric: 'max_weight' as const, from: 50, to: 72, changePercent: 44, favorable: true }],
        }],
      },
      generatedAt: '2026-08-20T10:00:00Z',
    }
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForTrainer
      .mockResolvedValueOnce([trainerSummary])
      .mockResolvedValueOnce([updated])
    repositories.generate.mockResolvedValue({ generatedAt: updated.generatedAt, cached: false })

    render(<TrainerTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect((await screen.findAllByText('+44%'))[0]).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Обновить' })).toBeNull()
    expect(screen.queryByText('Анализ обновлён')).toBeNull()
    expect(repositories.generate).toHaveBeenCalledWith(
      'client-1', expect.any(String), expect.any(String), false,
    )
    expect(repositories.listForTrainer).toHaveBeenCalledTimes(2)
  })

  it('keeps role-specific goal actions and publication status while the next step stays hidden', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([publishedSummary])

    const client = render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })
    expect(await screen.findByRole('link', { name: 'Добавить цель' })).toHaveAttribute('href', '/me/goal')
    expect(document.querySelector('.client-progress-next-step')).toBeNull()
    client.unmount()

    repositories.listForTrainer.mockResolvedValue([trainerSummary])
    render(<TrainerTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect(await screen.findByText('Доступно клиенту')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Указать цель' })).toHaveAttribute('href', '/clients/client-1/goal')
    expect(document.querySelector('.client-progress-next-step')).toBeNull()
    expect(screen.getByRole('button', { name: 'Версия для спортсмена' })).toBeVisible()
  })

  it('keeps trainer signals collapsed and never renders the block in the client card', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForTrainer.mockResolvedValue([trainerSummary])

    const trainer = render(<TrainerTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })
    expect(await screen.findByText('Для тренера')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Показать' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/В анализе учтено 6 тренировок/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Показать' }))
    expect(screen.getByText(/В анализе учтено 6 тренировок/)).toBeVisible()
    expect(screen.getByText('Нужно ли обновить анализ перед обсуждением результатов?')).toBeVisible()
    trainer.unmount()

    repositories.listForClient.mockResolvedValue([publishedSummary])
    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })
    expect(await screen.findByText('Твоя цель')).toBeVisible()
    expect(document.querySelector('.client-progress-next-step')).toBeNull()
    expect(screen.queryByText('Для тренера')).toBeNull()
  })

  it('keeps the trainer card after an automatic refresh error and retries on demand', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForTrainer.mockResolvedValue([trainerSummary])
    repositories.generate
      .mockRejectedValueOnce(new Error('Не получилось обновить анализ'))
      .mockResolvedValueOnce({ generatedAt: trainerSummary.generatedAt, cached: true })

    render(<TrainerTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect((await screen.findAllByText('+36%'))[0]).toBeVisible()
    const refreshError = await screen.findByRole('alert')
    expect(refreshError).toHaveTextContent('Не получилось обновить анализ')
    await user.click(within(refreshError).getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(repositories.generate).toHaveBeenCalledTimes(2)
    expect(screen.getAllByText('+36%')[0]).toBeVisible()
  })

  it('shows the trainer body map without exposing the client figure choice', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForTrainer.mockResolvedValue([trainerSummary])
    repositories.workouts.mockResolvedValue([{
      id: 'workout-1', clientId: 'client-1', workoutDate: localDate('2026-08-18'), status: 'done',
      exercises: [{ name: 'Тяга верхнего блока', muscleGroup: 'back', sets: [
        { confirmedAt: '2026-08-18T10:00:00Z' }, { confirmedAt: '2026-08-18T10:01:00Z' },
      ] }, { name: 'Жим лёжа', muscleGroup: 'chest', sets: [
        { confirmedAt: '2026-08-18T10:02:00Z' },
      ] }],
    } as Workout])

    render(<TrainerTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect(await screen.findByRole('group', { name: 'Анатомическая схема мышц, вид сзади' })).toBeVisible()
    expect(screen.getByLabelText('Верх спины. Результат зоны: +36%')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Нагрузка' }))
    expect(await screen.findByLabelText('Верх спины. Доля подходов: 67%')).toBeVisible()
    const sideSwitch = screen.getByLabelText('Сторона тела')
    expect(within(sideSwitch).getByRole('button', { name: 'Спереди' })).toBeVisible()
    expect(within(sideSwitch).getByRole('button', { name: 'Сзади' })).toHaveAttribute('aria-pressed', 'true')
    expect(repositories.workouts).toHaveBeenCalledWith(
      localDate('2026-06-20'),
      addDays(todayInTimeZone('Europe/Moscow'), 45),
      'client-1',
    )
  })

  it('keeps trainer progress visible and retries a failed body load request', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForTrainer.mockResolvedValue([trainerSummary])
    repositories.workouts
      .mockRejectedValueOnce(new Error('История временно недоступна'))
      .mockResolvedValueOnce([])

    render(<TrainerTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect(await screen.findByLabelText('Верх спины. Результат зоны: +36%')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Нагрузка' }))
    expect((await screen.findByText('Не удалось загрузить карту.')).closest('[role="alert"]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Попробовать ещё раз' }))
    expect(await screen.findByText('Здесь появится распределение после тренировки.')).toBeVisible()
    expect(repositories.workouts).toHaveBeenCalledTimes(2)
  })

  it('shows an explicit trainer body-load state when progress facts are not available yet', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForTrainer.mockResolvedValue([{
      ...trainerSummary,
      metrics: { ...trainerSummary.metrics, progressFacts: [] },
    }])
    repositories.workouts.mockReturnValue(new Promise(() => undefined))

    render(<TrainerTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect(await screen.findByText('Загружаем карту…')).toHaveAttribute('role', 'status')
    expect(screen.getByText('Карта тела')).toBeVisible()
  })

  it('keeps the current client analysis and exposes a readable automatic refresh error', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([publishedSummary])
    repositories.generate.mockRejectedValue(new Error('Не получилось создать анализ. Попробуйте ещё раз через минуту.'))

    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })
    await userEvent.setup().click(await screen.findByText('Карта тела'))

    expect(await screen.findByLabelText('Верх спины. Результат зоны: +36%')).toBeVisible()
    const refreshError = await screen.findByRole('alert')
    expect(refreshError).toHaveTextContent('Попробуйте ещё раз через минуту')
    expect(within(refreshError).getByRole('button', { name: 'Повторить' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Обновить' })).toBeNull()
    expect(repositories.generate).toHaveBeenCalledWith(
      'client-1', expect.any(String), expect.any(String), false,
    )
    expect(screen.getByLabelText('Верх спины. Результат зоны: +36%')).toBeVisible()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Выводы и рекомендации' }))
    const dialog = screen.getByRole('dialog', { name: 'Подробный анализ' })
    expect(within(dialog).getByRole('heading', { name: 'Результат периода' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Текущая неделя' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Результаты и рекорды' })).toBeVisible()
  })

  it('does not turn a legacy hasPr flag into an unsupported record', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([publishedSummary])
    repositories.workouts.mockResolvedValue([{
      id: 'record-workout', clientId: 'client-1', workoutDate: localDate('2026-08-18'),
      completedAt: '2026-08-18T10:00:00Z', status: 'done', hasPr: true, exercises: [],
      clientName: 'Тест', startTime: null, endTime: null, startedAt: null, notes: null, stageId: null, stageTitle: null, version: 1,
    } as Workout])
    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })
    expect(await screen.findByText('За этот период пока нет результатов.')).toBeVisible()
    expect(screen.queryByText(/Новый личный рекорд/)).toBeNull()
    expect(repositories.personalRecords).not.toHaveBeenCalled()
  })

  it('keeps the first-record action and goal visible without a saved AI analysis', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(null)
    repositories.listForClient.mockResolvedValue([])
    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })
    expect(await screen.findByText('Цель пока не указана')).toBeVisible()
    expect(screen.getByText('За этот период пока нет результатов.')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Текущая неделя' })).toHaveTextContent('Пока нет тренировок')
    expect(document.querySelector('.client-progress-next-step')).toBeNull()
  })

  it('lets the client switch to load and retry a failed workout history request', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([publishedSummary])
    repositories.workouts
      .mockRejectedValueOnce(new Error('История временно недоступна'))
      .mockResolvedValueOnce([])

    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })
    await userEvent.setup().click(await screen.findByText('Карта тела'))

    const disclosure = document.querySelector<HTMLElement>('.client-body-map-disclosure')!
    expect(within(disclosure).getByRole('alert')).toHaveTextContent('Не удалось загрузить тренировки.')
    await user.click(within(disclosure).getByRole('button', { name: 'Повторить' }))
    await user.click(await screen.findByRole('button', { name: 'Нагрузка' }))
    expect(await screen.findByText('Здесь появится распределение после тренировки.')).toBeVisible()
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
    await userEvent.setup().click(await screen.findByText('Карта тела'))

    expect(await screen.findByRole('group', { name: 'Анатомическая схема мышц, вид сзади' })).toBeVisible()
    expect(screen.getByLabelText('Верх спины. Результат зоны: +36%')).toHaveAttribute('aria-pressed', 'true')
    await user.click(await screen.findByRole('button', { name: 'Нагрузка' }))
    expect(await screen.findByLabelText('Верх спины. Доля подходов: 67%')).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Спереди' }))
    expect(screen.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible()
    await user.click(screen.getByLabelText('Грудь. Доля подходов: 33%'))
    const loadDetail = document.querySelector<HTMLElement>('.body-progress-detail')
    expect(loadDetail).toHaveAttribute('data-copy-source', 'deterministic')
    expect(loadDetail).toHaveTextContent('На зону «Грудь» приходится 33% подходов на карте.')
    expect(screen.queryByText('Жим лёжа: 1 подход')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Показать 1 упражнение' }))
    const loadDialog = await screen.findByRole('dialog', { name: 'Грудь' })
    expect(loadDialog).toHaveTextContent('Жим лёжа: 1 подход')
    await user.click(within(loadDialog).getByRole('button', { name: 'Закрыть' }))
    await user.click(screen.getByRole('button', { name: 'Прогресс' }))
    expect(screen.getByLabelText('Верх спины. Результат зоны: +36%')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: 'Анатомическая схема мышц, вид сзади' })).toBeVisible()
  })

  it('keeps the zone panel compact and opens the remaining exercise details on demand', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([{
      ...publishedSummary,
      metrics: {
        ...publishedSummary.metrics,
        progressFacts: [publishedSummary.metrics.progressFacts[0]!, {
          exerciseName: 'Тяга нижнего блока', kind: 'strength', sessionCount: 3,
          changes: [{ metric: 'max_weight', from: 60, to: 70, changePercent: 17, favorable: true }],
        }, {
          exerciseName: 'Пуловер прямыми руками в блоке', kind: 'strength', sessionCount: 3,
          changes: [{ metric: 'volume', from: 800, to: 920, changePercent: 15, favorable: true }],
        }],
      },
    }])

    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })
    await userEvent.setup().click(await screen.findByText('Карта тела'))

    await screen.findByLabelText('Верх спины. Результат зоны: +36%')
    const map = document.querySelector<HTMLElement>('.body-progress-map')
    expect(map).not.toBeNull()
    if (!map) return
    expect(within(map).queryByText('Изменения по подтверждённым результатам упражнений')).toBeNull()
    expect(within(map).queryByText('Лучший результат зоны')).toBeNull()
    expect(within(map).getByText('Результат вырос на 36%.')).toBeVisible()
    expect(within(map).queryByText(/Тяга нижнего блока/)).toBeNull()
    expect(within(map).queryByText(/Пуловер прямыми руками/)).toBeNull()
    await user.click(within(map).getByRole('button', { name: 'Показать 3 упражнения' }))
    const dialog = await screen.findByRole('dialog', { name: 'Верх спины' })
    expect(dialog).toHaveTextContent(longExerciseName)
    expect(dialog).toHaveTextContent('Тяга нижнего блока')
    expect(dialog).toHaveTextContent('Пуловер прямыми руками в блоке')
  })
  it('keeps facts and measurement controls available while AI loading fails', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockRejectedValue(new Error('Анализ временно недоступен'))
    repositories.progress.mockResolvedValue([{ id: 'm', clientId: 'client-1', recordedOn: localDate('2026-08-20'), weightKg: 80, customMetrics: [], version: 1 }])
    render(<ClientTrainingSummaryCard clientId="client-1" measurementManagement={<button>Добавить замер</button>} />, { wrapper: wrapper(queryClient()) })
    expect(await screen.findByText('80 кг')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Добавить замер' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Текущая неделя' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Результаты и рекорды' })).toBeVisible()
    expect(screen.getByRole('button', { name: '1 месяц' })).toBeVisible()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Выводы и рекомендации' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Анализ временно недоступен')
  })

  it('requests a new analysis explicitly and preserves saved text after a force error', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([publishedSummary])
    repositories.generate.mockImplementation((_client, _start, _end, force) => force ? Promise.reject(new Error('Сервис занят')) : Promise.resolve({ cached: true }))
    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Выводы и рекомендации' }))
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Обновить анализ' })).toBeEnabled())
    await user.click(within(dialog).getByRole('button', { name: 'Обновить анализ' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Сервис занят')
    expect(within(dialog).getByText(/Период анализа: 21 июля 2026 г. — 20 августа 2026 г./)).toBeVisible()
    expect(within(dialog).getByRole('heading', { name: 'Результат периода' })).toBeVisible()
    expect(repositories.generate).toHaveBeenLastCalledWith('client-1', '2026-07-21', '2026-08-20', true)
  })

  it('keeps an in-flight forced month analysis scoped when the user switches to three months', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-01-01'))
    let summaries = [publishedSummary]
    repositories.listForClient.mockImplementation(() => Promise.resolve(summaries))
    let resolveForce!: () => void
    repositories.generate.mockImplementation((_client, _start, _end, force) => force ? new Promise<void>((resolve) => { resolveForce = resolve }) : Promise.resolve({ cached: true }))
    const user = userEvent.setup()
    const cache = queryClient()
    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(cache) })
    await user.click(await screen.findByRole('button', { name: 'Выводы и рекомендации' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Обновить анализ' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Обновить анализ' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Закрыть' }))
    await user.click(screen.getByRole('button', { name: '3 месяца' }))
    expect(screen.getByRole('button', { name: '3 месяца' })).toHaveAttribute('aria-pressed', 'true')
    summaries = [{ ...publishedSummary, id: 'new-month', generatedAt: '2026-08-20T12:01:00Z' }]
    await act(async () => { resolveForce(); await Promise.resolve() })
    expect(screen.getByRole('button', { name: '3 месяца' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('.progress-period-dates')).toHaveTextContent('21 мая 2026 г. — 20 августа 2026 г.')
    expect(document.querySelector('.client-ai-analysis')).not.toHaveTextContent('Период анализа: 21 июля')
    await user.click(screen.getByRole('button', { name: '1 месяц' }))
    expect(document.querySelector('.client-ai-analysis')).toHaveTextContent('Обновлён 20.08.2026')
    await waitFor(() => expect(cache.getQueryData<PublishedTrainingSummary[]>(['training-summaries', 'client', 'client-1'])?.[0]?.id).toBe('new-month'))
  })

  it('shows the selected map dates instead of dates borrowed from an old AI summary', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-01-01'))
    repositories.listForClient.mockResolvedValue([{ ...publishedSummary, periodStart: localDate('2026-06-21'), periodEnd: localDate('2026-07-20') }])
    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })
    await userEvent.setup().click(await screen.findByText('Карта тела'))
    const map = document.querySelector('.client-body-map-disclosure')!
    expect(map).toHaveTextContent('21 июля 2026 г. — 20 августа 2026 г.')
    expect(map).toHaveTextContent('Для изменений по мышцам обнови анализ за этот период')
    expect(within(map as HTMLElement).getByRole('button', { name: 'Нагрузка' })).toHaveAttribute('aria-pressed', 'true')
    expect(map).not.toHaveTextContent('+36%')
    expect(document.querySelector('.client-ai-analysis')).toHaveTextContent('21 июня 2026 г. — 20 июля 2026 г.')
  })

  it('marks new workouts only when a completed workout in the selected period is newer than the analysis', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-01-01'))
    repositories.listForClient.mockResolvedValue([publishedSummary])
    repositories.workouts.mockResolvedValue([{
      id: 'new', clientId: 'client-1', workoutDate: localDate('2026-08-20'), status: 'done',
      completedAt: '2026-08-20T23:59:00Z', exercises: [], clientName: 'Тест',
      startTime: null, endTime: null, startedAt: null, notes: null, stageId: null, stageTitle: null, version: 1,
    }])
    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })
    expect(await screen.findByText('Есть новые тренировки')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Посмотреть анализ' })).toHaveAttribute('href', '#ai-analysis')
    await userEvent.setup().click(screen.getByRole('button', { name: '3 месяца' }))
    expect(screen.queryByText('Есть новые тренировки')).toBeNull()
  })

})
