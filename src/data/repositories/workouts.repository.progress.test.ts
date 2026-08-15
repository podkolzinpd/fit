import { describe, expect, it } from 'vitest'
import { exerciseProgressPageFromRows, type ExerciseProgressRow } from './exercise-progress-page'

function row(index: number): ExerciseProgressRow {
  const day = String(31 - index).padStart(2, '0')
  return {
    workout_id: `workout-${index}`,
    workout_date: `2026-01-${day}`,
    completed_at: `2026-01-${day}T10:00:00Z`,
    exercise_name: 'Присед',
    input_kind: 'strength',
    confirmed_set_count: 2,
    primary_value: 60,
    previous_primary_value: 55,
    primary_change: 5,
    all_time_primary_value: 65,
    best_weight_kg: 60,
    reps_at_best_weight: 8,
    best_weight_reps: 480,
    all_time_best_weight_kg: 65,
    all_time_best_weight_reps: 520,
    is_primary_pr: true,
    is_weight_pr: true,
    is_weight_reps_pr: false,
    trainer_comment: index === 0 ? 'Чистая техника' : null,
    sets: [{ weightKg: 60, reps: 8, durationSec: null, distanceKm: null, rpe: 8 }],
    total_count: 25,
  }
}

describe('exerciseProgressPageFromRows', () => {
  it('maps the server calculation and uses one lookahead row for the cursor', () => {
    const page = exerciseProgressPageFromRows(Array.from({ length: 21 }, (_, index) => row(index)))

    expect(page.items).toHaveLength(20)
    expect(page.totalCount).toBe(25)
    expect(page.nextCursor).toEqual({
      completedAt: '2026-01-12T10:00:00Z',
      workoutId: 'workout-19',
    })
    expect(page.items[0]).toMatchObject({
      workoutId: 'workout-0',
      workoutDate: '2026-01-31',
      primaryValue: 60,
      allTimeBestWeightKg: 65,
      isWeightPr: true,
      trainerComment: 'Чистая техника',
      sets: [{ weightKg: 60, reps: 8, rpe: 8 }],
    })
  })

  it('does not invent another page without a lookahead row', () => {
    expect(exerciseProgressPageFromRows([row(0)]))
      .toMatchObject({ nextCursor: null, totalCount: 25 })
  })
})
