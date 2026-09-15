import { expect, it } from 'vitest'
import { fixture } from './fixtures.js'
import { programPlanFromTemplate, readProgramPlan } from './plan.js'

it('preserves explicit individual model doses and permits repeated novice days', () => {
  const { brief, template } = fixture(2)
  template.sessions[0]!.exercises[0]!.weeks.forEach((dose) => { dose.reps = 6; dose.restSec = 120; dose.rpe = 6 })
  template.sessions[1]!.exercises[0]!.weeks.forEach((dose) => { dose.reps = 10; dose.restSec = 90 })
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
