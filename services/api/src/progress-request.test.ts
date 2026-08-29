import { describe, expect, it } from 'vitest'

import {
  readVersionedGoalRequest,
  readVersionedGoalStageRequest,
  readVersionedMetricRequest,
  readVersionedProgressRequest,
} from './progress-request.js'

const CLIENT_ID = 'b3942b20-52a2-4d5d-9895-b3b63cf61442'
const RESOURCE_ID = '736e9f0c-634a-42e0-a13b-2c5b070fe5ef'

describe('progress request validation', () => {
  it('normalizes a new atomic progress entry with custom metrics', () => {
    expect(readVersionedProgressRequest({
      draft: {
        clientId: CLIENT_ID,
        recordedOn: '2026-08-25',
        weightKg: 70.25,
        notes: '  После тренировки  ',
        customMetrics: [{ metricId: RESOURCE_ID, value: 18.125 }],
      },
    })).toEqual({
      draft: {
        id: null,
        clientId: CLIENT_ID,
        recordedOn: '2026-08-25',
        weightKg: 70.25,
        chestCm: null,
        waistCm: null,
        hipCm: null,
        notes: 'После тренировки',
        customMetrics: [{ metricId: RESOURCE_ID, value: 18.125 }],
      },
      expectedVersion: null,
    })
  })

  it('requires an optimistic version for updates and rejects invalid measurements', () => {
    expect(readVersionedProgressRequest({
      draft: { id: RESOURCE_ID, clientId: CLIENT_ID, recordedOn: '2026-08-25', customMetrics: [] },
    })).toBeUndefined()
    expect(readVersionedProgressRequest({
      draft: { clientId: CLIENT_ID, recordedOn: '2026-02-30', weightKg: -1, customMetrics: [] },
    })).toBeUndefined()
  })

  it('validates metric, goal and bounded stage contracts', () => {
    expect(readVersionedMetricRequest({
      draft: { clientId: CLIENT_ID, name: '  Процент жира ', unit: ' % ' },
    })?.draft).toEqual({ id: null, clientId: CLIENT_ID, name: 'Процент жира', unit: '%' })
    expect(readVersionedGoalRequest({
      draft: { clientId: CLIENT_ID, title: '10 подтягиваний', targetDate: null },
    })?.draft.targetDate).toBeNull()
    expect(readVersionedGoalRequest({
      draft: {
        clientId: CLIENT_ID, title: 'Держать вес 59 кг', targetDate: null,
        criterion: {
          metric: 'weight', operation: 'maintain_range', rangeMin: 58.5,
          rangeMax: 59.5, unit: 'кг', confirmationStatus: 'confirmed',
        },
      },
    })?.draft.criterion).toMatchObject({
      id: null, version: null, metric: 'weight', operation: 'maintain_range',
      targetValue: null, rangeMin: 58.5, rangeMax: 59.5, unit: 'кг',
      confirmationStatus: 'confirmed', position: 0,
    })
    expect(readVersionedGoalRequest({
      draft: {
        clientId: CLIENT_ID, title: 'Держать вес', targetDate: null,
        criterion: {
          metric: 'weight', operation: 'maintain_range', rangeMin: 60,
          rangeMax: 50, unit: 'кг', confirmationStatus: 'confirmed',
        },
      },
    })).toBeUndefined()
    expect(readVersionedGoalRequest({
      draft: {
        clientId: CLIENT_ID, title: 'Снизить вес', targetDate: null,
        criterion: {
          metric: 'weight', operation: 'change_by', targetValue: -3,
          unit: 'кг', confirmationStatus: 'confirmed',
        },
      },
    })?.draft.criterion).toMatchObject({ operation: 'change_by', targetValue: -3 })
    expect(readVersionedGoalStageRequest({
      draft: {
        goalId: RESOURCE_ID,
        title: 'Первые пять',
        startsOn: '2026-09-01',
        endsOn: '2026-08-31',
      },
    })).toBeUndefined()
  })

  it('accepts a bounded composite goal and rejects invalid linked criteria', () => {
    const parsed = readVersionedGoalRequest({ draft: {
      clientId: CLIENT_ID, title: 'Сильнее и регулярнее', targetDate: null,
      criteria: [
        { metric: 'exercise_reps', operation: 'increase_to', targetValue: 12, unit: 'повт.',
          exerciseSource: 'system', exerciseRef: 'pull-up', exerciseName: 'Подтягивания', confirmationStatus: 'confirmed', position: 0 },
        { metric: 'workout_regularity', operation: 'increase_to', targetValue: 3, unit: 'трен.',
          regularityPeriod: 'week', regularityMode: 'each_period', confirmationStatus: 'confirmed', position: 1 },
      ],
    } })
    expect(parsed?.draft.criteria).toHaveLength(2)
    expect(parsed?.draft.criteria?.[0]).toMatchObject({ exerciseRef: 'pull-up', position: 0 })
    expect(parsed?.draft.criteria?.[1]).toMatchObject({ regularityMode: 'each_period', position: 1 })

    expect(readVersionedGoalRequest({ draft: {
      clientId: CLIENT_ID, title: 'Выдуманное упражнение', targetDate: null,
      criteria: [{ metric: 'exercise_reps', operation: 'increase_to', targetValue: 12, unit: 'повт.',
        exerciseSource: null, exerciseRef: null, exerciseName: null, confirmationStatus: 'confirmed', position: 0 }],
    } })).toBeUndefined()
    expect(readVersionedGoalRequest({ draft: {
      clientId: CLIENT_ID, title: 'Слишком много критериев', targetDate: null,
      criteria: Array.from({ length: 11 }, (_, position) => ({ metric: 'weight', operation: 'track_only', unit: 'кг', confirmationStatus: 'confirmed', position })),
    } })).toBeUndefined()
  })
})
