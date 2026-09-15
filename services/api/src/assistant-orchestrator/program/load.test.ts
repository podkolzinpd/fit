import { describe, expect, it } from 'vitest'
import { buildProgramHistoryContext, type ProgramContextSource } from './context.js'
import { fixture } from './fixtures.js'
import { addDays, materializeProgram, prescribeProgram, validateProgramLoad } from './generate.js'
import { deriveProgramLoad, programLoadIssues } from './load.js'

function history(options: { last?: string; sets?: number; weeks?: number; frequency?: number; ref?: string; source?: 'system' | 'custom'; reps?: number | null; confirmed?: boolean } = {}) {
  const workouts: ProgramContextSource['workouts'][number][] = []
  const exercises: ProgramContextSource['exercises'][number][] = []
  const sets: ProgramContextSource['sets'][number][] = []
  for (let week = 0; week < (options.weeks ?? 4); week++) for (let day = 0; day < (options.frequency ?? 3); day++) {
    const id = `${week}-${day}`
    const date = addDays(options.last ?? '2026-09-14', -7 * week - day * 2)
    workouts.push({ id, clientId: 'client', date, status: 'done', deletedAt: null, sessionRpe: 7, wellbeing: 'normal', discomfort: false })
    exercises.push({ id, workoutId: id, source: options.source ?? 'system', ref: options.ref ?? 'leg-press', position: 0 })
    for (let index = 0; index < (options.sets ?? 15); index++) sets.push({ id: `${id}-${index}`, exerciseId: id, position: index,
      confirmedAt: options.confirmed === false ? null : `${date}T10:00:00Z`, factReps: options.reps === undefined ? 8 : options.reps,
      factWeightKg: 20, factDurationSec: null, factDistanceKm: null, factRpe: 7 })
  }
  return buildProgramHistoryContext({ clientId: 'client', periodStart: '2026-07-22', periodEnd: '2026-09-15', workouts, exercises, sets }).context
}
function selection(frequency: number) {
  return { days: Object.fromEntries(Array.from({ length: frequency }, (_, index) => [`day${index + 1}`, {
    squat: 'leg-press', hinge: 'fedb-butt-lift-bridge', horizontal_push: 'push-ups', horizontal_pull: 'seated-cable-row', core: 'plank', accessory: null,
  }])) }
}

