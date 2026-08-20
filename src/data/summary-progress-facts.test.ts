import { describe, expect, it } from 'vitest'
import { buildSummaryProgressFacts } from '../../supabase/functions/summarize-client-training/summary-progress-facts'

describe('buildSummaryProgressFacts', () => {
  it('keeps verified strength values and integer percentages', () => {
    expect(buildSummaryProgressFacts([{
      name: 'Тяга верхнего блока',
      kind: 'strength',
      session_count: 3,
      first_session: { max_weight_kg: 50, volume_kg: 600 },
      last_session: { max_weight_kg: 68, volume_kg: 840 },
      change_percent: { max_weight: 36, volume: 40 },
    }])).toEqual([{
      exercise_name: 'Тяга верхнего блока',
      kind: 'strength',
      session_count: 3,
      changes: [
        { metric: 'max_weight', from: 50, to: 68, change_percent: 36, favorable: true },
        { metric: 'volume', from: 600, to: 840, change_percent: 40, favorable: true },
      ],
    }])
  })

  it('treats a lower running pace as an improvement', () => {
    expect(buildSummaryProgressFacts([{
      name: 'Бег',
      kind: 'distance',
      session_count: 2,
      first_session: { total_distance_km: 3, pace_min_per_km: 6 },
      last_session: { total_distance_km: 5, pace_min_per_km: 5.4 },
      change_percent: { distance: 67, pace: -10 },
    }])[0]?.changes).toEqual([
      { metric: 'distance', from: 3, to: 5, change_percent: 67, favorable: true },
      { metric: 'pace', from: 6, to: 5.4, change_percent: -10, favorable: true },
    ])
  })

  it('ignores a single session and unchanged or incomplete comparisons', () => {
    expect(buildSummaryProgressFacts([
      {
        name: 'Планка', kind: 'duration', session_count: 1,
        first_session: { total_duration_min: 1 }, last_session: { total_duration_min: 1.5 },
        change_percent: { duration: 50 },
      },
      {
        name: 'Присед', kind: 'strength', session_count: 2,
        first_session: { max_weight_kg: 80 }, last_session: { max_weight_kg: 80 },
        change_percent: { max_weight: 0 },
      },
    ])).toEqual([])
  })

  it('limits output and prioritizes favorable well-observed facts', () => {
    const exercises = Array.from({ length: 6 }, (_, index) => ({
      name: `Упражнение ${index + 1}`,
      kind: 'strength',
      session_count: index + 2,
      first_session: { max_weight_kg: 10 },
      last_session: { max_weight_kg: index === 5 ? 9 : 11 },
      change_percent: { max_weight: index === 5 ? -10 : 10 },
    }))
    const facts = buildSummaryProgressFacts(exercises)
    expect(facts).toHaveLength(4)
    expect(facts.map((fact) => fact.exercise_name)).toEqual([
      'Упражнение 5', 'Упражнение 4', 'Упражнение 3', 'Упражнение 2',
    ])
  })
})
