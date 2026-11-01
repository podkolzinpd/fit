import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { WorkoutChronicleCard } from './WorkoutsPages'

const session = vi.hoisted(() => ({ role: 'trainer' as 'trainer' | 'client' }))
vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor: { role: session.role, userId: session.role === 'trainer' ? 'coach' : 'athlete', timezone: 'Europe/Moscow' } }),
}))

function completed(overrides: Partial<Workout> = {}): Workout {
  return {
    id: 'history-workout', clientId: 'athlete', clientName: 'Клиент',
    workoutDate: localDate('2026-10-30'), startTime: null, endTime: null,
    startedAt: '2026-10-30T09:00:00Z', completedAt: '2026-10-30T10:00:00Z',
    status: 'done', notes: null, stageId: null, stageTitle: null,
    version: 1, exercises: [], ...overrides,
  }
}

function show(workout: Workout, coachView = true) {
  session.role = coachView ? 'trainer' : 'client'
  return render(<MemoryRouter><WorkoutChronicleCard workout={workout} historyListActions coachView={coachView} /></MemoryRouter>)
}

describe('WorkoutChronicleCard feedback', () => {
  it('shows a completed trainer workout consistently when only some results were recorded', () => {
    const workout = completed({ exercises: [{ id: 'exercise', name: 'Приседания', ref: 'squat', inputKind: 'strength', position: 0, source: 'system', muscleGroup: 'legs', blockId: 'block', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
      sets: [0, 1].map(position => ({ id: `set-${position}`, position, weightKg: 30, reps: 10, confirmedAt: position === 0 ? '2026-10-30T10:00:00Z' : null, fact: {}, version: 1 })) }] })
    show(workout)
    expect(screen.getByText('Проведена')).toHaveAttribute('data-state', 'completed')
    expect(screen.queryByText('Частично')).not.toBeInTheDocument()
  })

  it('does not call an unrecorded trainer exercise unperformed or change the athlete result', () => {
    const workout = completed({ exercises: [{ id: 'exercise', name: 'Приседания', ref: 'squat', inputKind: 'strength', position: 0, source: 'system', muscleGroup: 'legs', blockId: 'block', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 0,
      sets: [{ id: 'set', position: 0, weightKg: 30, reps: 10, confirmedAt: null, fact: {}, version: 1 }] }] })
    session.role = 'trainer'
    const view = render(<MemoryRouter><WorkoutChronicleCard workout={workout} coachView /></MemoryRouter>)
    expect(screen.getByText('—')).toBeVisible()
    expect(screen.queryByText('Не выполнено')).not.toBeInTheDocument()
    view.unmount()
    session.role = 'client'
    render(<MemoryRouter><WorkoutChronicleCard workout={workout} /></MemoryRouter>)
    expect(screen.getByText('Не выполнено')).toBeVisible()
  })

  it('retains a coach-visible wellbeing result when older feedback has no RPE', () => {
    show(completed({ wellbeing: 'hard' }))
    expect(screen.getByText('Плохо')).toBeVisible()
    expect(screen.queryByText(/RPE/)).not.toBeInTheDocument()
    expect(screen.queryByText('1 ч 00 мин')).not.toBeInTheDocument()
  })

  it('retains paired feedback without restoring aggregate coach statistics', () => {
    show(completed({ wellbeing: 'good', sessionRpe: 7 }))
    expect(screen.getByText('Хорошо')).toBeVisible()
    expect(screen.getByText('RPE 7/10')).toBeVisible()
    expect(screen.queryByText('1 ч 00 мин')).not.toBeInTheDocument()
  })

  it('retains discomfort without an accompanying wellbeing or RPE', () => {
    show(completed({ discomfort: true }))
    expect(screen.getByText('Дискомфорт')).toBeVisible()
  })

  it('preserves the athlete feedback and duration presentation', () => {
    show(completed({ wellbeing: 'hard' }), false)
    expect(screen.getByText('Плохо')).toBeVisible()
    expect(screen.getByText('1 ч 00 мин')).toBeVisible()
  })
})
