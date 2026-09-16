import { programPlanFromTemplate, readProgramPlan } from './assistant-orchestrator/program/plan.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handler } from './yandex-program-generator-function.js'
import { isProgramPilotEnabled, programModelJson } from './assistant-orchestrator/program/model.js'
import { buildProgramHistoryContext } from './assistant-orchestrator/program/context.js'
import { fixture } from './assistant-orchestrator/program/fixtures.js'
import { deriveProgramLoad } from './assistant-orchestrator/program/load.js'
import { prescribeProgram } from './assistant-orchestrator/program/generate.js'

vi.mock('./assistant-orchestrator/program/model.js', () => ({ isProgramPilotEnabled: vi.fn(), programModelJson: vi.fn() }))
function request() {
  return { actorId: 'allowed-trainer', operationId: 'op', today: '2026-09-15', brief: fixture(1).brief,
    context: buildProgramHistoryContext({ clientId: 'client', periodStart: '2026-07-22', periodEnd: '2026-09-15', workouts: [], exercises: [], sets: [] }) }
}
const selection = { days: { day1: { squat: 'leg-press', hinge: 'fedb-butt-lift-bridge', horizontal_push: 'push-ups', horizontal_pull: 'seated-cable-row', core: 'plank', accessory: null } } }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(isProgramPilotEnabled).mockReturnValue(true); vi.mocked(programModelJson).mockResolvedValue(programPlanFromTemplate(prescribeProgram(selection, request().brief, request().today, deriveProgramLoad(request().brief, request().context.context, request().today)))) })
describe('private generator load contract', () => {
  it('repairs invalid prescriptions once with exact validation feedback', async () => {
    const body = request()
    const valid = programPlanFromTemplate(prescribeProgram(selection, body.brief, body.today, deriveProgramLoad(body.brief, body.context.context, body.today)))
    const invalid = structuredClone(valid)
    Object.assign(invalid.exercises[0]!, { rpe: [9, 9, 9, 9] })
    vi.mocked(programModelJson).mockResolvedValueOnce(invalid).mockResolvedValueOnce(valid)
    expect((await handler({ httpMethod: 'POST', body })).statusCode).toBe(200)
    expect(programModelJson).toHaveBeenCalledTimes(2)
    const retry = vi.mocked(programModelJson).mock.calls[1]![0]
    expect(retry.data).toMatchObject({ repair: { previousPlan: invalid, issues: ['invalid_prescription'] } })
    expect(retry.timeoutMs).toBeLessThanOrEqual(vi.mocked(programModelJson).mock.calls[0]![0].timeoutMs!)
  })
  it('accepts a consistent plan above the recorded average without rewriting model doses', async () => {
    const body = request()
    body.context.context.loadEvidence = ['2026-09-14', '2026-09-07', '2026-08-31', '2026-08-24']
      .map((date) => ({ date, catalogSets: 4, unmappedSets: 0 }))
    const plan = programPlanFromTemplate(fixture(1).template)
    vi.mocked(programModelJson).mockResolvedValue(plan)
    const result = await handler({ httpMethod: 'POST', body })
    expect(result.statusCode).toBe(200)
    expect(programModelJson).toHaveBeenCalledOnce()
    expect(vi.mocked(programModelJson).mock.calls[0]![0].data).toMatchObject({ load: { meanWeeklyCatalogSets: 4 } })
    expect(JSON.parse(result.body)).toMatchObject({ template: readProgramPlan(plan, body.brief, body.today) })
  })
  it('tells repair which weekday has too few exercises', async () => {
    const body = request()
    const valid = programPlanFromTemplate(fixture(1).template)
    const invalid = { ...valid, exercises: valid.exercises.slice(0, 1), durationExercises: [] }
    vi.mocked(programModelJson).mockResolvedValueOnce(invalid).mockResolvedValueOnce(valid)
    expect((await handler({ httpMethod: 'POST', body })).statusCode).toBe(200)
    expect(vi.mocked(programModelJson).mock.calls[1]![0].data).toMatchObject({ repair: {
      issues: ['invalid_session_schema'], diagnostics: { sessions: [{ weekday: 1, exerciseCount: 1 }],
        requirements: { exercisesPerDay: { minimum: 3, maximum: 8 } } },
    } })
  })
  it('repairs two incomplete days independently and preserves the valid day', async () => {
    const body = { ...request(), brief: fixture(3).brief }
    const valid = programPlanFromTemplate(fixture(3).template)
    const invalid = { ...valid, exercises: valid.exercises.filter((row) => row.weekday === 1),
      durationExercises: valid.durationExercises.filter((row) => row.weekday === 1) }
    vi.mocked(programModelJson).mockResolvedValueOnce(invalid).mockImplementation(async (input) => {
      await Promise.resolve()
      const data = input.data as { repair: { targetWeekday: number } }
      const weekday = data.repair.targetWeekday
      expect([3, 5]).toContain(weekday)
      return { ...valid, sessions: valid.sessions.filter((row) => row.weekday === weekday),
        exercises: valid.exercises.filter((row) => row.weekday === weekday),
        durationExercises: valid.durationExercises.filter((row) => row.weekday === weekday) }
    })
    const result = await handler({ httpMethod: 'POST', body })
    expect(result.statusCode).toBe(200)
    expect(programModelJson).toHaveBeenCalledTimes(3)
    expect(JSON.parse(result.body)).toMatchObject({ template: readProgramPlan(valid, body.brief, body.today) })
  })
  it('passes history bounds to the model and preserves its individual prescriptions', async () => {
    const body = request()
    const load = deriveProgramLoad(body.brief, body.context.context, body.today)
    const result = await handler({ httpMethod: 'POST', body })
    expect(result.statusCode).toBe(200)
    expect(programModelJson).toHaveBeenCalledOnce()
    expect(vi.mocked(programModelJson).mock.calls[0]?.[0]).toHaveProperty('data.load', load)
    expect(JSON.parse(result.body)).toMatchObject({ template: readProgramPlan(programPlanFromTemplate(prescribeProgram(selection, body.brief, body.today, load)), body.brief, body.today) })
  })
  it('rejects an invalid history before a paid model call', async () => {
    const result = await handler({ httpMethod: 'POST', body: { ...request(), context: {} } })
    expect(result.statusCode).not.toBe(200)
    expect(programModelJson).not.toHaveBeenCalled()
  })
  it('rejects a new model plan without an exercise progression note', async () => {
    const body = request()
    const load = deriveProgramLoad(body.brief, body.context.context, body.today)
    const plan = programPlanFromTemplate(prescribeProgram(selection, body.brief, body.today, load))
    Reflect.deleteProperty(plan.exercises[0]!, 'progressionNote')
    vi.mocked(programModelJson).mockResolvedValue(plan)
    const result = await handler({ httpMethod: 'POST', body })
    expect(result.statusCode).toBe(422)
    expect(programModelJson).toHaveBeenCalledTimes(2)
    expect(JSON.parse(result.body)).toMatchObject({ error: 'program_validation_failed', issues: ['invalid_progression_note'] })
  })
  it('generates a draft with stated limitations and passes adaptations to the model', async () => {
    const body = request()
    body.brief.limitations = 'present'
    body.brief.limitationsText = 'Дискомфорт при жимах над головой'
    body.brief.limitationAdjustments = 'Исключить жимы над головой'
    body.brief.excludedRefs = ['overhead-press', 'vital-standing-dumbbell-press']
    const result = await handler({ httpMethod: 'POST', body })
    expect(result.statusCode).toBe(200)
    expect(vi.mocked(programModelJson).mock.calls[0]![0].data).toMatchObject({ brief: { limitations: 'present', limitationAdjustments: 'Исключить жимы над головой' } })
    expect(JSON.stringify(vi.mocked(programModelJson).mock.calls[0]![0].schema)).not.toContain('vital-standing-dumbbell-press')
  })
  it('keeps other trainers outside the pilot', async () => {
    vi.mocked(isProgramPilotEnabled).mockReturnValue(false)
    const result = await handler({ httpMethod: 'POST', body: request() })
    expect(result.statusCode).toBe(403)
    expect(programModelJson).not.toHaveBeenCalled()
  })
  it('does not spend a generation on incomplete activity details', async () => {
    const body = request(); body.brief.otherActivity = 'бег'
    expect((await handler({ httpMethod: 'POST', body })).statusCode).toBe(422)
    expect(programModelJson).not.toHaveBeenCalled()
  })
  it('does not retry authorization or transport failures as plan repairs', async () => {
    vi.mocked(programModelJson).mockRejectedValueOnce(new Error('program_model_http_403'))
    expect((await handler({ httpMethod: 'POST', body: request() })).statusCode).toBe(502)
    expect(programModelJson).toHaveBeenCalledOnce()
  })
})
