import { describe, expect, it } from 'vitest'
import { buildProgramHistoryContext, programSessionCount, type ProgramContextSource, type ProgramFrequency, type ProgramSetSource } from './context.js'

function set(id: string, exerciseId: string, patch: Partial<ProgramSetSource> = {}): ProgramSetSource {
  return { id, exerciseId, position: 0, confirmedAt: '2026-09-07T10:00:00Z', factReps: 10,
    factWeightKg: 30, factDurationSec: null, factDistanceKm: null, factRpe: 7, ...patch }
}

function fixture(): ProgramContextSource {
  return {
    clientId: 'client-a', periodStart: '2026-09-01', periodEnd: '2026-09-15',
    workouts: [
      { id: 'done', clientId: 'client-a', date: '2026-09-07', status: 'done', deletedAt: null, sessionRpe: 7, wellbeing: 'normal', discomfort: false },
      { id: 'planned', clientId: 'client-a', date: '2026-09-09', status: 'planned', deletedAt: null, sessionRpe: null, wellbeing: null, discomfort: null },
      { id: 'deleted', clientId: 'client-a', date: '2026-09-10', status: 'done', deletedAt: '2026-09-11', sessionRpe: 10, wellbeing: 'hard', discomfort: true },
    ],
    exercises: [
      { id: 'e1', workoutId: 'done', ref: 'bench-press', source: 'system', position: 0 },
      { id: 'e2', workoutId: 'planned', ref: 'bench-press', source: 'system', position: 0 },
      { id: 'e3', workoutId: 'deleted', ref: 'bench-press', source: 'system', position: 0 },
    ],
    sets: [set('s1', 'e1'), set('s2', 'e1', { confirmedAt: null, factWeightKg: 100 }), set('s3', 'e2'), set('s4', 'e3')],
  }
}

describe('four-week program scope', () => {
  it.each([1, 2, 3] as const)('%i weekly sessions produces exactly four weeks', (frequency) => {
    expect(programSessionCount(frequency)).toBe(frequency * 4)
  })
  it.each([0, 4, 1.5, NaN])('rejects unsupported runtime frequency %s', (frequency) => {
    expect(() => programSessionCount(frequency as ProgramFrequency)).toThrow('invalid_program_frequency')
  })
})

