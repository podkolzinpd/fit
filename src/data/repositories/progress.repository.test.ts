import { describe, expect, it } from 'vitest'
import { roundMetric } from './progress-rules'

describe('roundMetric', () => {
  it('округляет до точности БД', () => expect(roundMetric(1.23456)).toBe(1.235))
})
