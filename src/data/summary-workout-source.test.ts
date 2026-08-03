import { describe, expect, it } from 'vitest'
import { completedWorkoutsInPeriod } from '../../supabase/functions/summarize-client-training/workout-source'

describe('AI summary workout source', () => {
  it('uses only completed, active workouts dated inside the requested period', () => {
    const workouts = completedWorkoutsInPeriod([
      { id: 'done', status: 'done', deleted_at: null, workout_date: '2026-08-02' },
      { id: 'planned', status: 'planned', deleted_at: null, workout_date: '2026-08-02' },
      { id: 'deleted', status: 'done', deleted_at: '2026-08-03T10:00:00Z', workout_date: '2026-08-02' },
      { id: 'outside', status: 'done', deleted_at: null, workout_date: '2026-07-31' },
      { id: 'invalid', status: 'done', deleted_at: null, workout_date: 'not-a-date' },
    ], '2026-08-01', '2026-08-03')

    expect(workouts.map((workout) => workout.id)).toEqual(['done'])
    expect(workouts[0]?.workout_date).toBe('2026-08-02')
  })
})
