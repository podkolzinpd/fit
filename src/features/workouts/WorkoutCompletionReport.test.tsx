import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { WorkoutPersonalRecord } from '../../shared/domain'
import { WorkoutCompletionReport, workoutCompletionPercent, workoutCompletionTitle } from './WorkoutCompletionReport'

const baseProps = {
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

const record: WorkoutPersonalRecord = {
  exerciseRef: 'bench-press',
  exerciseName: 'Жим штанги лёжа',
  inputKind: 'strength',
  metric: 'weight_reps',
  primaryValue: 840,
  weightKg: 70,
  reps: 12,
}

describe('WorkoutCompletionReport', () => {
  it('shows the complete result without empty metrics', () => {
    render(<MemoryRouter><WorkoutCompletionReport {...baseProps} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Тренировка завершена' })).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Выполнение плана' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText('План выполнен полностью')).toBeVisible()
    expect(screen.getByText('Результат доступен тренеру')).toBeVisible()
    expect(screen.getByRole('link', { name: /Подробнее в прогрессе/ })).toHaveAttribute('href', '/me/progress')
    expect(screen.queryByText('Калории')).not.toBeInTheDocument()
  })

  it('names a partial save and lists unfinished exercises', () => {
    render(<MemoryRouter><WorkoutCompletionReport {...baseProps} completedSets={1} totalSets={4} completedExercises={0} totalExercises={2} incompleteExercises={['Жим лёжа', 'Очень длинное название упражнения для мобильного экрана']} duration={null} tonnage={null} muscleGroups={[]} hasTrainer={false} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Тренировка сохранена частично' })).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Выполнение плана' })).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('Подтверждено 1 из 4 подходов')).toBeVisible()
    expect(screen.getByText('Жим лёжа')).toBeVisible()
    expect(screen.queryByText('Результат доступен тренеру')).not.toBeInTheDocument()
    expect(screen.queryByText('Время')).not.toBeInTheDocument()
    expect(screen.queryByText('Тоннаж')).not.toBeInTheDocument()
  })

  it('shows exactly one personal record as the main result', () => {
    render(<MemoryRouter><WorkoutCompletionReport {...baseProps} record={record} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Личный рекорд' })).toBeVisible()
    expect(screen.getByText('Жим штанги лёжа')).toBeVisible()
    expect(screen.getByText('70 кг × 12 повт.')).toBeVisible()
    expect(screen.queryByText('План выполнен полностью')).not.toBeInTheDocument()
  })

  it('keeps the achievement stable while records are loading', () => {
    render(<MemoryRouter><WorkoutCompletionReport {...baseProps} recordLoading /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent('Проверяем достижения…')
    expect(screen.queryByText('План выполнен полностью')).not.toBeInTheDocument()
  })
})

describe('workout completion calculations', () => {
  it('clamps percentages and distinguishes partial completion', () => {
    expect(workoutCompletionPercent(1, 4)).toBe(25)
    expect(workoutCompletionPercent(5, 4)).toBe(100)
    expect(workoutCompletionPercent(0, 0)).toBeNull()
    expect(workoutCompletionTitle(1, 4)).toBe('Тренировка сохранена частично')
    expect(workoutCompletionTitle(4, 4)).toBe('Тренировка завершена')
  })
})
