import { describe, expect, it } from 'vitest'
import { localDate } from '../../shared/local-date'
import type { RunningProgressSession } from '../../shared/domain'
import { comparablePaceInsight, formatRunningDuration, formatRunningPace, runningProgressView } from './running-progress'

function session(overrides: Partial<RunningProgressSession> = {}): RunningProgressSession {
  return {
    workoutId: crypto.randomUUID(),
    workoutDate: localDate('2026-08-01'),
    format: 'easy',
    distanceKm: 5,
    durationSec: 1800,
    paceSecPerKm: 360,
    rpe: 7,
    ...overrides,
  }
}

describe('running progress view', () => {
  it('aggregates runs, distance, duration, weighted pace and RPE', () => {
    expect(runningProgressView([
      session(),
      session({ workoutDate: localDate('2026-08-08'), distanceKm: 10, durationSec: 3300, paceSecPerKm: 330, rpe: 8 }),
    ])).toMatchObject({
      runCount: 2,
      totalDistanceKm: 15,
      totalDurationSec: 5100,
      averagePaceSecPerKm: 340,
      averageRpe: 7.5,
      latestRpe: 8,
    })
  })

  it('compares pace only for the same format and a close distance', () => {
    const insight = comparablePaceInsight([
      session({ workoutDate: localDate('2026-08-01'), paceSecPerKm: 360, distanceKm: 5 }),
      session({ workoutDate: localDate('2026-08-08'), format: 'tempo', paceSecPerKm: 300, distanceKm: 5 }),
      session({ workoutDate: localDate('2026-08-15'), paceSecPerKm: 342, distanceKm: 5.5 }),
    ])
    expect(insight).toEqual({ format: 'easy', changePercent: 5 })
  })

  it('does not compare a short run with a much longer run', () => {
    expect(comparablePaceInsight([
      session({ workoutDate: localDate('2026-08-01'), distanceKm: 3 }),
      session({ workoutDate: localDate('2026-08-08'), distanceKm: 10, paceSecPerKm: 330 }),
    ])).toBeUndefined()
  })

  it('formats compact readable time and pace', () => {
    expect(formatRunningDuration(5400)).toBe('1 ч 30 мин')
    expect(formatRunningPace(365.4)).toBe('6:05')
  })
})
