import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ExerciseProgressResult } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { ExerciseProgressHistory, ExerciseProgressSummary, exerciseProgressSetLabel, exerciseProgressValueLabel } from './ExerciseProgressSummary'

const strength: ExerciseProgressResult = {
  workoutId: 'workout-1',
  workoutDate: localDate('2026-08-15'),
  completedAt: '2026-08-15T10:00:00Z',
  exerciseName: 'Присед',
  inputKind: 'strength',
  confirmedSetCount: 2,
  primaryValue: 60,
  previousPrimaryValue: 55,
  primaryChange: 5,
  allTimePrimaryValue: 65,
  bestWeightKg: 60,
  repsAtBestWeight: 8,
  bestWeightReps: 480,
  allTimeBestWeightKg: 65,
  allTimeBestWeightReps: 520,
  isPrimaryPr: true,
  isWeightPr: true,
  isWeightRepsPr: false,
  trainerComment: 'Чистая техника',
  sets: [{ weightKg: 60, reps: 8, rpe: 8 }, { weightKg: 55, reps: 10 }],
}

describe('exercise progress presentation', () => {
  it('shows current confirmed evidence, lifetime strength records and milestone', () => {
    render(<ExerciseProgressSummary latest={strength} totalCount={12} />)

    expect(screen.getByText('60 кг × 8 повт.')).toBeVisible()
    expect(screen.getByText('+5 кг к прошлой тренировке')).toBeVisible()
    expect(screen.getByText('65 кг · 520 кг·повт.')).toBeVisible()
    expect(screen.getByText('12 выполнений')).toBeVisible()
    expect(screen.getByText('Отметка 10 · далее 25')).toBeVisible()
    expect(screen.getByText('Учитываем только выполненные подходы.')).toBeVisible()
    expect(screen.getByText('Личный рекорд').querySelector('[data-icon="record"]')).toBeInTheDocument()
  })

  it('marks only server-provided PRs and renders confirmed fact without a plan fallback', () => {
    render(<ExerciseProgressHistory items={[strength]} showRpe={false} />)

    expect(screen.getByText('Личный рекорд · вес')).toBeVisible()
    expect(screen.queryByText('Личный рекорд · вес × повторы')).not.toBeInTheDocument()
    expect(screen.getByText('60 кг × 8 повт. · 55 кг × 10 повт.')).toBeVisible()
    expect(screen.getByText('💬 Чистая техника')).toBeVisible()
    expect(screen.queryByText(/RPE/)).not.toBeInTheDocument()
  })

  it('uses a transparent primary metric for every input kind', () => {
    expect(exerciseProgressValueLabel(30, 'reps')).toBe('30 повт.')
    expect(exerciseProgressValueLabel(90, 'duration')).toBe('1:30')
    expect(exerciseProgressValueLabel(5.25, 'distance')).toBe('5,3 км')
    expect(exerciseProgressSetLabel({ durationSec: 60, rpe: 7.5 }, 'duration', true)).toBe('1 мин × RPE 7,5')
    expect(exerciseProgressSetLabel({ weightKg: 0, reps: 20 }, 'reps', false)).toBe('20 повт.')
    expect(exerciseProgressSetLabel({ distanceKm: 0.5, durationSec: 288, reps: 32 }, 'distance', false, 'rowing-machine'))
      .toBe('500 м × 4:48 × 4:48/500 м × 32 гребков/мин')
  })

  it('shows bodyweight progress without fake kilograms and keeps completion milestones', () => {
    const pushUps: ExerciseProgressResult = {
      ...strength,
      exerciseName: 'Отжимания',
      inputKind: 'reps',
      primaryValue: 20,
      previousPrimaryValue: 15,
      primaryChange: 5,
      allTimePrimaryValue: 20,
      bestWeightKg: null,
      repsAtBestWeight: null,
      bestWeightReps: null,
      allTimeBestWeightKg: null,
      allTimeBestWeightReps: null,
      isPrimaryPr: true,
      isWeightPr: false,
      sets: [{ weightKg: 0, reps: 20 }],
    }

    render(<ExerciseProgressSummary latest={pushUps} totalCount={10} />)

    expect(screen.getByText('20 повт.')).toBeVisible()
    expect(screen.getByText('+5 повт. к прошлой тренировке')).toBeVisible()
    expect(screen.getByText('10 выполнений')).toBeVisible()
    expect(screen.getByText('Отметка 10 · далее 25')).toBeVisible()
    expect(screen.queryByText(/0 кг/)).not.toBeInTheDocument()
  })

  it('keeps the completed-exercise milestones at 10, 25, 50 and 100', () => {
    const view = render(<ExerciseProgressSummary latest={strength} totalCount={10} />)
    expect(screen.getByText('Отметка 10 · далее 25')).toBeVisible()

    view.rerender(<ExerciseProgressSummary latest={strength} totalCount={25} />)
    expect(screen.getByText('Отметка 25 · далее 50')).toBeVisible()

    view.rerender(<ExerciseProgressSummary latest={strength} totalCount={50} />)
    expect(screen.getByText('Отметка 50 · далее 100')).toBeVisible()

    view.rerender(<ExerciseProgressSummary latest={strength} totalCount={100} />)
    expect(screen.getByText('Отметка 100 · далее 250')).toBeVisible()
  })

  it('has an explicit empty state', () => {
    render(<ExerciseProgressSummary latest={undefined} totalCount={0} />)
    expect(screen.getByText('Пока нет подтверждённых результатов по этому упражнению.')).toBeVisible()
  })
})
