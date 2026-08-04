import type { HealthDataType, HealthSample } from '@capgo/capacitor-health'
import { describe, expect, it, vi } from 'vitest'
import { loadWearableSnapshot, type WearableHealthSource } from './health-source'

function sample(dataType: HealthDataType, value: number, endDate: string, extra: Partial<HealthSample> = {}): HealthSample {
  return { dataType, value, unit: dataType === 'heartRateVariability' ? 'millisecond' : dataType === 'calories' ? 'kilocalorie' : dataType === 'steps' ? 'count' : dataType === 'sleep' ? 'minute' : 'bpm', startDate: endDate, endDate, sourceName: 'Apple Watch', ...extra }
}

describe('loadWearableSnapshot', () => {
  it('combines daily activity with the latest recovery values', async () => {
    const values: Partial<Record<HealthDataType, HealthSample[]>> = {
      steps: [sample('steps', 1200, '2026-08-03T08:00:00.000Z'), sample('steps', 800, '2026-08-03T10:00:00.000Z')],
      calories: [sample('calories', 321.4, '2026-08-03T10:00:00.000Z')],
      sleep: [sample('sleep', 360, '2026-08-03T06:00:00.000Z', { sleepState: 'asleep' }), sample('sleep', 25, '2026-08-03T06:30:00.000Z', { sleepState: 'awake' })],
      restingHeartRate: [sample('restingHeartRate', 58, '2026-08-02T09:00:00.000Z'), sample('restingHeartRate', 55, '2026-08-03T09:00:00.000Z')],
      heartRateVariability: [sample('heartRateVariability', 42.26, '2026-08-03T07:00:00.000Z')],
    }
    const source: WearableHealthSource = { availability: vi.fn(), authorize: vi.fn(), read: vi.fn((type: HealthDataType) => Promise.resolve(values[type] ?? [])) }
    const result = await loadWearableSnapshot(source, new Date('2026-08-03T12:00:00.000Z'))
    expect(result).toMatchObject({ steps: 2000, activeCaloriesKcal: 321, sleepMinutes: 360, restingHeartRateBpm: 55, heartRateVariabilityMs: 42.3, sources: ['Apple Watch'] })
  })

  it('represents missing permissions or samples as unavailable metrics', async () => {
    const source: WearableHealthSource = { availability: vi.fn(), authorize: vi.fn(), read: vi.fn(() => Promise.resolve([])) }
    const result = await loadWearableSnapshot(source, new Date('2026-08-03T12:00:00.000Z'))
    expect(result).toMatchObject({ steps: null, activeCaloriesKcal: null, sleepMinutes: null, restingHeartRateBpm: null, heartRateVariabilityMs: null, sources: [] })
  })
})
