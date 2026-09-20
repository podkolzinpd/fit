import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Workout } from '../../shared/domain'
import type { WorkoutResult } from '../../shared/workout-results'
import { WorkoutCompletionReport, workoutCompletionCountLine, workoutCompletionPercent, workoutCompletionTitle } from './WorkoutCompletionReport'

const baseProps = {
  date: '16 сентября',
  completedSets: 3,
  totalSets: 3,
  completedExercises: 1,
  totalExercises: 1,
  incompleteExercises: [],
  duration: '42 мин',
  tonnage: '3 840 кг',
  muscleGroups: ['Грудь', 'Трицепс'],
  hasTrainer: true,
}

const resultWorkout = { id: 'current' } as Workout
const previousWorkout = { id: 'previous' } as Workout
const record: WorkoutResult = {
  key: 'system:bench-press:strength:weight',
  exerciseKey: 'system:bench-press:strength',
  exerciseName: 'Жим штанги лёжа',
  metric: 'weight',
  label: 'Максимальный вес',
  unit: 'кг',
  value: 70,
  workout: resultWorkout,
  previous: { workout: previousWorkout, value: 60 },
  previousBest: { workout: previousWorkout, value: 60 },
  state: 'record',
}

describe('WorkoutCompletionReport', () => {
  it('shows the complete result without empty metrics', () => {
    render(<MemoryRouter><WorkoutCompletionReport {...baseProps} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Тренировка завершена' })).toBeVisible()
    expect(screen.getByText('1 упражнение · 3 подхода')).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Выполнение плана' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByRole('heading', { name: 'План выполнен' })).toBeVisible()
    expect(screen.getByText('Результат доступен тренеру')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Поделиться' })).toBeVisible()
    expect(screen.queryByText('С устройства')).not.toBeInTheDocument()
  })

  it('names a partial save and lists unfinished exercises', () => {
    render(<MemoryRouter><WorkoutCompletionReport {...baseProps} completedSets={1} totalSets={4} completedExercises={0} totalExercises={2} incompleteExercises={['Жим лёжа', 'Очень длинное название упражнения для мобильного экрана']} duration={null} tonnage={null} muscleGroups={[]} hasTrainer={false} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Тренировка сохранена частично' })).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Выполнение плана' })).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('0/2 упражнения · 1/4 подхода')).toBeVisible()
    expect(screen.getByText('Подтверждено 1 из 4 подходов')).toBeVisible()
    expect(screen.getByText(/Жим лёжа/)).toBeVisible()
    expect(screen.queryByText('Результат доступен тренеру')).not.toBeInTheDocument()
    expect(screen.queryByText('Время')).not.toBeInTheDocument()
    expect(screen.queryByText('Тоннаж')).not.toBeInTheDocument()
  })

  it('shows exactly one personal record as the main result', () => {
    render(<MemoryRouter><WorkoutCompletionReport {...baseProps} personalResult={record} /></MemoryRouter>)
    expect(screen.getByText('ЛИЧНЫЙ РЕКОРД')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Жим штанги лёжа' })).toBeVisible()
    expect(screen.getByText('Максимальный вес: 70 кг')).toBeVisible()
    expect(screen.getByText('+10 кг к прошлому результату')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'План выполнен' })).not.toBeInTheDocument()
  })

  it('keeps the achievement stable while records are loading', () => {
    render(<MemoryRouter><WorkoutCompletionReport {...baseProps} resultLoading /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent('Проверяем достижения…')
    expect(screen.queryByText('План выполнен полностью')).not.toBeInTheDocument()
  })

  it('shows a retry instead of inventing an achievement when history fails', async () => {
    const retry = vi.fn()
    const user = userEvent.setup()
    render(<MemoryRouter><WorkoutCompletionReport {...baseProps} resultError={new Error('offline')} onRetryResult={retry} /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось проверить достижения')
    expect(screen.getByRole('button', { name: 'Поделиться' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('shows the FIT calorie estimate when it is available', () => {
    render(<MemoryRouter><WorkoutCompletionReport {...baseProps} caloriesKcal={321} /></MemoryRouter>)
    expect(screen.getByText('≈ 321 ккал')).toBeVisible()
    expect(screen.getByText('Оценка ФИТ')).toBeVisible()
  })

  it('offers three share stories and disables progress without a reliable comparison', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><WorkoutCompletionReport {...baseProps} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Поделиться' }))
    expect(screen.getByRole('dialog', { name: 'Чем поделиться' })).toBeVisible()
    expect(screen.getByRole('radio', { name: /Итог/ })).toBeEnabled()
    expect(screen.getByRole('radio', { name: /Достижение/ })).toBeEnabled()
    expect(screen.getByRole('radio', { name: /Прогресс/ })).toBeDisabled()
    expect(screen.getByText('Появится после похожей тренировки')).toBeVisible()
  })

  it('makes the progress story available for a comparable workout', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><WorkoutCompletionReport {...baseProps} volumeComparison={{
      currentTonnage: 3840,
      previousTonnage: 3200,
      changePercent: 20,
      previousWorkoutDate: '2026-09-09',
    }} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Поделиться' }))
    const progress = screen.getByRole('radio', { name: /Прогресс/ })
    expect(progress).toBeEnabled()
    expect(progress).toHaveTextContent('+20% объёма к прошлой похожей')
    await user.click(progress)
    expect(progress).toHaveAttribute('aria-checked', 'true')
  })
})

describe('workout completion calculations', () => {
  it('clamps percentages and distinguishes partial completion', () => {
    expect(workoutCompletionPercent(1, 4)).toBe(25)
    expect(workoutCompletionPercent(5, 4)).toBe(100)
    expect(workoutCompletionPercent(0, 0)).toBeNull()
    expect(workoutCompletionTitle(1, 4)).toBe('Тренировка сохранена частично')
    expect(workoutCompletionTitle(4, 4)).toBe('Тренировка завершена')
    expect(workoutCompletionCountLine(1, 4, 0, 2)).toBe('0/2 упражнения · 1/4 подхода')
  })
})
