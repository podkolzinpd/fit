import { describe, expect, it } from 'vitest'
import { buildSummaryModelInput, deriveExerciseObservations, deriveMeasurementChanges } from '../../supabase/functions/summarize-client-training/summary-model-input'

describe('buildSummaryModelInput', () => {
  it('keeps the complete current and previous periods with explicit coverage', () => {
    const exercises = Array.from({ length: 20 }, (_, index) => ({
      name: `Упражнение ${index + 1}`,
      kind: 'strength',
      session_count: 30 - index,
      first_session: { max_weight_kg: 50, total_reps: 30 },
      last_session: { max_weight_kg: 60, total_reps: 30 },
      change_percent: { max_weight: 20 },
      best: { max_weight_kg: 65 },
      sessions: Array.from({ length: 10 }, (_, session) => ({ date: `2026-08-${session + 1}`, max_weight_kg: 50 + session, total_reps: 30 })),
    }))

    const result = buildSummaryModelInput({
      period: { start: '2026-08-01', end: '2026-08-31' },
      consistency: { completed_workouts: 30 },
      goal: null,
      feedback_signals: [{ date: '2026-08-31', session_rpe: 8 }],
      measurements: [
        { recorded_on: '2026-08-01', weight_kg: 82, waist_cm: 91 },
        { recorded_on: '2026-08-31', weight_kg: 80, waist_cm: 88 },
      ],
      exercises,
      previous_period: {
        period: { start: '2026-07-01', end: '2026-07-31' },
        consistency: { completed_workouts: 20 },
        feedback_signals: [],
        measurements: [{ recorded_on: '2026-07-31', weight_kg: 82.5 }],
        exercises: exercises.slice(0, 10),
      },
    })

    expect(result.exercises).toHaveLength(20)
    expect(result.exercises[0]).toMatchObject({
      name: 'Упражнение 1',
    })
    expect(result.exercises[0]?.derived_observations.map((item) => item.kind)).toContain('load_up_reps_held')
    expect(result.exercises[0]?.sessions).toHaveLength(10)
    expect(result.previous_period?.exercises).toHaveLength(10)
    expect(result.input_coverage).toEqual({
      current: { exercises: 20, sessions: 200, sets: 0 },
      previous: { exercises: 10, sessions: 100, sets: 0 },
      complete: true,
    })
    expect(result.previous_period?.period).toEqual({ start: '2026-07-01', end: '2026-07-31' })
    expect(result.measurements.changes).toContainEqual(expect.objectContaining({ metric: 'waist_cm', from: 91, to: 88, change: -3 }))
    expect(result.measurements.compared_to_previous_period).toContainEqual(expect.objectContaining({ metric: 'weight_kg', from: 82.5, to: 80, change: -2.5 }))
    expect(result.previous_period?.measurements.recent_entries).toHaveLength(1)
    expect(JSON.stringify(result)).toContain('Упражнение 20')
  })

  it('does not drop or reorder exercises to prioritize a goal keyword', () => {
    const result = buildSummaryModelInput({
      period: {}, consistency: {}, goal: { title: 'Увеличить результат в приседаниях' },
      exercises: [
        { name: 'Жим лёжа', kind: 'strength', session_count: 20, sessions: [] },
        {
          name: 'Приседания со штангой', kind: 'strength', session_count: 3,
          change_percent: { max_weight: 10 },
          sessions: [
            { max_weight_kg: 80, total_reps: 24 },
            { max_weight_kg: 85, total_reps: 24 },
            { max_weight_kg: 90, total_reps: 24 },
          ],
        },
      ],
    })
    expect(result.exercises.map((exercise) => exercise.name)).toEqual([
      'Жим лёжа',
      'Приседания со штангой',
    ])
  })
})

describe('summary model measurements', () => {
  it('includes named custom metrics and derives their period change', () => {
    const measurements = [
      {
        id: 'progress-1', recorded_on: '2026-08-11', weight_kg: 80,
        custom_metrics: [{ metric_id: 'shoulders', name: 'Плечи', unit: 'см', value: 116 }],
      },
      {
        id: 'progress-2', recorded_on: '2026-09-10', weight_kg: 81,
        custom_metrics: [{ metric_id: 'shoulders', name: 'Плечи', unit: 'см', value: 118 }],
      },
    ]

    expect(deriveMeasurementChanges(measurements)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metric: 'custom', metric_id: 'shoulders', name: 'Плечи', unit: 'см',
        from: 116, to: 118, change: 2, evidence_points: 2,
      }),
    ]))

    const input = buildSummaryModelInput({
      period: { start: '2026-08-11', end: '2026-09-10' },
      consistency: { completed_workouts: 1 },
      exercises: [], goal: null, measurements,
    })

    expect(input.measurements.recent_entries[0]).not.toHaveProperty('id')
    expect(input.measurements.recent_entries[1]?.custom_metrics).toEqual([
      { metric_id: 'shoulders', name: 'Плечи', unit: 'см', value: 118 },
    ])
  })
})

describe('deriveMeasurementChanges', () => {
  it('derives only measured changes and never fills missing body values', () => {
    expect(deriveMeasurementChanges([
      { recorded_on: '2026-08-01', weight_kg: 82, chest_cm: 105 },
      { recorded_on: '2026-08-15', weight_kg: 81 },
      { recorded_on: '2026-08-31', weight_kg: 80, chest_cm: 105 },
    ])).toEqual([
      expect.objectContaining({ metric: 'weight_kg', from: 82, to: 80, change: -2, evidence_points: 3 }),
    ])
  })
})

describe('deriveExerciseObservations', () => {
  it('distinguishes a load increase paid for with fewer repetitions', () => {
    expect(deriveExerciseObservations({
      name: 'Жим лёжа', kind: 'strength', session_count: 2,
      best: { max_weight_kg: 70 },
      sessions: [
        { max_weight_kg: 60, total_reps: 30, set_count: 3 },
        { max_weight_kg: 70, total_reps: 20, set_count: 3 },
      ],
    })).toContainEqual(expect.objectContaining({ kind: 'load_up_reps_down' }))
  })

  it('requires three comparable sessions before calling a repeated decline', () => {
    expect(deriveExerciseObservations({
      name: 'Тяга', kind: 'strength', session_count: 2,
      sessions: [{ max_weight_kg: 70 }, { max_weight_kg: 65 }],
    }).map((item) => item.kind)).not.toContain('repeated_load_decline')

    expect(deriveExerciseObservations({
      name: 'Тяга', kind: 'strength', session_count: 3,
      sessions: [{ max_weight_kg: 70 }, { max_weight_kg: 67.5 }, { max_weight_kg: 65 }],
    })).toContainEqual(expect.objectContaining({ kind: 'repeated_load_decline', evidence_sessions: 3 }))
  })
})
