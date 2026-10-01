import { describe, expect, it } from 'vitest'
import { calorieRolloutBucket, calorieRolloutPercent, publishedWorkoutCalories, type WorkoutCalorieEstimateRow } from './workout-calorie-rollout.js'

const current: WorkoutCalorieEstimateRow = {
  id: '00000000-0000-4000-8000-000000000001', status: 'done',
  active_calories_kcal: 270, calorie_v2_shadow_kcal: 425,
  calorie_v2_shadow_reason: null,
  calorie_v2_shadow_details: { segments: [{ activity: 'stationary-bike', speedKmh: null }] },
  calorie_v2_shadow_at: new Date('2026-10-01T12:00:00Z'),
}

describe('workout calorie rollout', () => {
  it('defaults off and rejects ambiguous configuration', () => {
    expect(calorieRolloutPercent({})).toBe(0)
    expect(calorieRolloutPercent({ FIT_CALORIE_V2_ROLLOUT_PERCENT: '100' })).toBe(100)
    expect(() => calorieRolloutPercent({ FIT_CALORIE_V2_ROLLOUT_PERCENT: '101' })).toThrow()
    expect(() => calorieRolloutPercent({ FIT_CALORIE_V2_ROLLOUT_PERCENT: '10%' })).toThrow()
  })

  it('selects a stable cohort and preserves v1 until enabled', () => {
    expect(calorieRolloutBucket(current.id)).toBe(calorieRolloutBucket(current.id))
    expect(publishedWorkoutCalories(current, 0)).toMatchObject({ kcal: 270, version: 1 })
    expect(publishedWorkoutCalories(current, 100)).toEqual({
      kcal: 425, version: 2,
      basis: 'По фактическому времени; интенсивность приблизительная',
      notice: null,
    })
  })

  it('explains pace and withholds unsupported results', () => {
    expect(publishedWorkoutCalories({ ...current,
      calorie_v2_shadow_details: { segments: [{ activity: 'running', speedKmh: 10 }] },
    }, 100).basis).toBe('По фактическому времени и темпу')
    expect(publishedWorkoutCalories({ ...current,
      calorie_v2_shadow_kcal: null, calorie_v2_shadow_reason: 'missing_activity_duration',
    }, 0)).toEqual({ kcal: null, version: null, basis: null,
      notice: 'Для оценки добавьте фактическое время кардио.' })
    expect(publishedWorkoutCalories({ ...current,
      calorie_v2_shadow_at: null, calorie_v2_shadow_kcal: null,
    }, 100)).toMatchObject({ kcal: 270, version: 1 })
  })
})
