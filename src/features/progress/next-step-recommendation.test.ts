import { describe, expect, it } from 'vitest'
import type { ClientProgressPresentation } from './client-progress-presentation'
import { buildProgressNextStep } from './next-step-recommendation'

type Goal = NonNullable<ClientProgressPresentation['goal']>

function configuredGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    title: 'Держать вес 59 кг', state: 'configured', statusLabel: 'Ориентир достигнут',
    totalCriteria: 1, completedCriteria: 1,
    criteria: [{
      id: 'weight', label: 'Вес', target: '59 кг', status: 'Ориентир достигнут',
      current: '59 кг', dynamics: '59 → 59 кг · положение не изменилось',
      freshness: 'Свежие данные · сегодня', sufficiency: 'Достаточно для динамики периода',
      dataOwner: 'measurement', action: null,
    }],
    ...overrides,
  }
}

const base = {
  completedWorkouts: 4,
  activeWeeks: 3,
  totalWeeks: 4,
  role: 'client' as const,
}

describe('buildProgressNextStep', () => {
  it('keeps a missing goal as the critical deterministic action', () => {
    const result = buildProgressNextStep({ ...base, llmSuggestions: ['Запланировать ближайшую тренировку.'] })
    expect(result.recommendation.action).toBe('clarify_criterion')
    expect(result.recommendation.source).toBe('deterministic')
  })

  it('asks for the exact missing measurement before lower-priority actions', () => {
    const goal = configuredGoal({
      statusLabel: 'Нужны данные',
      criteria: [{
        ...configuredGoal().criteria![0]!, current: 'Нет данных', status: 'Нужны данные',
        freshness: 'Нет данных', sufficiency: 'Нет замеров', action: 'measurement',
      }],
    })
    const result = buildProgressNextStep({ ...base, goal })
    expect(result.recommendation.action).toBe('add_measurement')
    expect(result.recommendation.evidence).toBe('Нет данных · Нет замеров')
  })

  it('lets a grounded LLM suggestion select one admissible metric action', () => {
    const result = buildProgressNextStep({
      ...base,
      goal: configuredGoal(),
      nextWorkout: { id: 'workout-1', date: '02.09.2026 · 07:10', title: 'Ноги', exercises: [] },
      llmSuggestions: ['Отследить вес 59 кг в следующем сопоставимом замере.'],
    })
    expect(result.recommendation.action).toBe('check_metric')
    expect(result.recommendation.source).toBe('llm')
    expect(result.recommendation.title).toBe('Отследить вес 59 кг в следующем сопоставимом замере.')
  })

  it('rejects an LLM prescription that changes the program', () => {
    const result = buildProgressNextStep({
      ...base,
      goal: configuredGoal(),
      llmSuggestions: ['Увеличить нагрузку и изменить программу.'],
    })
    expect(result.recommendation.action).toBe('check_metric')
    expect(result.recommendation.source).toBe('deterministic')
  })

  it('rejects numbers that are absent from verified candidates', () => {
    const result = buildProgressNextStep({
      ...base,
      goal: configuredGoal(),
      llmSuggestions: ['Отследить вес 83 кг в следующем замере.'],
    })
    expect(result.recommendation.source).toBe('deterministic')
    expect(result.recommendation.title).not.toContain('83')
  })

  it('offers planning when a workout result is needed and no plan exists', () => {
    const goal = configuredGoal({ criteria: [{ ...configuredGoal().criteria![0]!, dataOwner: 'workout', action: 'workout' }] })
    const result = buildProgressNextStep({ ...base, goal })
    expect(result.recommendation.action).toBe('schedule_workout')
  })

  it('can select an existing workout and keeps rhythm and discussion as alternatives', () => {
    const goal = configuredGoal({ criteria: [{ ...configuredGoal().criteria![0]!, dataOwner: 'workout', action: 'workout' }] })
    const result = buildProgressNextStep({
      ...base,
      goal,
      nextWorkout: { id: 'workout-1', date: '02.09.2026 · 07:10', title: 'Ноги', exercises: [{ name: 'Приседания' }] },
      llmSuggestions: ['Открыть ближайшую тренировку.'],
    })
    expect(result.recommendation.action).toBe('open_workout')
    expect(result.recommendation.targetId).toBe('workout-1')
    expect(result.alternatives.map((item) => item.action)).toEqual(expect.arrayContaining([
      'continue_rhythm', 'discuss_with_trainer',
    ]))
  })
})
