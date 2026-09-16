import { describe, expect, it } from 'vitest'
import type { Workout } from '../../shared/domain'
import { latestWorkoutFact } from '../../shared/workout-results'
import { workoutResultDeltaLabel, workoutVolumeComparison } from './workout-completion-insights'

function workout(id: string, date: string, refs: string[], weight: number): Workout {
  return {
    id,
    clientId: 'client-id',
    clientName: 'Анна',
    workoutDate: date as Workout['workoutDate'],
    startTime: null,
    endTime: null,
    startedAt: `${date}T08:00:00.000Z`,
    completedAt: `${date}T09:00:00.000Z`,
    status: 'done',
    notes: null,
    stageId: null,
    stageTitle: null,
    version: 1,
    exercises: refs.map((ref, index) => ({
      id: `${id}-exercise-${index}`,
      position: index,
      source: 'system',
      ref,
      name: ref,
      muscleGroup: 'chest',
      inputKind: 'strength',
      blockId: `${id}-block-${index}`,
      blockType: 'single',
      blockPreset: 'set',
      blockRounds: 1,
      restBetweenExercisesSec: 0,
      restBetweenRoundsSec: 0,
      restBetweenSetsSec: 0,
      sets: [{
        id: `${id}-set-${index}`,
        position: 0,
        weightKg: weight,
        reps: 10,
        fact: { weightKg: weight, reps: 10 },
        confirmedAt: `${date}T08:30:00.000Z`,
        version: 1,
      }],
    })),
  } as Workout
}

describe('workout completion insights', () => {
  it('compares volume only with the latest sufficiently similar workout', () => {
    const current = workout('current', '2026-09-16', ['bench', 'squat'], 60)
    const older = workout('older', '2026-09-01', ['bench', 'squat'], 40)
    const latest = workout('latest', '2026-09-10', ['bench', 'squat'], 50)
    const unrelated = workout('unrelated', '2026-09-15', ['deadlift'], 100)

    expect(workoutVolumeComparison(current, [current, older, unrelated, latest])).toEqual({
      currentTonnage: 1200,
      previousTonnage: 1000,
      changePercent: 20,
      previousWorkoutDate: '2026-09-10',
    })
  })

  it('does not invent progress from a weak exercise overlap', () => {
    const current = workout('current', '2026-09-16', ['bench', 'squat', 'row'], 60)
    const previous = workout('previous', '2026-09-10', ['bench'], 50)
    expect(workoutVolumeComparison(current, [previous])).toBeNull()
  })

  it('rejects a later or one-sided match as a previous comparable workout', () => {
    const current = workout('current', '2026-09-16', ['bench', 'squat'], 60)
    const later = { ...workout('later', '2026-09-16', ['bench', 'squat'], 70), completedAt: '2026-09-16T10:00:00.000Z' }
    const overloaded = workout('overloaded', '2026-09-10', ['bench', 'squat', 'row', 'deadlift', 'press'], 50)
    expect(workoutVolumeComparison(current, [later, overloaded])).toBeNull()
  })

  it('shows a record delta in the metric that actually produced the record', () => {
    const previous = workout('previous', '2026-09-10', ['bench'], 50)
    const current = workout('current', '2026-09-16', ['bench'], 60)
    const result = latestWorkoutFact([previous, current], current.id).result
    expect(result?.state).toBe('record')
    expect(result && workoutResultDeltaLabel(result)).toBe('+10 кг к прошлому результату')
  })
})
