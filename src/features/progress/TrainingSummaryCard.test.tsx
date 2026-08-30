import { render, screen, within } from '@testing-library/react'
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
    Object.values(repositories).forEach((mock) => mock.mockReset())
    repositories.goal.mockResolvedValue(null)
    repositories.progress.mockResolvedValue([])
    repositories.metrics.mockResolvedValue([])
    repositories.workouts.mockResolvedValue([])
    repositories.personalRecords.mockResolvedValue([])
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
    expect(screen.getByRole('group', { name: 'Атлетичная женщина, вид сзади' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Сзади' })).toBeNull()
    expect(screen.getByLabelText('Верх спины. Лучший результат зоны: +36%')).toBeVisible()
    expect(document.querySelector('.body-progress-zone')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Подробный анализ' }))
    expect((await screen.findAllByText(/Рабочий вес: 50 → 68 кг/))[0]).toBeVisible()
    expect(screen.getByText('6')).toBeVisible()
    expect(screen.getByText('3/5')).toBeVisible()
    expect(screen.getByText('недель с тренировками')).toBeVisible()
    expect(screen.queryByText('1,1 в неделю')).toBeNull()
    expect(screen.getByRole('button', { name: '1 месяц' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '3 месяца' })).toBeNull()
    expect(screen.queryByRole('button', { name: '6 месяцев' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Добавить цель' })).toBeVisible()
    expect(document.body).not.toHaveTextContent(/custom_metric_key|workouts_per_week/)
  })

  it('uses the matching male figure without changing the calculated zones', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-08-10'))
    repositories.listForClient.mockResolvedValue([publishedSummary])

    render(<ClientTrainingSummaryCard clientId="client-1" gender="male" />, { wrapper: wrapper(queryClient()) })

    expect(await screen.findByRole('group', { name: 'Атлетичный мужчина, вид сзади' })).toBeVisible()
    expect(screen.getByLabelText('Верх спины. Лучший результат зоны: +36%')).toBeVisible()
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

    const comparison = (await screen.findByRole('heading', { name: 'Сравнение периодов' })).closest('section')
    expect(comparison).not.toBeNull()
    expect(await within(comparison!).findAllByText('+1')).toHaveLength(2)
    expect(within(comparison!).getByText('Выполненные подходы')).toBeVisible()
    expect(within(comparison!).getByText('+2')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Набрать мышечную массу и укрепить спину' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Изменить цель' })).toHaveAttribute('href', '/me/goal')
    expect(screen.getByText('Движение к ориентиру')).toBeVisible()
    expect(screen.getByText('увеличить до 85 кг')).toBeVisible()
    expect(screen.getAllByText('81,5 кг')[0]).toBeVisible()
    expect(screen.getByRole('link', { name: 'Смотреть значения и график' })).toHaveAttribute('href', '#progress-measurements')
    expect(screen.getByText(/пока не достиг заданного ориентира/)).toBeVisible()
    const measurements = screen.getByRole('heading', { name: 'Тренд по значениям' }).closest('section')
    expect(measurements).not.toBeNull()
    expect(within(measurements!).getByText('Вес (кг)')).toBeVisible()
    expect(within(measurements!).getByText('80 кг → 81,5 кг')).toBeVisible()
    expect(within(measurements!).getByText('Связан с целью')).toBeVisible()
    expect(within(measurements!).getByText(/2 точки · достаточно для динамики/)).toBeVisible()
    const comparisonIndex = Array.from(document.querySelectorAll('.progress-story-card > *')).indexOf(comparison!)
    const measurementIndex = Array.from(document.querySelectorAll('.progress-story-card > *')).indexOf(measurements!)
    expect(measurementIndex).toBeGreaterThan(comparisonIndex)
    const regularity = screen.getByRole('heading', { name: 'Тренировочный ритм' }).closest('section')
    expect(regularity).not.toBeNull()
    expect(within(regularity!).getByText('2 тренировки')).toBeVisible()
    expect(within(regularity!).getByRole('list', { name: 'Завершённые тренировки по неделям' })).toBeVisible()
    const regularityIndex = Array.from(document.querySelectorAll('.progress-story-card > *')).indexOf(regularity!)
    const results = screen.getByLabelText('Результаты периода')
    const resultsIndex = Array.from(document.querySelectorAll('.progress-story-card > *')).indexOf(results)
    expect(regularityIndex).toBeGreaterThan(measurementIndex)
    expect(resultsIndex).toBeGreaterThan(regularityIndex)
    expect(document.querySelector('.goal-foundation-facts')).toBeNull()
    expect(document.querySelector('.goal-progress-details')).toBeNull()
    expect(screen.getByRole('heading', { name: '28 августа 2026 г. · 18:30' })).toBeVisible()
    expect(screen.getByText('Спина и плечи')).toBeVisible()
    expect(screen.getByText('3 × 70 кг × 10 повт.')).toBeVisible()
    expect(document.body).not.toHaveTextContent('Прогресс уже заметен, ты на верном пути')
  })

  it('keeps a composite goal compact and reveals additional criteria on demand', async () => {
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
    expect(goal!.querySelectorAll('.goal-criterion-progress-row')).toHaveLength(1)
    expect(within(goal!).queryByText('Регулярность тренировок')).toBeNull()

    await user.click(within(goal!).getByRole('button', { name: 'Показать все критерии · 2' }))
    expect(goal!.querySelectorAll('.goal-criterion-progress-row')).toHaveLength(2)
    expect(within(goal!).getByText('Регулярность тренировок')).toBeVisible()

    await user.click(within(goal!).getByRole('button', { name: 'Показать только основной критерий' }))
    expect(goal!.querySelectorAll('.goal-criterion-progress-row')).toHaveLength(1)
  })

  it('keeps the readable legacy fallback when structured progress facts are absent', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(null)
    repositories.listForClient.mockResolvedValue([{
      ...publishedSummary,
      metrics: { ...publishedSummary.metrics, progressFacts: [] },
    }])

    const user = userEvent.setup()
    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    await screen.findByText('После завершённой тренировки покажем распределение нагрузки по зонам.')
    await user.click(screen.getByRole('button', { name: 'Подробный анализ' }))
    expect(await screen.findByText('Служебный показатель равен 1,3.')).toBeVisible()
    expect(document.body).not.toHaveTextContent('custom_metric_key')
  })

  it('replaces the trainer card with the freshly loaded analysis and confirms success', async () => {
    const user = userEvent.setup()
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

    expect((await screen.findAllByText('+36%'))[0]).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Обновить' }))
    expect((await screen.findAllByText('+44%'))[0]).toBeVisible()
    expect(screen.getByText('Анализ обновлён')).toHaveAttribute('role', 'status')
    expect(repositories.listForTrainer).toHaveBeenCalledTimes(2)
  })

  it('keeps role-specific planning actions and the trainer publication status explicit', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([publishedSummary])

    const client = render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })
    expect(await screen.findByRole('link', { name: 'Запланировать тренировку' })).toHaveAttribute('href', '/workouts/new')
    client.unmount()

    repositories.listForTrainer.mockResolvedValue([trainerSummary])
    render(<TrainerTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect(await screen.findByText('Доступно клиенту')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Запланировать тренировку' })).toHaveAttribute('href', '/workouts/new?client=client-1')
    expect(screen.getByRole('button', { name: 'Версия для спортсмена' })).toBeVisible()
  })

  it('keeps the trainer card after a refresh error and confirms a successful retry', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForTrainer.mockResolvedValue([trainerSummary])
    repositories.generate
      .mockRejectedValueOnce(new Error('Не получилось обновить анализ'))
      .mockResolvedValueOnce({ generatedAt: trainerSummary.generatedAt, cached: true })

    render(<TrainerTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect((await screen.findAllByText('+36%'))[0]).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не получилось обновить анализ')
    await user.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(await screen.findByText('Анализ уже актуален')).toHaveAttribute('role', 'status')
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
    expect(screen.getByLabelText('Верх спины. Лучший результат зоны: +36%')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Нагрузка' }))
    expect(await screen.findByLabelText('Верх спины. Доля всех выполненных подходов: 67%')).toBeVisible()
    expect(repositories.workouts).toHaveBeenCalledWith(
      localDate('2026-06-18'),
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

    expect(await screen.findByLabelText('Верх спины. Лучший результат зоны: +36%')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Нагрузка' }))
    expect((await screen.findByText('Не удалось собрать нагрузку по тренировкам.')).closest('[role="alert"]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Попробовать ещё раз' }))
    expect(await screen.findByText('После завершённой тренировки покажем распределение нагрузки по зонам.')).toBeVisible()
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

    expect(await screen.findByText('Собираем нагрузку по тренировкам…')).toHaveAttribute('role', 'status')
    expect(screen.getByText('Карта тела')).toBeVisible()
  })

  it('keeps the current client analysis and exposes a readable refresh error', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([publishedSummary])
    repositories.generate.mockRejectedValue(new Error('Не получилось создать анализ. Попробуйте ещё раз через минуту.'))

    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect(await screen.findByLabelText('Верх спины. Лучший результат зоны: +36%')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Попробуйте ещё раз через минуту')
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeEnabled()
    expect(screen.getByLabelText('Верх спины. Лучший результат зоны: +36%')).toBeVisible()

    const mainNow = screen.getByRole('heading', { name: `Заметное изменение · ${longExerciseName}` }).closest('section')
    const goalStory = document.querySelector('.client-progress-goal-story')
    const bodyMap = document.querySelector('.body-progress-map')
    const periodSummary = document.querySelector('.progress-story-summary')
    expect(mainNow).not.toBeNull()
    expect(goalStory).not.toBeNull()
    expect(bodyMap).not.toBeNull()
    expect(periodSummary).not.toBeNull()
    expect(mainNow).toHaveAttribute('data-fact-id', expect.stringContaining('exercise:'))
    expect(mainNow).toHaveAttribute('data-copy-source', 'deterministic')
    expect(mainNow!.compareDocumentPosition(goalStory!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(goalStory!.compareDocumentPosition(bodyMap!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(bodyMap!.compareDocumentPosition(periodSummary!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows a verified personal record as the main fact and loads it only for a marked workout', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([publishedSummary])
    repositories.workouts.mockResolvedValue([{
      id: 'record-workout', clientId: 'client-1', clientName: 'Антон', workoutDate: localDate('2026-08-18'),
      startTime: null, endTime: null, startedAt: null, completedAt: '2026-08-18T10:00:00Z', status: 'done',
      notes: null, stageId: null, stageTitle: null, version: 1, hasPr: true, exercises: [],
    } as Workout])
    repositories.personalRecords.mockResolvedValue([{
      exerciseRef: 'bench-press', exerciseName: 'Жим лёжа', inputKind: 'strength', metric: 'weight_reps',
      primaryValue: 75, weightKg: 75, reps: 8,
    }])

    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect(await screen.findByRole('heading', { name: 'Новый личный рекорд · Жим лёжа' })).toBeVisible()
    expect(screen.getByText('75 кг × 8 повт. · 18.08.2026')).toBeVisible()
    expect(repositories.personalRecords).toHaveBeenCalledOnce()
    expect(repositories.personalRecords).toHaveBeenCalledWith('record-workout')
  })

  it('does not repeat a missing plan as both the main fact and the next-step card', async () => {
    repositories.firstCompletedWorkoutDate.mockResolvedValue(null)
    repositories.listForClient.mockResolvedValue([{
      ...publishedSummary,
      metrics: { ...publishedSummary.metrics, completedWorkouts: 0, activeWeeks: 0, progressFacts: [] },
      summary: { ...publishedSummary.summary, headline: 'Пока нет сопоставимых результатов.' },
    }])

    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    expect(await screen.findByRole('heading', { name: 'Ближайшая тренировка не запланирована' })).toBeVisible()
    expect(screen.getAllByText('Ближайшая тренировка не запланирована')).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: 'Запланировать тренировку' })).toHaveLength(1)
    expect(document.querySelector('.client-progress-upcoming')).toBeNull()
  })

  it('lets the client switch to load and retry a failed workout history request', async () => {
    const user = userEvent.setup()
    repositories.firstCompletedWorkoutDate.mockResolvedValue(localDate('2026-07-20'))
    repositories.listForClient.mockResolvedValue([publishedSummary])
    repositories.workouts
      .mockRejectedValueOnce(new Error('История временно недоступна'))
      .mockResolvedValueOnce([])

    render(<ClientTrainingSummaryCard clientId="client-1" />, { wrapper: wrapper(queryClient()) })

    await user.click(await screen.findByRole('button', { name: 'Нагрузка' }))
    expect((await screen.findByText('Не удалось собрать нагрузку по тренировкам.')).closest('[role="alert"]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Попробовать ещё раз' }))
    expect(await screen.findByText('После завершённой тренировки покажем распределение нагрузки по зонам.')).toBeVisible()
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

    expect(await screen.findByRole('group', { name: 'Анатомическая схема мышц, вид сзади' })).toBeVisible()
    expect(screen.getByLabelText('Верх спины. Лучший результат зоны: +36%')).toHaveAttribute('aria-pressed', 'true')
    await user.click(await screen.findByRole('button', { name: 'Нагрузка' }))
    expect(await screen.findByLabelText('Верх спины. Доля всех выполненных подходов: 67%')).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Спереди' }))
    expect(screen.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible()
    await user.click(screen.getByLabelText('Грудь. Доля всех выполненных подходов: 33%'))
    const loadDetail = document.querySelector<HTMLElement>('.body-progress-detail')
    expect(loadDetail).toHaveAttribute('data-copy-source', 'deterministic')
    expect(loadDetail).toHaveTextContent('На зону «Грудь» приходится 33% всех выполненных подходов.')
    expect(screen.queryByText('Жим лёжа: 1 подход')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Показать 2 упражнения' }))
    const loadDialog = await screen.findByRole('dialog', { name: 'Грудь' })
    expect(loadDialog).toHaveTextContent('Жим лёжа: 1 подход')
    await user.click(within(loadDialog).getByRole('button', { name: 'Закрыть' }))
    await user.click(screen.getByRole('button', { name: 'Прогресс' }))
    expect(screen.getByLabelText('Верх спины. Лучший результат зоны: +36%')).toHaveAttribute('aria-pressed', 'true')
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

    await screen.findByLabelText('Верх спины. Лучший результат зоны: +36%')
    const map = document.querySelector<HTMLElement>('.body-progress-map')
    expect(map).not.toBeNull()
    if (!map) return
    expect(within(map).getByText('В зоне «Верх спины» лучший подтверждённый результат изменился на +36%.')).toBeVisible()
    expect(within(map).queryByText(/Тяга нижнего блока/)).toBeNull()
    expect(within(map).queryByText(/Пуловер прямыми руками/)).toBeNull()
    await user.click(within(map).getByRole('button', { name: 'Показать 3 упражнения' }))
    const dialog = await screen.findByRole('dialog', { name: 'Верх спины' })
    expect(dialog).toHaveTextContent(longExerciseName)
    expect(dialog).toHaveTextContent('Тяга нижнего блока')
    expect(dialog).toHaveTextContent('Пуловер прямыми руками в блоке')
  })
})
