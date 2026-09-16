import { expect, it } from 'vitest'
import { fixture } from './fixtures.js'
import { programPlanFromTemplate, programPlanSchema, readProgramPlan } from './plan.js'
import { PROGRAM_CATALOG } from './catalog.js'
import { buildProgramHistoryContext } from './context.js'
import { deriveProgramLoad } from './load.js'

it('preserves explicit individual model doses and permits repeated novice days', () => {
  const { brief, template } = fixture(2)
  template.sessions[0]!.exercises[0]!.weeks.forEach((dose) => { dose.reps = 6; dose.restSec = 120; dose.rpe = 6 })
  template.sessions[1]!.exercises[0]!.weeks.forEach((dose) => { dose.reps = 10; dose.restSec = 90 })
  for (const session of template.sessions) for (const exercise of session.exercises) exercise.progressionNote = 'Тренер подбирает рабочую нагрузку по технике и целевому усилию; выполните все назначенные повторы перед увеличением нагрузки.'
  const plan = programPlanFromTemplate(template)
  expect(readProgramPlan(plan, brief, '2026-09-15').sessions).toEqual(template.sessions)
})
it('rejects missing weekly doses and orphan rows instead of filling values', () => {
  const { brief, template } = fixture(1)
  const plan = programPlanFromTemplate(template)
  const first = plan.exercises[0]!
  Object.assign(first, { sets: [2, 2, 2] })
  expect(() => readProgramPlan(plan, brief, '2026-09-15')).toThrow()
})

it('requires an exercise progression explanation in both model schema and model output', () => {
  const { brief, template } = fixture(1)
  const history = buildProgramHistoryContext({ clientId: 'client', periodStart: '2026-07-22', periodEnd: '2026-09-15', workouts: [], exercises: [], sets: [] }).context
  const schema = programPlanSchema(PROGRAM_CATALOG, brief, deriveProgramLoad(brief, history, '2026-09-15'))
  expect(schema.properties.exercises.items.required).toContain('progressionNote')
  const plan = programPlanFromTemplate(template)
  Reflect.deleteProperty(plan.exercises[0]!, 'progressionNote')
  expect(() => readProgramPlan(plan, brief, '2026-09-15')).toThrow(expect.objectContaining({ codes: ['invalid_progression_note'] }))
})

it.each(['', '   ', 'я'.repeat(241), 42, null])('rejects malformed model progression notes: %j', (progressionNote) => {
  const { brief, template } = fixture(1)
  const plan = programPlanFromTemplate(template)
  Object.assign(plan.exercises[0]!, { progressionNote })
  expect(() => readProgramPlan(plan, brief, '2026-09-15')).toThrow(expect.objectContaining({ codes: ['invalid_progression_note'] }))
})

it('rejects the observed model timeline contradiction while leaving actual doses untouched', () => {
  const { brief, template } = fixture(1)
  const plan = programPlanFromTemplate(template)
  Object.assign(plan.exercises[0]!, { amount: [8, 8, 8, 9], progressionNote: 'С третьей недели добавляем один повтор при сохранении техники.' })
  const before = structuredClone(plan)
  expect(() => readProgramPlan(plan, brief, '2026-09-15')).toThrow(expect.objectContaining({ codes: ['progression_note_must_be_qualitative'] }))
  expect(plan).toEqual(before)
})

it.each(['Добавить 1 повтор.', 'Удерживать по неделям.', 'Первые занятия — освоение.', 'Вторая — закрепление.', 'Четвёртая — рост.'])('rejects numerical or weekly narration in a new model note: %s', (progressionNote) => {
  const { brief, template } = fixture(1)
  const plan = programPlanFromTemplate(template)
  plan.exercises[0]!.progressionNote = progressionNote
  expect(() => readProgramPlan(plan, brief, '2026-09-15')).toThrow(expect.objectContaining({ codes: ['progression_note_must_be_qualitative'] }))
})

it('accepts a qualitative reason and preserves the four exact model doses', () => {
  const { brief, template } = fixture(1)
  const plan = programPlanFromTemplate(template)
  const progressionNote = 'Закрепляем технику после перерыва; повышение нагрузки — при целевом усилии.'
  Object.assign(plan.exercises[0]!, { amount: [8, 8, 8, 9], progressionNote })
  const result = readProgramPlan(plan, brief, '2026-09-15')
  expect(result.sessions[0]!.exercises[0]!.progressionNote).toBe(progressionNote)
  expect(result.sessions[0]!.exercises[0]!.weeks.map((week) => week.reps)).toEqual([8, 8, 8, 9])
})

