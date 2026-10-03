import { describe, expect, it } from 'vitest'
import type { Client, TrainerAttentionWorkout, Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { trainerActionItems, trainerDayActionItems, trainerPlanningItems } from './trainer-attention'

const client = { id: 'c1', fullName: 'Анна', archivedAt: null } as Client
const workout = (patch: Partial<Workout>): Workout => ({
  id: 'w1', clientId: 'c1', clientName: 'Анна', workoutDate: localDate('2026-08-20'),
  startTime: null, endTime: null, startedAt: null, completedAt: null, status: 'done',
  notes: null, stageId: null, stageTitle: null, version: 1, exercises: [], ...patch,
})

describe('trainer attention', () => {
  it('keeps every active workout reachable in Lime without counting the same workout twice', () => {
    const active = [workout({ id: 'w1', status: 'in_progress' }), workout({ id: 'w2', status: 'in_progress' })]
    const actions = trainerActionItems([client], active, [{ workoutId: 'w1', clientId: 'c1', clientName: 'Анна', workoutDate: localDate('2026-08-20'), clientQuestion: 'Вопрос', discomfort: false, version: 1 }], localDate('2026-08-21'))
    expect(trainerDayActionItems(actions, [...active, workout({ id: 'done' }), workout({ id: 'cancelled', status: 'cancelled' })])).toEqual([
      expect.objectContaining({ workoutId: 'w1', reason: 'in_progress', actionLabel: 'Продолжить' }),
      expect.objectContaining({ workoutId: 'w2', reason: 'in_progress', actionLabel: 'Продолжить' }),
    ])
    expect(actions[0]?.reason).toBe('question')
  })

  it('keeps one highest-priority action per client', () => {
    const attention: TrainerAttentionWorkout[] = [
      { workoutId: 'w1', clientId: 'c1', clientName: 'Анна', workoutDate: localDate('2026-08-20'), clientQuestion: 'Как дышать?', discomfort: true, clientComment: 'Плечо', version: 2 },
    ]
    expect(trainerActionItems([client], [workout({ status: 'planned', workoutDate: localDate('2026-08-19') })], attention, localDate('2026-08-21'))).toEqual([
      expect.objectContaining({ reason: 'question', actionLabel: 'Ответить', detail: 'Как дышать?' }),
    ])
  })

  it('does not create required action for an ordinary completed workout', () => {
    expect(trainerActionItems([client], [workout({})], [], localDate('2026-08-21'))).toEqual([])
  })

  it('hides planning while snoozed and lets explicit actions override snooze', () => {
    const preferences = [{ clientId: 'c1', snoozedUntil: '2026-09-04T00:00:00.000Z' }]
    expect(trainerPlanningItems([client], [workout({})], preferences, new Set(), localDate('2026-08-21'), new Date('2026-08-21T00:00:00Z'))).toEqual([])
    const actions = trainerActionItems([client], [workout({})], [{
      workoutId: 'w1', clientId: 'c1', clientName: 'Анна', workoutDate: localDate('2026-08-20'),
      clientQuestion: 'Можно заменить упражнение?', discomfort: false, version: 2,
    }], localDate('2026-08-21'))
    expect(actions).toHaveLength(1)
  })

  it('keeps neutral planning copy for a long pause', () => {
    const items = trainerPlanningItems([client], [workout({ workoutDate: localDate('2026-07-01') })], [], new Set(), localDate('2026-08-21'))
    expect(items[0]).toEqual(expect.objectContaining({
      title: 'Следующая тренировка не запланирована',
      detail: 'Последняя тренировка: 2026-07-01',
    }))
  })
})
