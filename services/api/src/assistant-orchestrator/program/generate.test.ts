import { describe, expect, it } from 'vitest'
import { materializeProgram, validateProgramTemplate, programBriefIssues, type ProgramTemplate } from './generate.js'
import { fixture } from './fixtures.js'


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
    ['progression on two axes', (t: ProgramTemplate) => { t.sessions[0]!.exercises[0]!.weeks[1]!.rpe = 7 }],
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
})
