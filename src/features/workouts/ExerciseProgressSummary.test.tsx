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
    expect(screen.getByText('+5 кг')).toBeVisible()
    expect(screen.getByText('65 кг')).toBeVisible()
    expect(screen.getByText('520 кг·повт.')).toBeVisible()
    expect(screen.getByText('12 из 25 до следующей отметки')).toBeVisible()
    expect(screen.getByText(/без расчётных значений/)).toBeVisible()
    const weightRecord = screen.getByText('Личный рекорд · рабочий вес').closest('div')
    const volumeRecord = screen.getByText('Личный рекорд · вес × повторы').closest('div')
    expect(weightRecord).toHaveClass('is-new-record')
    expect(weightRecord?.querySelector('[data-icon="record"]')).toBeInTheDocument()
    expect(volumeRecord).not.toHaveClass('is-new-record')
    expect(volumeRecord?.querySelector('[data-icon="record"]')).not.toBeInTheDocument()
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
    expect(exerciseProgressSetLabel({ durationSec: 60, rpe: 7.5 }, true)).toBe('1 мин × RPE 7,5')
  })

  it('has an explicit empty state', () => {
    render(<ExerciseProgressSummary latest={undefined} totalCount={0} />)
    expect(screen.getByText('Пока нет подтверждённых результатов по этому упражнению.')).toBeVisible()
  })
})
