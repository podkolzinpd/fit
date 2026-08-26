import { describe, expect, it } from 'vitest'
import type { ProgressEntry, PublishedTrainingSummary, TrainingProgressFact, Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { clientProgressPresentation } from './client-progress-presentation'

function summary(progressFacts: TrainingProgressFact[] = []): PublishedTrainingSummary {
  return {
    id: 'published-1', sourceSummaryId: 'summary-1', clientId: 'client-1',
    periodStart: localDate('2026-07-24'), periodEnd: localDate('2026-08-24'),
    summary: { headline: 'Итог', achievements: [], consistency: 'Ритм', encouragement: 'Поддержка' },
    metrics: { completedWorkouts: 3, workoutsPerWeek: 1, activeWeeks: 3, longestGapDays: 5, progressFacts },
    generatedAt: '2026-08-24T18:00:00Z', publishedAt: '2026-08-24T18:05:00Z',
  }
}

function workout(id: string, date: string, confirmed: number, planned = confirmed): Workout {
  return {
    id, clientId: 'client-1', clientName: 'Антон', workoutDate: localDate(date), startTime: null, endTime: null,
    startedAt: null, completedAt: `${date}T10:00:00Z`, status: 'done', notes: null, stageId: null,
    stageTitle: null, version: 1, exercises: [{
      id: `${id}-exercise`, source: 'system', ref: 'dumbbell-press', name: 'Жим гантелей лёжа',
      muscleGroup: 'chest', inputKind: 'strength', position: 0,
      blockId: `${id}-block`, blockType: 'single', blockPreset: 'set', blockRounds: 1,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 60,
      sets: Array.from({ length: planned }, (_, index) => ({
        id: `${id}-set-${index}`, position: index, weightKg: 20, reps: 10, fact: { weightKg: 20, reps: 10 },
        confirmedAt: index < confirmed ? `${date}T10:0${index}:00Z` : null, version: 1,
      })),
    }],
  }
}

describe('clientProgressPresentation', () => {
  it('compares real workouts and confirmed sets with the previous period', () => {
    const result = clientProgressPresentation(summary(), {
      currentWorkouts: [workout('current-1', '2026-08-03', 3), workout('current-2', '2026-08-10', 3)],
      previousWorkouts: [workout('previous-1', '2026-07-10', 2)],
    })

    expect(result.comparison?.items).toEqual(expect.arrayContaining([
      { value: '+1', label: 'тренировка к предыдущему периоду', tone: 'positive' },
      { value: '+4', label: 'подтверждённых подходов к предыдущему периоду', tone: 'positive' },
    ]))
    expect(result.stats.slice(0, 2)).toEqual([
      { value: '2', label: 'тренировки' },
      { value: '2', label: 'недели с тренировками' },
    ])
  })

  it('shows factual measurement movement and plan completion for the saved goal', () => {
    const measurements: ProgressEntry[] = [{
      id: 'm1', clientId: 'client-1', createdBy: 'client-1', recordedOn: localDate('2026-07-24'),
      weightKg: 80, customMetrics: [], version: 1,
    }, {
      id: 'm2', clientId: 'client-1', createdBy: 'client-1', recordedOn: localDate('2026-08-24'),
      weightKg: 81.5, customMetrics: [], version: 1,
    }, {
      id: 'm3', clientId: 'client-1', createdBy: 'client-1', recordedOn: localDate('2026-08-25'),
      weightKg: 90, customMetrics: [], version: 1,
    }]
    const result = clientProgressPresentation(summary(), {
      profileGoal: 'Набрать мышечную массу и улучшить грудь', measurements,
      currentWorkouts: [workout('current', '2026-08-03', 2, 3)],
    })

    expect(result.goal).toEqual({
      title: 'Набрать мышечную массу и улучшить грудь',
      evidence: ['Вес: 80 → 81,5 кг (+1,5 кг)', 'Целевые мышцы получили 2 подтверждённых подхода; в плане было 3.'],
    })
  })

  it('uses the exact upcoming plan instead of inventing a recommendation', () => {
    const planned = { ...workout('next', '2026-08-28', 0, 3), status: 'planned' as const, completedAt: null, startTime: '18:30' }
    const result = clientProgressPresentation(summary(), {
      today: localDate('2026-08-26'), upcomingWorkouts: [planned],
    })

    expect(result.nextWorkout).toEqual({
      date: '28 августа 2026 г. · 18:30', title: 'Ближайшая тренировка',
      exercises: [{ name: 'Жим гантелей лёжа', plan: '3 × 20 кг × 10 повт.' }],
    })
  })

  it('does not invent comparison, goal movement or next step without data', () => {
    const result = clientProgressPresentation(summary())
    expect(result.comparison).toBeUndefined()
    expect(result.goal).toBeUndefined()
    expect(result.nextWorkout).toBeUndefined()
  })
})
