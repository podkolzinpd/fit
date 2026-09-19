import { describe, expect, it } from 'vitest'

import {
  readExpectedVersion,
  readFavoriteWorkoutExercises,
  readFavoriteWorkoutTitle,
  readSavePlannedWorkoutRequest,
} from './planned-workout-request.js'

const WORKOUT_ID = '12acc6d6-7ca8-43cd-b124-b4224c917fae'
const CLIENT_ID = 'b3942b20-52a2-4d5d-9895-b3b63cf61442'
const BLOCK_ID = '8ffdb87b-078c-42d4-b6db-af8bc60f80f2'
const REQUEST_ID = '3d959430-cecf-4c21-9636-2f5727acfd24'
const EXERCISE_ID = '2fc8f3d7-a178-4019-ad62-cf765374ba26'
const SET_ID = '33430010-2b05-42a5-83dc-1ef555f2206d'

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
        stageId: null,
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

  it('keeps idempotency and source identities for completed-workout writes', () => {
    const request = {
      ...validRequest(),
      requestId: REQUEST_ID,
      expectedVersion: 4,
      exercises: [{
        ...validRequest().exercises[0],
        sourceExerciseId: EXERCISE_ID,
        sets: [{
          ...validRequest().exercises[0]!.sets[0],
          sourceSetId: SET_ID,
        }],
      }],
    }
    expect(readSavePlannedWorkoutRequest(request, WORKOUT_ID)).toMatchObject({
      draft: {
        id: WORKOUT_ID,
        requestId: REQUEST_ID,
        exercises: [{
          sourceExerciseId: EXERCISE_ID,
          sets: [{ sourceSetId: SET_ID }],
        }],
      },
      expectedVersion: 4,
    })
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

describe('favorite workout title', () => {
  it('accepts a trimmed non-empty title within the length limit', () => {
    expect(readFavoriteWorkoutTitle(' Ноги и кор ')).toBe('Ноги и кор')
  })

  it.each([undefined, null, 123, '', '   ', 'a'.repeat(121)])('rejects %p', (value) => {
    expect(readFavoriteWorkoutTitle(value)).toBeUndefined()
  })
})

describe('favorite workout exercises', () => {
  it('accepts a valid, position-unique exercise list', () => {
    expect(readFavoriteWorkoutExercises(validRequest().exercises)).toEqual(validRequest().exercises)
  })

  it.each([undefined, null, 'not-an-array', []])('rejects %p', (value) => {
    expect(readFavoriteWorkoutExercises(value)).toBeUndefined()
  })

  it('rejects more than 60 exercises', () => {
    const exercises = Array.from({ length: 61 }, (_, index) => ({ ...validRequest().exercises[0], position: index }))
    expect(readFavoriteWorkoutExercises(exercises)).toBeUndefined()
  })

  it('rejects a malformed exercise the same way the workout request does', () => {
    expect(readFavoriteWorkoutExercises([{ ...validRequest().exercises[0], source: 'custom' }])).toBeUndefined()
  })

  it('rejects duplicate positions', () => {
    const exercise = validRequest().exercises[0]!
    expect(readFavoriteWorkoutExercises([exercise, { ...exercise, blockId: WORKOUT_ID }])).toBeUndefined()
  })
})
