import { describe, expect, it } from 'vitest'
import { buildSummaryModelInput } from '../../supabase/functions/summarize-client-training/summary-model-input'

describe('buildSummaryModelInput', () => {
  it('keeps comparable aggregates and removes the repeated session series', () => {
    const exercises = Array.from({ length: 20 }, (_, index) => ({
      name: `Упражнение ${index + 1}`,
      kind: 'strength',
      session_count: 30 - index,
      first_session: { max_weight_kg: 50 },
      last_session: { max_weight_kg: 60 },
      change_percent: { max_weight: 20 },
      best: { max_weight_kg: 65 },
      sessions: Array.from({ length: 30 }, () => ({ max_weight_kg: 50 })),
    }))

    const result = buildSummaryModelInput({
      period: { start: '2026-07-01', end: '2026-08-20' },
      consistency: { completed_workouts: 30 },
      goal: null,
      exercises,
    })

    expect(result.exercises).toHaveLength(12)
    expect(result.exercises[0]).toMatchObject({
      name: 'Упражнение 1',
      first_session: { max_weight_kg: 50 },
      last_session: { max_weight_kg: 60 },
      change_percent: { max_weight: 20 },
    })
    expect(result.exercises[0]).not.toHaveProperty('sessions')
    expect(JSON.stringify(result).length).toBeLessThan(10_000)
  })
})
