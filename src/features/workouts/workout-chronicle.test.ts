import { describe, expect, it } from 'vitest'
import type { WorkoutSet } from '../../shared/domain'
import { calendarExerciseResult, chronicleExercisePreview, workoutDisplayTitle, workoutExerciseBrief } from './workout-chronicle'

describe('chronicleExercisePreview', () => {
  it('оставляет в карточке истории только два первых упражнения', () => {
    expect(chronicleExercisePreview(['Жим', 'Тяга', 'Планка'])).toEqual({
      visible: ['Жим', 'Тяга'],
      hiddenCount: 1,
    })
  })

  it('не добавляет счётчик, когда все упражнения помещаются', () => {
    expect(chronicleExercisePreview(['Бег', 'Заминка'])).toEqual({
      visible: ['Бег', 'Заминка'],
      hiddenCount: 0,
    })
  })

  it('безопасно обрабатывает пустую тренировку', () => {
    expect(chronicleExercisePreview([])).toEqual({ visible: [], hiddenCount: 0 })
  })
})

function recordedSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return { id: 'set-1', position: 0, fact: {}, confirmedAt: null, version: 1, ...overrides }
}

describe('calendarExerciseResult', () => {
  it('leaves absent, unconfirmed and empty facts unnamed instead of claiming a missed exercise', () => {
    for (const sets of [[], [recordedSet({ weightKg: 80, reps: 10 })], [recordedSet({ fact: { reps: 12 } })], [recordedSet({ confirmedAt: '2026-10-02T10:00:00Z', weightKg: 80, reps: 10 })]]) {
      expect(calendarExerciseResult({ ref: 'squat', sets })).toBeNull()
    }
  })

  it('compacts matching recorded sets without filling missing fact fields from the plan', () => {
    const sets = [0, 1, 2].map((position) => recordedSet({ position, weightKg: 80, reps: 10, confirmedAt: '2026-10-02T10:00:00Z', fact: { reps: 8 } }))
    expect(calendarExerciseResult({ ref: 'squat', sets })).toBe('3 × 8 повт.')
  })

  it('keeps different facts in order and omits unrecorded sets without an invented skip count', () => {
    const sets = [
      recordedSet({ confirmedAt: '2026-10-02T10:00:00Z', fact: { weightKg: 40, reps: 12 } }),
      recordedSet({ confirmedAt: '2026-10-02T10:01:00Z', fact: { weightKg: 45, reps: 10 } }),
      recordedSet({ weightKg: 50, reps: 10 }),
    ]
    expect(calendarExerciseResult({ ref: 'squat', sets })).toBe('40 кг × 12 повт. · 45 кг × 10 повт.')
  })

  it('retains recorded timed, cardio and bodyweight results through the existing formatter', () => {
    expect(calendarExerciseResult({ ref: 'plank', sets: [recordedSet({ confirmedAt: '2026-10-02T10:00:00Z', fact: { durationSec: 90 } })] })).toBe('1:30')
    expect(calendarExerciseResult({ ref: 'running', sets: [recordedSet({ confirmedAt: '2026-10-02T10:00:00Z', fact: { distanceKm: 5, durationSec: 1800 } })] })).toContain('5 км × 30:00')
    expect(calendarExerciseResult({ ref: 'push-up', sets: [recordedSet({ confirmedAt: '2026-10-02T10:00:00Z', fact: { weightKg: 0, reps: 15 } })] })).toBe('15 повт.')
  })
})

describe('shared workout title and brief', () => {
  it('keeps a real title ahead of a favorite snapshot and uses a display-only fallback', () => {
    expect(workoutDisplayTitle({ title: '  Спина  ', favoriteTitle: 'Источник' })).toBe('Спина')
    expect(workoutDisplayTitle({ title: null, favoriteTitle: 'Источник' })).toBe('Источник')
    expect(workoutDisplayTitle({ title: '  ', favoriteTitle: '  ' })).toBe('Тренировка')
  })
  it('shows the same first three names and remaining count without plan/result guesses', () => {
    const names = ['Присед', 'Тяга', 'Планка', 'Бег', 'Жим'].map(name => ({ name }))
    expect(workoutExerciseBrief(names)).toBe('Присед · Тяга · Планка · ещё 2')
    expect(workoutExerciseBrief(names.slice(0, 3))).toBe('Присед · Тяга · Планка')
    expect(workoutExerciseBrief([])).toBe('Без упражнений')
  })
})
