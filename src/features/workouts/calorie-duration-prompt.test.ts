import { describe, expect, it } from 'vitest'
import type { Workout, WorkoutDraft } from '../../shared/domain'
import { firstCardioDraftMissingEnteredDuration, firstCardioSetMissingEnteredDuration } from './calorie-duration-prompt'

const workout = (source: 'entered' | 'planned' | 'unknown', seconds?: number) => ({
  exercises: [{ id: 'bike', name: 'Велотренажёр', muscleGroup: 'cardio', sets: [{
    id: 'set-1', confirmedAt: '2026-10-01T12:00:00Z', distanceKm: 20,
    fact: { distanceKm: 20, ...(seconds === undefined ? {} : { durationSec: seconds }) },
    metricSources: { duration: source, distance: 'entered', rpe: 'unknown' },
  }] }],
}) as Pick<Workout, 'exercises'>

describe('cardio duration prompt', () => {
  it('asks when bike distance is confirmed but time is missing', () => {
    expect(firstCardioSetMissingEnteredDuration(workout('unknown'))).toMatchObject({
      exerciseId: 'bike', setId: 'set-1', exerciseName: 'Велотренажёр',
    })
  })

  it('does not treat copied planned time as measured work', () => {
    expect(firstCardioSetMissingEnteredDuration(workout('planned', 3600))).not.toBeNull()
  })

  it('does not interrupt finishing after actual time is entered', () => {
    expect(firstCardioSetMissingEnteredDuration(workout('entered', 3600))).toBeNull()
  })

  it('accepts a filled duration in legacy workouts without provenance metadata', () => {
    const candidate = workout('unknown', 3600)
    delete candidate.exercises[0]!.sets[0]!.metricSources
    expect(firstCardioSetMissingEnteredDuration(candidate)).toBeNull()
    candidate.exercises[0]!.sets[0]!.fact.durationSec = undefined
    expect(firstCardioSetMissingEnteredDuration(candidate)).not.toBeNull()
  })

  it('ignores unconfirmed distance', () => {
    const candidate = workout('unknown')
    candidate.exercises[0]!.sets[0]!.confirmedAt = null
    expect(firstCardioSetMissingEnteredDuration(candidate)).toBeNull()
  })

  it('warns on a completed-result form but accepts entered time', () => {
    const draft = { exercises: [{
      name: 'Бег', muscleGroup: 'cardio', sets: [{ position: 0, distanceKm: 5,
        durationSec: 1800, metricSources: { duration: 'planned', distance: 'entered', rpe: 'unknown' },
      }],
    }] } as Pick<WorkoutDraft, 'exercises'>
    expect(firstCardioDraftMissingEnteredDuration(draft)).toBe('Бег')
    draft.exercises[0]!.sets[0]!.metricSources!.duration = 'entered'
    expect(firstCardioDraftMissingEnteredDuration(draft)).toBeNull()
  })
})
