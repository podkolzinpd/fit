import { expect, it } from 'vitest'
import { fixture } from './fixtures.js'
import { buildProgramHistoryContext } from './context.js'
import { deriveProgramLoad } from './load.js'
import { materializeProgram } from './generate.js'
import { editProgram } from './edit.js'

function setup() {
  const { brief, template } = fixture(3)
  const context = buildProgramHistoryContext({ clientId: 'client', periodStart: '2026-07-22', periodEnd: '2026-09-15', workouts: [], exercises: [], sets: [] })
  const payload = { ...materializeProgram(template, brief, 'client', 'program'), template, loadBasis: deriveProgramLoad(brief, context.context, '2026-09-15') }
  return { brief, payload }
}
it('changes one dated exercise and preserves every other workout and request ID', () => {
  const { brief, payload } = setup()
  const date = payload.sessions[0]!.day
  const edited = editProgram(`Измени упражнение 1 в занятии ${date}; область: только это занятие; упражнение: Жим ногами в тренажёре; подходы: 2; повторы: 7; секунды: нет; усилие: 6.5; отдых: 90.`, payload, brief, 'client', '2026-09-15')
  expect(edited.canonicalWorkouts.slice(1)).toEqual(payload.canonicalWorkouts.slice(1))
  expect(edited.canonicalWorkouts[0]!.requestId).toBe(payload.canonicalWorkouts[0]!.requestId)
  expect(edited.canonicalWorkouts[0]!.exercises.slice(1)).toEqual(payload.canonicalWorkouts[0]!.exercises.slice(1))
  expect(payload.canonicalWorkouts[0]!.exercises[0]!.sets[0]).toHaveProperty('reps', 8)
})
it('replaces an exercise only in the explicitly selected day across weeks', () => {
  const { brief, payload } = setup()
  const date = payload.sessions[0]!.day
  const edited = editProgram(`Измени упражнение 1 в занятии ${date}; область: этот день во всех неделях; упражнение: Приседания без веса; подходы: 2; повторы: 8; секунды: нет; усилие: 6.5; отдых: 90.`, payload, brief, 'client', '2026-09-15')
  expect(edited.canonicalWorkouts.filter((workout) => workout.exercises[0]!.ref === 'fedb-bodyweight-squat')).toHaveLength(4)
})
it('rejects an invalid dose without mutating the previous draft', () => {
  const { brief, payload } = setup(); const before = structuredClone(payload)
  expect(() => editProgram(`Измени упражнение 1 в занятии ${payload.sessions[0]!.day}; область: только это занятие; упражнение: Жим ногами в тренажёре; подходы: 99; повторы: 8; секунды: нет; усилие: 6.5; отдых: 90.`, payload, brief, 'client', '2026-09-15')).toThrow()
  expect(payload).toEqual(before)
})