describe('program history facts', () => {
  it('counts completed workouts and confirmed fact only, preserving zero-activity weeks', () => {
    const { context } = buildProgramHistoryContext(fixture())
    expect(context.completedWorkouts).toBe(1)
    expect(context.weeklyActivity).toEqual([
      { weekStart: '2026-08-31', completedWorkouts: 0, confirmedSets: 0 },
      { weekStart: '2026-09-07', completedWorkouts: 1, confirmedSets: 1 },
      { weekStart: '2026-09-14', completedWorkouts: 0, confirmedSets: 0 },
    ])
    expect(context.exercises[0]).toMatchObject({ ref: 'bench-press', confirmedSets: 1, sessions: 1,
      recentExecutions: [{ date: '2026-09-07', sets: [{ reps: 10, weightKg: 30, rpe: 7 }] }] })
    expect(context.feedback).toEqual({ reportedWorkouts: 1, missingWorkouts: 0,
      discomfortDates: [], hardDates: [], meanSessionRpe: 7 })
  })

  it('never invents a result or treats missing feedback as a negative report', () => {
    const source = fixture()
    source.workouts = source.workouts.map((row) => ({ ...row, sessionRpe: null, wellbeing: null, discomfort: null }))
    source.sets = [set('s1', 'e1', { factReps: null, factWeightKg: null, factRpe: null })]
    const { context } = buildProgramHistoryContext(source)
    expect(context.feedback).toMatchObject({ missingWorkouts: 1, reportedWorkouts: 0, meanSessionRpe: null })
    expect(context.gaps).toEqual(['incomplete_feedback', 'confirmed_set_without_values'])
    expect(context.exercises[0]?.recentExecutions[0]?.sets[0]?.weightKg).toBeNull()
  })

  it('retains dated discomfort separately from present health status', () => {
    const source = fixture()
    source.workouts = source.workouts.map((row) => ({ ...row, discomfort: true, wellbeing: 'hard' }))
    const { context } = buildProgramHistoryContext(source)
    expect(context.feedback.discomfortDates).toEqual(['2026-09-07'])
    expect(context.feedback.hardDates).toEqual(['2026-09-07'])
    expect(context).not.toHaveProperty('healthy')
  })

  it('represents an empty history explicitly', () => {
    const { context } = buildProgramHistoryContext({ ...fixture(), workouts: [], exercises: [], sets: [] })
    expect(context.gaps).toEqual(['no_completed_workouts', 'no_confirmed_sets'])
    expect(context.lastCompletedDate).toBeNull()
    expect(context.exercises).toEqual([])
  })

  it('rejects another client even if that workout falls outside the requested period', () => {
    const source = fixture()
    source.workouts = source.workouts.map((row) => ({ ...row, clientId: 'other', date: '2020-01-01' }))
    expect(() => buildProgramHistoryContext(source)).toThrow('program_source_client_mismatch')
  })

  it('rejects duplicate and dangling rows instead of double counting', () => {
    const source = fixture()
    expect(() => buildProgramHistoryContext({ ...source, sets: [...source.sets, source.sets[0]!] })).toThrow('duplicate_program_source_row')
    expect(() => buildProgramHistoryContext({ ...source, exercises: [] })).toThrow('orphan_program_source_row')
    expect(() => buildProgramHistoryContext({ ...source, workouts: [] })).toThrow('orphan_program_source_row')
  })

  it.each(['2026-02-30', '2026-9-1', 'invalid'])('rejects invalid source dates: %s', (periodStart) => {
    expect(() => buildProgramHistoryContext({ ...fixture(), periodStart })).toThrow('invalid_program_source_date')
  })

  it('rejects reversed and unbounded periods', () => {
    expect(() => buildProgramHistoryContext({ ...fixture(), periodStart: '2026-09-16' })).toThrow('invalid_program_source_period')
    expect(() => buildProgramHistoryContext({ ...fixture(), periodStart: '2020-01-01' })).toThrow('invalid_program_source_period')
  })

  it.each([NaN, Infinity, -1])('rejects corrupt facts rather than handing them to the model: %s', (factWeightKg) => {
    const source = fixture()
    source.sets = [set('s1', 'e1', { factWeightKg })]
    expect(() => buildProgramHistoryContext(source)).toThrow('invalid_program_source_fact')
  })

  it('is invariant to source order and does not mutate inputs', () => {
    const source = fixture()
    const before = structuredClone(source)
    const initial = buildProgramHistoryContext(source)
    const reversed = buildProgramHistoryContext({ ...source,
      workouts: [...source.workouts].reverse(), exercises: [...source.exercises].reverse(), sets: [...source.sets].reverse() })
    expect(reversed).toEqual(initial)
    expect(source).toEqual(before)
  })

  it('keeps different clients out of the same cache without putting identity into model facts', () => {
    const source = fixture()
    const first = buildProgramHistoryContext(source)
    const second = buildProgramHistoryContext({ ...source, clientId: 'other', workouts: source.workouts.map((row) => ({ ...row, clientId: 'other' })) })
    expect(second.context).toEqual(first.context)
    expect(second.fingerprint).not.toBe(first.fingerprint)
    expect(JSON.stringify(first.context)).not.toContain('client-a')
  })

  it('separates custom and system refs and counts repeated exercise blocks once per session', () => {
    const source = fixture()
    source.exercises = [...source.exercises,
      { id: 'e4', workoutId: 'done', ref: 'bench-press', source: 'system', position: 1 },
      { id: 'e5', workoutId: 'done', ref: 'bench-press', source: 'custom', position: 2 }]
    source.sets = [...source.sets, set('s5', 'e4'), set('s6', 'e5')]
    const { context } = buildProgramHistoryContext(source)
    expect(context.exercises).toHaveLength(2)
    expect(context.exercises.find((row) => row.source === 'system')).toMatchObject({ sessions: 1, confirmedSets: 2 })
  })

  it('invalidates cached snapshots when an older fact changes beyond the three detailed executions', () => {
    const base = fixture()
    const source: ProgramContextSource = { ...base, workouts: [], exercises: [], sets: [] }
    for (let day = 1; day <= 4; day++) {
      source.workouts = [...source.workouts, { ...base.workouts[0]!, id: `w${day}`, date: `2026-09-0${day}` }]
      source.exercises = [...source.exercises, { ...base.exercises[0]!, id: `e${day}`, workoutId: `w${day}` }]
      source.sets = [...source.sets, set(`s${day}`, `e${day}`)]
    }
    const first = buildProgramHistoryContext(source)
    const second = buildProgramHistoryContext({ ...source, sets: source.sets.map((row) => row.id === 's1' ? { ...row, factWeightKg: 35 } : row) })
    expect(second.context).toEqual(first.context)
    expect(second.fingerprint).not.toBe(first.fingerprint)
  })
})
