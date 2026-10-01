import { describe, expect, it } from 'vitest'
import type { WorkoutSet } from '../../shared/domain'
import { liveMetricSources, markLiveMetricEntered } from './live-set-provenance'

const planned = {
  durationSec: 1800, distanceKm: 5, rpe: 7,
  fact: {},
} as WorkoutSet

describe('live set provenance', () => {
  it('does not mistake prefilled planned metrics for entered facts', () => {
    const form = document.createElement('form')
    expect(liveMetricSources(form, planned)).toEqual({ duration: 'planned', distance: 'planned', rpe: 'planned' })
  })

  it('records entry even when the person types the same value as the plan', () => {
    const form = document.createElement('form')
    for (const name of ['durationSec', 'runDistance', 'rpe']) {
      const field = document.createElement('input')
      field.name = name
      markLiveMetricEntered(form, field)
    }
    expect(liveMetricSources(form, planned)).toEqual({ duration: 'entered', distance: 'entered', rpe: 'entered' })
  })

  it('preserves unknown historical values until an actual edit', () => {
    const form = document.createElement('form')
    const historical = { ...planned, fact: { durationSec: 1800, distanceKm: 5, rpe: 7 },
      metricSources: { duration: 'unknown', distance: 'unknown', rpe: 'unknown' } } as WorkoutSet
    expect(liveMetricSources(form, historical)).toEqual({ duration: 'unknown', distance: 'unknown', rpe: 'unknown' })
    const field = document.createElement('input')
    field.name = 'durationSec'
    markLiveMetricEntered(form, field)
    expect(liveMetricSources(form, historical)).toEqual({ duration: 'entered', distance: 'unknown', rpe: 'unknown' })
  })
})
