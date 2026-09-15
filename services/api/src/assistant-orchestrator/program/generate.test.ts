import { describe, expect, it } from 'vitest'
import { prescribeProgram, materializeProgram, validateProgramTemplate, programBriefIssues, type ProgramTemplate } from './generate.js'
import { fixture } from './fixtures.js'
import { buildProgramHistoryContext } from './context.js'
import { deriveProgramLoad } from './load.js'


describe('four-week program contract', () => {
  it.each([1, 2, 3] as const)('materializes %s weekly sessions across exactly 28 days', (frequency) => {
    const { brief, template } = fixture(frequency)
    const valid = validateProgramTemplate(template, brief, '2026-09-15')
    const result = materializeProgram(valid, brief, 'client', 'generation')
    expect(result.sessions).toHaveLength(frequency * 4)
    expect(new Set(result.sessions.map((row) => row.day)).size).toBe(frequency * 4)
    expect(result.sessions.every((row) => row.day >= '2026-09-16' && row.day < '2026-10-14')).toBe(true)
    expect(result.canonicalWorkouts.every((row) => row.exercises.every((exercise) => exercise.source === 'system' && exercise.sets.every((set) => !('weightKg' in set))))).toBe(true)
    expect(materializeProgram(valid, brief, 'client', 'generation')).toEqual(result)
    expect(new Set(result.canonicalWorkouts.map((row) => row.requestId)).size).toBe(frequency * 4)
  })
  it.each([
    ['unknown reference', (t: ProgramTemplate) => { t.sessions[0]!.exercises[0]!.exerciseRef = 'invented' }],
    ['week count', (t: ProgramTemplate) => { t.sessions[0]!.exercises[0]!.weeks.pop() }],
    ['duplicate exercise', (t: ProgramTemplate) => { t.sessions[0]!.exercises[1] = t.sessions[0]!.exercises[0]! }],
    ['duplicate weekday', (t: ProgramTemplate) => { t.sessions[1]!.weekday = 1 }],
    ['excessive effort', (t: ProgramTemplate) => { t.sessions[0]!.exercises[0]!.weeks[0]!.rpe = 9 }],
    ['progression on two axes', (t: ProgramTemplate) => { const week = t.sessions[0]!.exercises[0]!.weeks[1]!; week.reps = 9; week.rpe = 7 }],
    ['missing weekly movement', (t: ProgramTemplate) => { for (const s of t.sessions) s.exercises = s.exercises.filter((e) => e.exerciseRef !== 'plank') }],
  ] as const)('rejects %s', (_, mutate) => {
    const { brief, template } = fixture(); mutate(template)
    expect(() => validateProgramTemplate(template, brief, '2026-09-15')).toThrow()
  })
  it('rejects unavailable equipment, tight time and adjacent heavy days', () => {
    const { brief, template } = fixture()
    expect(() => validateProgramTemplate(template, { ...brief, equipment: [] }, '2026-09-15')).toThrow()
    expect(() => validateProgramTemplate(template, { ...brief, durationMin: 20 }, '2026-09-15')).toThrow()
    brief.weekdays = [1, 2, 3]
    template.sessions.forEach((s, i) => { s.weekday = i + 1; s.exercises.forEach((e) => e.weeks.forEach((w) => { w.rpe = 7 })) })
    expect(() => validateProgramTemplate(template, brief, '2026-09-15')).toThrow()
  })
  it('does not treat missing limitations as no limitations', () => {
    const { brief } = fixture()
    expect(programBriefIssues({ ...brief, limitations: 'unknown' }, '2026-09-15')).toContain('limitations_require_review')
  })
  it('preserves exercise progression through validation, dated sessions and saved workout notes', () => {
    const { brief, template } = fixture(1)
    const progressionNote = 'Первые две недели — 8 повторений, затем 9 при выполнении всех подходов с целевым усилием и техникой. Рабочий вес подбирает тренер.'
    template.sessions[0]!.exercises[0]!.progressionNote = ` ${progressionNote} `
    const checked = validateProgramTemplate(template, brief, '2026-09-15')
    expect(checked.sessions[0]!.exercises[0]!.progressionNote).toBe(progressionNote)
    const result = materializeProgram(checked, brief, 'client', 'generation')
    expect(result.sessions.every((session) => session.exercises[0]!.progressionNote === progressionNote)).toBe(true)
    expect(result.canonicalWorkouts.every((workout) => workout.notes.includes(`Жим ногами в тренажёре: ${progressionNote}`))).toBe(true)
    expect(checked.sessions[0]!.exercises[1]).not.toHaveProperty('progressionNote')
  })
  it.each(['', '   ', 'я'.repeat(241), 42, null])('rejects malformed optional template notes: %j', (progressionNote) => {
    const { brief, template } = fixture(1)
    Object.assign(template.sessions[0]!.exercises[0]!, { progressionNote })
    expect(() => validateProgramTemplate(template, brief, '2026-09-15')).toThrow(expect.objectContaining({ codes: ['invalid_progression_note'] }))
  })
})

it.each([1, 2, 3] as const)('calculates consistent prescriptions for %s sessions instead of trusting model numbers', (frequency) => {
  const { brief, template } = fixture(frequency)
  const wire = { days: Object.fromEntries(template.sessions.map((_session, index) => [`day${index + 1}`, { squat: 'leg-press', hinge: 'fedb-butt-lift-bridge', horizontal_push: 'push-ups', horizontal_pull: 'seated-cable-row', core: 'plank', accessory: null }])) }
  const history = buildProgramHistoryContext({ clientId: 'client', periodStart: '2026-07-22', periodEnd: '2026-09-15', workouts: [], exercises: [], sets: [] }).context
  const load = deriveProgramLoad(brief, history, '2026-09-15')
  const prescribed = prescribeProgram(wire, brief, '2026-09-15', load)
  expect(prescribed.sessions).toHaveLength(frequency)
  expect(prescribed.sessions[0]!.exercises[0]!.weeks.map((week) => week.reps)).toEqual([8, 8, 9, 9])
  expect(prescribed.sessions[0]!.exercises[0]!.weeks.map((week) => week.sets)).toEqual([2, 2, 2, 2])
  expect(() => prescribeProgram({ ...wire, invented: true }, brief, '2026-09-15', load)).toThrow()
})
