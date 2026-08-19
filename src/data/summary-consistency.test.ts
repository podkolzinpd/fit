import { describe, expect, it } from 'vitest'
import { buildSummaryConsistency } from '../../supabase/functions/summarize-client-training/summary-consistency'

describe('AI summary consistency window', () => {
  it('starts a short history at the first completed workout without extrapolating beyond a week', () => {
    expect(buildSummaryConsistency(
      ['2026-08-18', '2026-08-20'],
      '2026-05-21',
      '2026-08-20',
      '2026-08-18',
    )).toMatchObject({
      completed_workouts: 2,
      workouts_per_week: 2,
      observation_start: '2026-08-18',
      observation_days: 3,
      longest_gap_days: 2,
    })
  })

  it('uses the whole requested horizon when training started before it', () => {
    expect(buildSummaryConsistency(
      ['2026-06-01', '2026-07-01', '2026-08-01'],
      '2026-05-21',
      '2026-08-20',
      '2026-01-10',
    )).toMatchObject({
      completed_workouts: 3,
      workouts_per_week: 0.2,
      observation_start: '2026-05-21',
      observation_days: 92,
      longest_gap_days: 31,
    })
  })

  it('includes the current trailing break in the longest gap', () => {
    expect(buildSummaryConsistency(
      ['2026-08-01', '2026-08-08'],
      '2026-08-01',
      '2026-08-20',
      '2026-08-01',
    ).longest_gap_days).toBe(12)
  })
})
