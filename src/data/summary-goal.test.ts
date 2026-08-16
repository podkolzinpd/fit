import { describe, expect, it } from 'vitest'
import { buildTrainingGoalContext } from '../../supabase/functions/summarize-client-training/summary-goal'

describe('training summary goal context', () => {
  it('prefers the structured active goal and current stage', () => {
    expect(buildTrainingGoalContext('Старая цель', {
      title: 'Набор мышечной массы',
      targetDate: '2026-12-01',
      stages: [
        { title: 'Силовая база', startsOn: '2026-08-01', endsOn: '2026-09-30' },
        { title: 'Объём', startsOn: '2026-10-01', endsOn: '2026-11-30' },
      ],
    }, '2026-08-16')).toEqual({
      title: 'Набор мышечной массы',
      target_date: '2026-12-01',
      current_stage: {
        title: 'Силовая база',
        starts_on: '2026-08-01',
        ends_on: '2026-09-30',
      },
    })
  })

  it('falls back to the profile goal and handles an absent goal', () => {
    expect(buildTrainingGoalContext('  Улучшить выносливость  ', null, '2026-08-16'))
      .toEqual({ title: 'Улучшить выносливость', target_date: null, current_stage: null })
    expect(buildTrainingGoalContext(' ', null, '2026-08-16')).toBeNull()
  })
})