it('constrains repetitions and seconds in separate schema rows before model generation', () => {
  const { brief } = fixture(1)
  const history = buildProgramHistoryContext({ clientId: 'client', periodStart: '2026-07-22', periodEnd: '2026-09-15', workouts: [], exercises: [], sets: [] }).context
  const schema = programPlanSchema(PROGRAM_CATALOG, brief, deriveProgramLoad(brief, history, '2026-09-15'))
  const reps = schema.properties.exercises.items.properties
  const duration = schema.properties.durationExercises.items.properties
  expect(schema.required).toContain('durationExercises')
  expect(reps.exerciseRef).toHaveProperty('enum', expect.arrayContaining(['crunches']))
  expect(reps.exerciseRef).not.toHaveProperty('enum', expect.arrayContaining(['plank']))
  expect(reps.amount.items).toMatchObject({ minimum: 4, maximum: 20 })
  expect(reps.amount.enum).toContainEqual([8, 9, 10, 11])
  expect(duration.exerciseRef).toHaveProperty('enum', ['plank', 'side-plank'])
  expect(duration.amount.items).toMatchObject({ minimum: 15, maximum: 90 })
  expect(duration.amount.enum).toContainEqual([30, 35, 40, 40])
})

it('rejects the observed crunches duration-dose failure instead of repairing the model response', () => {
  const { brief, template } = fixture(1)
  const plan = programPlanFromTemplate(template)
  plan.exercises.push({ ...plan.durationExercises[0]!, exerciseRef: 'crunches' })
  expect(() => readProgramPlan(plan, brief, '2026-09-15')).toThrow(expect.objectContaining({ codes: ['invalid_prescription'] }))
})

it.each(['reps-in-duration', 'duration-in-reps'])('rejects a reference in the wrong unit array: %s', (variant) => {
  const { brief, template } = fixture(1)
  const plan = programPlanFromTemplate(template)
  if (variant === 'reps-in-duration') plan.durationExercises.push(plan.exercises.shift()!)
  else plan.exercises.push(plan.durationExercises.shift()!)
  expect(() => readProgramPlan(plan, brief, '2026-09-15')).toThrow(expect.objectContaining({ codes: ['invalid_exercise_input_kind'] }))
})

it('allows programs without timed exercises and forbids missing duration array', () => {
  const { brief, template } = fixture(1)
  const core = template.sessions[0]!.exercises[4]!
  core.exerciseRef = 'crunches'
  for (const dose of core.weeks) { dose.reps = 8; dose.durationSec = null }
  const plan = programPlanFromTemplate(template)
  expect(plan.durationExercises).toEqual([])
  expect(readProgramPlan(plan, brief, '2026-09-15').sessions[0]!.exercises[4]!.exerciseRef).toBe('crunches')
  Reflect.deleteProperty(plan, 'durationExercises')
  expect(() => readProgramPlan(plan, brief, '2026-09-15')).toThrow()
})

it('places timed exercises after rep-based work and preserves order within each array', () => {
  const { brief, template } = fixture(1)
  const plan = programPlanFromTemplate(template)
  plan.exercises.reverse()
  const result = readProgramPlan(plan, brief, '2026-09-15')
  expect(result.sessions[0]!.exercises.map((exercise) => exercise.exerciseRef)).toEqual([...plan.exercises, ...plan.durationExercises].map((row) => row.exerciseRef))
})

it('accepts an aerobic effort range only when it agrees with all actual weekly doses', () => {
  const { brief, template } = fixture(1)
  brief.durationMin = 90
  template.sessions[0]!.exercises.push({ exerciseRef: 'walking', progressionNote: 'Разговорный темп, усилие 3–4, без отдыха.',
    weeks: Array.from({ length: 4 }, () => ({ sets: 1, reps: null, durationSec: 600, rpe: 3.5, restSec: 0 })),
  })
  const plan = programPlanFromTemplate(template)
  expect(() => readProgramPlan(plan, brief, '2026-09-15')).not.toThrow()
  Object.assign(plan.aerobicExercises[0]!, { rpe: [5, 5, 5, 5] })
  expect(() => readProgramPlan(plan, brief, '2026-09-15')).toThrow(expect.objectContaining({ codes: ['progression_note_must_be_qualitative'] }))
})

it.each([{ core: false, aerobic: false }, { core: true, aerobic: false }, { core: true, aerobic: true }])('makes the complete worst-case time-repair schema fit 30 minutes: %j', (blocks) => {
  const { brief } = fixture(1); brief.durationMin = 30
  const history = buildProgramHistoryContext({ clientId: 'client', periodStart: '2026-07-22', periodEnd: '2026-09-15', workouts: [], exercises: [], sets: [] }).context
  const schema = programPlanSchema(PROGRAM_CATALOG, brief, deriveProgramLoad(brief, history, '2026-09-15'), true, blocks)
  let minutes = 10
  for (const [key, timed] of [['exercises', false], ['durationExercises', true], ['aerobicExercises', true]] as const) {
    const row = schema.properties[key]
    const fields = row.items.properties
    const sets = (fields.sets.items as { maximum: number }).maximum
    const amount = (fields.amount.items as { maximum: number }).maximum
    const rest = (fields.restSec.items as { maximum: number }).maximum
    minutes += row.maxItems * (2 + (sets * amount * (timed ? 1 : 3) + (sets - 1) * rest) / 60)
  }
  expect(minutes).toBeLessThanOrEqual(30)
  expect(schema.properties.exercises.minItems).toBe(3)
})
