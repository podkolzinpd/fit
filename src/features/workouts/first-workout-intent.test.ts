import { beforeEach, describe, expect, it } from 'vitest'
import { storeFirstWorkoutIntent, takeFirstWorkoutIntent } from './first-workout-intent'

describe('first workout intent', () => {
  beforeEach(() => sessionStorage.clear())

  it('transfers a voice transcript exactly once', () => {
    storeFirstWorkoutIntent('user-1', { mode: 'voice', transcript: 'Присед 3 по 10' })
    expect(takeFirstWorkoutIntent('user-1')).toEqual({ mode: 'voice', transcript: 'Присед 3 по 10' })
    expect(takeFirstWorkoutIntent('user-1')).toBeNull()
  })

  it('transfers the text composer intent', () => {
    storeFirstWorkoutIntent('user-1', { mode: 'text' })
    expect(takeFirstWorkoutIntent('user-1')).toEqual({ mode: 'text' })
  })
})
