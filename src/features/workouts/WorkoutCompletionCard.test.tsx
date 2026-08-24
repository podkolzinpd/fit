import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { WorkoutPersonalRecord } from '../../shared/domain'
import { completionResultLabel, WorkoutCompletionCard } from './WorkoutCompletionCard'

const record: WorkoutPersonalRecord = {
  exerciseRef: 'dumbbell-press',
  exerciseName: 'Жим гантелей лёжа',
  inputKind: 'strength',
  metric: 'weight_reps',
  primaryValue: 840,
  weightKg: 70,
  reps: 12,
}

describe('WorkoutCompletionCard', () => {
  it('shows a confirmed partial result without treating the workout as failed', () => {
    render(<MemoryRouter><WorkoutCompletionCard completedSets={1} totalSets={4} clientMode clientId="client-1" /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Тренировка завершена' })).toBeVisible()
    expect(screen.getByText('Подтверждено 1 из 4 подходов')).toBeVisible()
    expect(screen.getByRole('link', { name: /Посмотреть прогресс/ })).toHaveAttribute('href', '/me/progress')
  })

  it('shows one exact personal record and a trainer-specific next step', () => {
    render(<MemoryRouter><WorkoutCompletionCard completedSets={3} totalSets={3} record={record} clientMode={false} clientId="client-1" /></MemoryRouter>)
    expect(screen.getByText('Личный рекорд · Жим гантелей лёжа')).toBeVisible()
    expect(screen.getByText('70 кг × 12 повт.')).toBeVisible()
    expect(screen.getByRole('link', { name: /Вернуться к клиенту/ })).toHaveAttribute('href', '/clients/client-1')
    expect(screen.getByText('Личный рекорд · Жим гантелей лёжа').closest('section')).toHaveClass('has-record')
  })

  it('uses natural Russian labels for complete and empty workouts', () => {
    expect(completionResultLabel(1, 1)).toBe('Подтверждено 1 подход')
    expect(completionResultLabel(3, 3)).toBe('Подтверждено 3 подхода')
    expect(completionResultLabel(0, 0)).toBe('Результаты тренировки сохранены')
  })
})