describe('observed history drives numerical prescriptions', () => {
  it('uses full facts, not the last three displayed executions or a partial calendar week', () => {
    const { brief } = fixture()
    const context = history()
    expect(context.exercises[0]!.recentExecutions).toHaveLength(3)
    const load = deriveProgramLoad(brief, context, '2026-09-15')
    expect(load.weeks.map((week) => week.catalogSets)).toEqual([45, 45, 45, 45])
    expect(load.meanWeeklyWorkouts).toBe(3)
    expect(load.meanWeeklyCatalogSets).toBe(45)
    expect(load.weeklySetCeiling).toBe(45)
    expect(load.familiarRefs).toContain('leg-press')
  })
  it('changes sets, effort and progression for the same goal and selected exercises after a recorded gap', () => {
    const { brief } = fixture(); brief.experience = 'experienced'
    const regular = deriveProgramLoad(brief, history(), '2026-09-15')
    const stale = deriveProgramLoad(brief, history({ last: '2026-08-15' }), '2026-09-15')
    const a = prescribeProgram(selection(3), brief, '2026-09-15', regular)
    const b = prescribeProgram(selection(3), brief, '2026-09-15', stale)
    expect(a.sessions[0]!.exercises[0]!.weeks[0]).toMatchObject({ sets: 3, rpe: 7 })
    expect(b.sessions[0]!.exercises[0]!.weeks[0]).toMatchObject({ sets: 2, rpe: 6.5 })
    expect(a.sessions[0]!.exercises[0]!.weeks.map((week) => week.reps)).toEqual([8, 9, 10, 10])
    expect(b.sessions[0]!.exercises[0]!.weeks.map((week) => week.reps)).toEqual([8, 8, 9, 9])
    expect(b.rationale).toContain('2026-08-15')
  })
  it('honors an explicit return from a break even when recent records exist', () => {
    const { brief } = fixture(); brief.experience = 'returning'
    const load = deriveProgramLoad(brief, history(), '2026-09-15')
    expect(load).toMatchObject({ mode: 'starting', maxSetsPerExercise: 2, rpe: 6.5 })
    expect(load.summary).toContain('В анкете указан возврат')
  })
  it('rejects a generator response that ignores the starting progression', () => {
    const { brief } = fixture()
    const load = deriveProgramLoad(brief, history({ weeks: 0 }), '2026-09-15')
    const result = prescribeProgram(selection(3), brief, '2026-09-15', load)
    result.sessions[0]!.exercises[0]!.weeks[1]!.reps = 9
    expect(() => validateProgramLoad(result, load)).toThrow('program_validation_failed')
  })
  it('caps weekly sets at observed volume when requested frequency rises', () => {
    const { brief } = fixture(); brief.experience = 'experienced'
    const load = deriveProgramLoad(brief, history({ frequency: 1, sets: 15 }), '2026-09-15')
    const result = prescribeProgram(selection(3), brief, '2026-09-15', load)
    expect(result.sessions.flatMap((session) => session.exercises).reduce((sum, exercise) => sum + exercise.weeks[0]!.sets, 0)).toBe(15)
    expect(result.sessions.every((session) => session.exercises.every((exercise) => exercise.weeks[0]!.sets === 1))).toBe(true)
  })
  it('asks about an incompatible volume instead of raising the minimum silently, and retains the ceiling for incomplete records', () => {
    const { brief } = fixture()
    const context = history({ frequency: 1, sets: 4 })
    const load = deriveProgramLoad(brief, context, '2026-09-15')
    expect(programLoadIssues(brief, load)).toContain('history_volume_requires_review')
    expect(() => prescribeProgram(selection(3), brief, '2026-09-15', load)).toThrow()
    const clarified = deriveProgramLoad({ ...brief, historyComplete: false }, context, '2026-09-15')
    expect(clarified.weeklySetCeiling).toBe(4)
    expect(clarified.mode).toBe('starting')
    expect(clarified.summary).toContain('история записана не полностью')
  })
  it.each([
    ['no history', { weeks: 0 }], ['unconfirmed sets', { confirmed: false }], ['empty values', { reps: null }],
    ['zero reps', { reps: 0 }], ['custom exercise', { source: 'custom' as const }], ['running', { ref: 'running' }],
  ])('does not inflate the strength baseline from %s', (_, options) => {
    const { brief } = fixture(); brief.experience = 'experienced'
    const load = deriveProgramLoad(brief, history(options), '2026-09-15')
    expect(load).toMatchObject({ mode: 'starting', maxSetsPerExercise: 2, meanWeeklyCatalogSets: 0, weeklySetCeiling: null })
  })
  it('counts zero-record weeks rather than averaging only active weeks', () => {
    const { brief } = fixture()
    const load = deriveProgramLoad(brief, history({ weeks: 1, frequency: 1, sets: 12 }), '2026-09-15')
    expect(load.meanWeeklyCatalogSets).toBe(3)
    expect(load.mode).toBe('starting')
  })
  it.each([1, 2, 3] as const)('retains four-week canonical output at frequency %s', (frequency) => {
    const { brief } = fixture(frequency)
    const load = deriveProgramLoad(brief, history({ weeks: 0 }), '2026-09-15')
    const result = materializeProgram(prescribeProgram(selection(frequency), brief, '2026-09-15', load), brief, 'client', 'generation')
    expect(result.canonicalWorkouts).toHaveLength(4 * frequency)
  })
  it.each([null, {}, { version: 'program-context-v1' }])('rejects missing or incompatible history %s', (context) => {
    expect(() => deriveProgramLoad(fixture().brief, context, '2026-09-15')).toThrow('program_history_invalid')
  })
})

it('incomplete catalog cannot inflate the same recent volume', () => {
  const { brief } = fixture(); brief.experience = 'experienced'
  const context = history({ frequency: 1, sets: 15 })
  const baseline = deriveProgramLoad(brief, context, '2026-09-15')
  context.loadEvidence[0]!.unmappedSets = 1
  const uncertain = deriveProgramLoad(brief, context, '2026-09-15')
  expect(uncertain.weeklySetCeiling).toBe(baseline.weeklySetCeiling)
  const result = prescribeProgram(selection(3), brief, '2026-09-15', uncertain)
  expect(result.sessions.flatMap((session) => session.exercises).reduce((sum, exercise) => sum + exercise.weeks[0]!.sets, 0)).toBe(15)
})
it('difficult feedback changes effort and progression without diagnosing current limitations', () => {
  const { brief } = fixture(); brief.experience = 'experienced'
  const context = history()
  context.feedback = { reportedWorkouts: 12, missingWorkouts: 0, hardDates: ['2026-09-14'], discomfortDates: ['2026-09-14'], meanSessionRpe: 10 }
  const load = deriveProgramLoad(brief, context, '2026-09-15')
  expect(load).toMatchObject({ mode: 'starting', rpe: 6.5, increments: [0, 0, 1, 1], weeklySetCeiling: 45 })
  expect(load.summary).toContain('текущие ограничения проверяются отдельно')
})
