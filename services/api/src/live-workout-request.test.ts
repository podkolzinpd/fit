import { describe, expect, it } from 'vitest'

import {
  readLiveCommentRequest,
  readLiveExerciseRequest,
  readLiveOperationRequest,
  readLiveReorderRequest,
  readLiveSetRequest,
} from './live-workout-request.js'

const operationId = '9a69ea77-cab3-4ea6-b3f2-76593d03c084'

describe('live workout request validation', () => {
  it('reads an operation identity and expected version', () => {
    expect(readLiveOperationRequest({ operationId, expectedVersion: 3 }))
      .toEqual({ operationId, expectedVersion: 3 })
  })

  it('normalizes omitted live-set metrics to null', () => {
    expect(readLiveSetRequest({
      operationId,
      expectedVersion: 4,
      draft: { weightKg: 42.5, reps: 10, rpe: 7.5 },
    })).toEqual({
      operationId,
      expectedVersion: 4,
      draft: {
        weightKg: 42.5,
        reps: 10,
        durationMin: null,
        durationSec: null,
        distanceKm: null,
        rpe: 7.5,
      },
    })
  })

  it.each([
    { operationId: 'not-a-uuid', expectedVersion: 1 },
    { operationId, expectedVersion: 0 },
    { operationId, expectedVersion: 1.5 },
  ])('rejects malformed operation input', (body) => {
    expect(readLiveOperationRequest(body)).toBeUndefined()
  })

  it.each([
    { weightKg: -1 },
    { reps: 1.5 },
    { durationSec: -1 },
    { distanceKm: Number.POSITIVE_INFINITY },
    { rpe: 5.5 },
    { rpe: 7.25 },
  ])('rejects invalid set metrics', (draft) => {
    expect(readLiveSetRequest({ operationId, expectedVersion: 1, draft }))
      .toBeUndefined()
  })

  it('normalizes structural exercise, reorder and comment requests', () => {
    expect(readLiveExerciseRequest({
      operationId,
      expectedVersion: 4,
      exercise: {
        source: 'system',
        ref: '  squat  ',
        customExerciseId: null,
        name: '  Приседание  ',
        muscleGroup: 'legs',
        inputKind: 'strength',
      },
    })).toEqual({
      operationId,
      expectedVersion: 4,
      exercise: {
        source: 'system',
        ref: 'squat',
        customExerciseId: null,
        name: 'Приседание',
        muscleGroup: 'legs',
        inputKind: 'strength',
      },
    })
    expect(readLiveReorderRequest({
      operationId,
      expectedVersion: 5,
      direction: -1,
    })).toEqual({ operationId, expectedVersion: 5, direction: -1 })
    expect(readLiveCommentRequest({
      operationId,
      expectedVersion: 6,
      comment: '  Держи спину  ',
    })).toEqual({
      operationId,
      expectedVersion: 6,
      comment: 'Держи спину',
    })
    expect(readLiveCommentRequest({
      operationId,
      expectedVersion: 6,
      comment: '   ',
    })?.comment).toBe('')
  })

  it.each([
    {
      exercise: {
        source: 'system',
        ref: 'squat',
        customExerciseId: operationId,
        name: 'Приседание',
        muscleGroup: 'legs',
        inputKind: 'strength',
      },
    },
    {
      exercise: {
        source: 'custom',
        ref: 'custom',
        customExerciseId: null,
        name: 'Моё упражнение',
        muscleGroup: 'other',
        inputKind: 'reps',
      },
    },
    { direction: 0 },
    { comment: 42 },
  ])('rejects malformed structural request %#', (payload) => {
    const request = { operationId, expectedVersion: 1, ...payload }
    const result = 'exercise' in payload
      ? readLiveExerciseRequest(request)
      : 'direction' in payload
        ? readLiveReorderRequest(request)
        : readLiveCommentRequest(request)
    expect(result).toBeUndefined()
  })
})
