import { describe, expect, it } from 'vitest'
import { liveSessionProgress } from './live-session-progress'

const done = { confirmedAt: '2026-08-19T10:00:00.000Z' }
const pending = { confirmedAt: null }

describe('liveSessionProgress', () => {
  it('показывает текущие упражнение, подход и общий прогресс', () => {
    expect(liveSessionProgress([
      { sets: [done, done] },
      { sets: [done, pending, pending] },
    ])).toEqual({
      activeExerciseNumber: 2,
      exerciseCount: 2,
      activeSetNumber: 2,
      activeExerciseSetCount: 3,
      completedSetCount: 3,
      setCount: 5,
      complete: false,
      percent: 60,
    })
  })

  it('явно сообщает о полностью выполненной тренировке', () => {
    expect(liveSessionProgress([{ sets: [done, done] }])).toMatchObject({
      activeExerciseNumber: 1,
      activeSetNumber: 2,
      completedSetCount: 2,
      setCount: 2,
      complete: true,
      percent: 100,
    })
  })

  it('безопасно обрабатывает пустую тренировку', () => {
    expect(liveSessionProgress([])).toEqual({
      activeExerciseNumber: 0,
      exerciseCount: 0,
      activeSetNumber: 0,
      activeExerciseSetCount: 0,
      completedSetCount: 0,
      setCount: 0,
      complete: false,
      percent: 0,
    })
  })
})
