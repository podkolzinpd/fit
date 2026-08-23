import { describe, expect, it } from 'vitest'

import {
  readExpectedVersion,
  readSavePlannedWorkoutRequest,
} from './planned-workout-request.js'

const WORKOUT_ID = '12acc6d6-7ca8-43cd-b124-b4224c917fae'
const CLIENT_ID = 'b3942b20-52a2-4d5d-9895-b3b63cf61442'
const BLOCK_ID = '8ffdb87b-078c-42d4-b6db-af8bc60f80f2'

function validRequest() {
  return {
    clientId: CLIENT_ID,
    workoutDate: '2026-08-25',
    startTime: '10:00',
    endTime: '11:00',
    notes: ' План на вторник ',
    exercises: [{
      position: 0,
      source: 'system',
      ref: 'running',
      customExerciseId: null,
      name: 'Бег',
      muscleGroup: 'cardio',
      inputKind: 'distance',
      blockId: BLOCK_ID,
      blockType: 'single',
      blockPreset: 'interval',
      blockRounds: 1,
      restBetweenExercisesSec: 0,
      restBetweenRoundsSec: 90,
      restBetweenSetsSec: 60,
      trainerComment: null,
      sets: [{
        position: 0,
        weightKg: null,
        reps: null,
        durationMin: null,
        durationSec: 1800,
        distanceKm: 5,
        rpe: 7.5,
      }],
    }],
  }
}

describe('planned workout request', () => {
  it('normalizes a create request and keeps its aggregate values explicit', () => {
    expect(readSavePlannedWorkoutRequest(validRequest(), null)).toEqual({
      draft: {
        ...validRequest(),
        id: null,
        notes: 'План на вторник',
      },
      expectedVersion: null,
    })
  })

  it('requires a positive expected version for an update and delete', () => {
    expect(readSavePlannedWorkoutRequest(validRequest(), WORKOUT_ID)).toBeUndefined()
    expect(readSavePlannedWorkoutRequest({
      ...validRequest(),
      expectedVersion: 2,
    }, WORKOUT_ID)).toMatchObject({
      draft: { id: WORKOUT_ID },
      expectedVersion: 2,
    })
    expect(readExpectedVersion({ expectedVersion: 2 })).toBe(2)
    expect(readExpectedVersion({ expectedVersion: 0 })).toBeUndefined()
  })

  it.each([
    { workoutDate: '2026-02-31' },
    { startTime: '25:00' },
    { startTime: '11:00', endTime: '10:00' },
    { startTime: '10:00', endTime: '10:00:00' },
    { exercises: [{ ...validRequest().exercises[0], source: 'custom' }] },
    { exercises: [{
      ...validRequest().exercises[0],
      sets: [{ ...validRequest().exercises[0]!.sets[0], rpe: 7.2 }],
    }] },
    { exercises: [
      validRequest().exercises[0],
      { ...validRequest().exercises[0], blockId: WORKOUT_ID },
    ] },
  ])('rejects malformed or ambiguous aggregate values', (patch) => {
    expect(readSavePlannedWorkoutRequest({
      ...validRequest(),
      ...patch,
    }, null)).toBeUndefined()
  })
})
