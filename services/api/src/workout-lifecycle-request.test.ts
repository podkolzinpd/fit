import { describe, expect, it } from 'vitest'

import {
  readRescheduleWorkoutRequest,
  readWorkoutCommentRequest,
} from './workout-lifecycle-request.js'

describe('workout lifecycle request', () => {
  it('normalizes reschedule calendar values and optional time', () => {
    expect(readRescheduleWorkoutRequest({
      expectedVersion: 3,
      workoutDate: '2026-08-27',
      startTime: '',
    })).toEqual({
      expectedVersion: 3,
      workoutDate: '2026-08-27',
      startTime: null,
    })
  })

  it.each([
    { expectedVersion: 0, workoutDate: '2026-08-27', startTime: null },
    { expectedVersion: 1, workoutDate: '2026-02-31', startTime: null },
    { expectedVersion: 1, workoutDate: '2026-08-27', startTime: '24:00' },
  ])('rejects invalid reschedule values', (request) => {
    expect(readRescheduleWorkoutRequest(request)).toBeUndefined()
  })

  it('trims a client comment and permits clearing it', () => {
    expect(readWorkoutCommentRequest({
      comment: '  Было тяжело  ',
      expectedVersion: 4,
    })).toEqual({ comment: 'Было тяжело', expectedVersion: 4 })
    expect(readWorkoutCommentRequest({
      comment: '   ',
      expectedVersion: 5,
    })).toEqual({ comment: '', expectedVersion: 5 })
  })

  it('rejects oversized and unversioned comments', () => {
    expect(readWorkoutCommentRequest({
      comment: 'a'.repeat(5_001),
      expectedVersion: 1,
    })).toBeUndefined()
    expect(readWorkoutCommentRequest({ comment: 'ok' })).toBeUndefined()
  })
})
