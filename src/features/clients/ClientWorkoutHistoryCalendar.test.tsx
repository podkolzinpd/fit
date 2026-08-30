import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { ClientWorkoutHistoryCalendar } from './ClientWorkoutHistoryCalendar'

vi.mock('../workouts', () => ({
  WorkoutChronicleCard: ({ workout }: { workout: Workout }) => <a href={`/workouts/${workout.id}`}>{workout.id}</a>,
  workoutCountLabel: (count: number) => count === 1 ? '1 тренировка' : count < 5 ? `${count} тренировки` : `${count} тренировок`,
}))

const TODAY = localDate('2026-08-30')
const MONTH = localDate('2026-08-01')

function workout(id: string, workoutDate: Workout['workoutDate']): Workout {
  return {
    id,
    clientId: 'client-1',
    clientName: 'Анна',
    workoutDate,
    startTime: null,
    endTime: null,
    startedAt: '2026-08-03T08:00:00Z',
    completedAt: '2026-08-03T09:00:00Z',
    status: 'done',
    notes: null,
    stageId: null,
    stageTitle: null,
    version: 1,
    exercises: [],
  }
}

function renderCalendar(overrides: Partial<Parameters<typeof ClientWorkoutHistoryCalendar>[0]> = {}) {
  const props: Parameters<typeof ClientWorkoutHistoryCalendar>[0] = {
    month: MONTH,
    today: TODAY,
    workouts: [workout('one', localDate('2026-08-03')), workout('two', localDate('2026-08-03'))],
    selectedDate: undefined,
    loading: false,
    error: null,
    returnTo: '/me/workouts?view=calendar&month=2026-08&date=2026-08-03',
    contextLabel: () => 'Создана вами',
    onRetry: vi.fn(),
    onMonthChange: vi.fn(),
    onDateSelect: vi.fn(),
    ...overrides,
  }
  render(<MemoryRouter><ClientWorkoutHistoryCalendar {...props} /></MemoryRouter>)
  return props
}

describe('ClientWorkoutHistoryCalendar', () => {
  it('renders a Monday-first month grid and exposes only workout dates as actions', () => {
    renderCalendar()

    expect(screen.getByRole('grid', { name: 'История тренировок за Август 2026' })).toBeVisible()
    expect(screen.getAllByRole('gridcell')).toHaveLength(42)
    expect(screen.getByRole('button', { name: '3 августа 2026 г., 2 тренировки' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /4 августа/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled()
  })

  it('selects a workout date and moves between available months', () => {
    const props = renderCalendar()

    fireEvent.click(screen.getByRole('button', { name: '3 августа 2026 г., 2 тренировки' }))
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))

    expect(props.onDateSelect).toHaveBeenCalledWith('2026-08-03')
    expect(props.onMonthChange).toHaveBeenCalledWith(-1)
  })

  it('shows the selected day with links to every workout', () => {
    renderCalendar({ selectedDate: localDate('2026-08-03') })

    expect(screen.getByRole('heading', { name: '3 августа 2026 г.' })).toBeVisible()
    expect(screen.getByText('2 тренировки')).toBeVisible()
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'one' })).toHaveAttribute('href', '/workouts/one')
  })

  it('keeps loading, empty and retry states local to the calendar', () => {
    const retry = vi.fn()
    const { rerender } = render(<MemoryRouter><ClientWorkoutHistoryCalendar
      month={MONTH}
      today={TODAY}
      workouts={[]}
      loading
      error={null}
      returnTo="/me/workouts"
      contextLabel={() => null}
      onRetry={retry}
      onMonthChange={() => undefined}
      onDateSelect={() => undefined}
    /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем месяц…')

    rerender(<MemoryRouter><ClientWorkoutHistoryCalendar
      month={MONTH}
      today={TODAY}
      workouts={[]}
      loading={false}
      error={new Error('network')}
      returnTo="/me/workouts"
      contextLabel={() => null}
      onRetry={retry}
      onMonthChange={() => undefined}
      onDateSelect={() => undefined}
    /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
