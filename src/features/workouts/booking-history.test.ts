import { expect, it } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { historyPlanForAppointment } from './booking-history'

function target(): Workout {
  return { id: 'appointment', clientId: 'athlete', clientName: 'Клиент', workoutDate: localDate('2026-11-02'), startTime: '14:00', endTime: '15:00', title: 'Мой план', notes: 'Заметка записи', stageId: 'goal', stageTitle: null, version: 7, status: 'planned', startedAt: null, completedAt: null, trainingFormat: 'with_trainer', executionMode: 'manual', exercises: [] }
}
function source(): Workout {
  return { ...target(), id: 'history', version: 3, workoutDate: localDate('2026-10-20'), startTime: '09:00', title: 'Прошлая', status: 'done', notes: 'Заметка истории', startedAt: 'then', completedAt: 'then', exercises: [0, 1].map(position => ({ id: `e${position}`, position, source: 'system', ref: `plank${position}`, name: 'Планка', muscleGroup: 'core', inputKind: 'duration', blockId: 'old-block', blockType: 'group', blockPreset: 'set', blockRounds: 2, restBetweenExercisesSec: 10, restBetweenRoundsSec: 90, restBetweenSetsSec: 30, trainerComment: 'Сохранять корпус', sets: [0, 1].map(index => ({ id: `s${position}${index}`, position: index, durationMin: 2, fact: { durationSec: 45 + index * 15 }, confirmedAt: 'then', version: 3 })) })) }
}
it('fills the same appointment with factual values as plan, keeping structure and target identity', () => {
  const current = target(), historical = source(), snapshot = structuredClone(historical)
  const result = historyPlanForAppointment(current, historical)
  expect(result).toMatchObject({ id: current.id, clientId: current.clientId, version: 7, workoutDate: current.workoutDate, startTime: '14:00', endTime: '15:00', title: 'Мой план', notes: 'Заметка записи', stageId: 'goal', trainingFormat: 'with_trainer', executionMode: 'manual' })
  expect(result.exercises.map(item => item.blockId)).toEqual([result.exercises[0]!.blockId, result.exercises[0]!.blockId])
  expect(result.exercises[0]!.blockId).not.toBe('old-block')
  expect(result.exercises[0]).toMatchObject({ blockType: 'group', blockRounds: 2, restBetweenRoundsSec: 90, restBetweenExercisesSec: 10, trainerComment: 'Сохранять корпус' })
  expect(result.exercises[0]!.sets).toEqual([{ position: 0, durationSec: 45, durationMin: undefined }, { position: 1, durationSec: 60, durationMin: undefined }].map(set => ({ ...set, weightKg: undefined, reps: undefined, distanceKm: undefined, rpe: undefined })))
  expect(historical).toEqual(snapshot)
  expect(current.exercises).toEqual([])
})
it('rejects another client or non-completed source and an already started target', () => {
  expect(() => historyPlanForAppointment(target(), { ...source(), clientId: 'other' })).toThrow()
  expect(() => historyPlanForAppointment(target(), { ...source(), status: 'planned' })).toThrow()
  expect(() => historyPlanForAppointment({ ...target(), status: 'in_progress' }, source())).toThrow()
})

it('inherits a source title only when the target has no explicitly named appointment', () => {
  const history = source()
  for (const title of [undefined, null, '', '  ']) {
    expect(historyPlanForAppointment({ ...target(), title }, history).title).toBe(history.title)
  }
  const result = historyPlanForAppointment({ ...target(), title: 'Ноги на завтра' }, history)
  expect(result.title).toBe('Ноги на завтра')
  result.title = 'Новая запись'
  expect(history.title).toBe('Прошлая')
})
