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
