import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { WorkoutRegularityProgressSection } from './WorkoutRegularityProgressSection'

function workout(id: string, date: string): Workout {
  return {
    id,
    clientId: 'client-1',
    clientName: 'Анна',
    workoutDate: localDate(date),
    startTime: null,
    endTime: null,
    startedAt: `${date}T09:00:00Z`,
    completedAt: `${date}T10:00:00Z`,
    status: 'done',
    notes: null,
    stageId: null,
    stageTitle: null,
    version: 1,
    exercises: [],
  }
}

const base = {
  currentWorkouts: [
    workout('one', '2026-08-03'), workout('two', '2026-08-10'),
    workout('three', '2026-08-17'), workout('four', '2026-08-24'),
  ],
  previousWorkouts: [workout('previous-one', '2026-07-07'), workout('previous-two', '2026-07-21')],
  periodStart: localDate('2026-08-03'),
  periodEnd: localDate('2026-08-30'),
  previousPeriodStart: localDate('2026-07-06'),
  previousPeriodEnd: localDate('2026-08-02'),
  today: localDate('2026-08-30'),
  loading: false,
  error: null,
  onRetry: vi.fn(),
}

describe('WorkoutRegularityProgressSection', () => {
  it('shows a compact visual weekly rhythm and calculated facts', () => {
    render(<WorkoutRegularityProgressSection {...base} />)
    const section = screen.getByRole('region', { name: 'Тренировочный ритм' })

    expect(within(section).getByText('4 тренировки')).toBeVisible()
    expect(within(section).getByText('Активные: 4 из 4')).toBeVisible()
    expect(within(section).getByRole('list', { name: 'Завершённые тренировки по неделям' }).children).toHaveLength(4)
    expect(within(section).getByLabelText(/1 тренировка · 03.08.2026–09.08.2026/)).toBeVisible()
    expect(within(section).getByText('4 нед.')).toBeVisible()
    expect(within(section).getAllByText('7 дн.')).toHaveLength(2)
    expect(within(section).queryByText('Частота к прошлому периоду')).toBeNull()
    expect(section.querySelector('.regularity-story-explanation')).toBeNull()
  })

  it('keeps zero data explicit without filler or invented values', () => {
    render(<WorkoutRegularityProgressSection {...base} currentWorkouts={[]} previousWorkouts={undefined} />)
    const section = screen.getByRole('region', { name: 'Тренировочный ритм' })
    expect(within(section).getByText('0 тренировок')).toBeVisible()
    expect(within(section).getByText('Активные: 0 из 4')).toBeVisible()
    expect(within(section).getAllByText('—')).toHaveLength(3)
    expect(within(section).queryByText('Недостаточно данных')).toBeNull()
    expect(section.querySelector('.regularity-story-explanation')).toBeNull()
  })

  it('shows loading and recoverable error states', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<WorkoutRegularityProgressSection {...base} loading />)
    expect(screen.getByRole('status')).toHaveTextContent('Собираем завершённые тренировки')

    rerender(<WorkoutRegularityProgressSection {...base} loading={false} error={new Error('Ошибка')} onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить тренировки')
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
