import { describe, expect, it, vi } from 'vitest'

import type { DatabasePool } from './types.js'
import { DatabaseStageCalorieAuditor } from './workout-calorie-audit.js'

describe('stage calorie audit', () => {
  it('returns aggregates and suppresses magnitude statistics for small cohorts', async () => {
    const release = vi.fn()
    const query = vi.fn().mockResolvedValue([
      {
        category: 'bike', total: '4', estimated: '3', missing_duration: '1',
        missing_weight: '0', high_kcal: '1', more_than_double_v1: '2', median_ratio: '1.85',
      },
      {
        category: 'run', total: '5', estimated: '5', missing_duration: '0',
        missing_weight: '0', high_kcal: '0', more_than_double_v1: '1', median_ratio: '1.14',
      },
    ])
    const pool = {
      connect: () => Promise.resolve({ query, release }),
      end: () => Promise.resolve(),
    } as DatabasePool

    const result = await new DatabaseStageCalorieAuditor(pool).read()
    expect(result).toEqual({
      windowDays: 30,
      categories: [
        {
          category: 'bike', total: 4, estimated: 3, missingDuration: 1,
          missingWeight: 0, highKcal: null, moreThanDoubleV1: null, medianV2ToV1: null,
        },
        {
          category: 'run', total: 5, estimated: 5, missingDuration: 0,
          missingWeight: 0, highKcal: 0, moreThanDoubleV1: 1, medianV2ToV1: 1.14,
        },
      ],
    })
    expect(query).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })
})
