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
beforeEach(() => { vi.clearAllMocks(); vi.mocked(isProgramPilotEnabled).mockReturnValue(true); vi.mocked(programModelJson).mockResolvedValue(selection) })
describe('private generator load contract', () => {
  it('passes the same calculated load to the model and numerical prescription', async () => {
    const body = request()
    const load = deriveProgramLoad(body.brief, body.context.context, body.today)
    const result = await handler({ httpMethod: 'POST', body })
    expect(result.statusCode).toBe(200)
    expect(programModelJson).toHaveBeenCalledOnce()
    expect(vi.mocked(programModelJson).mock.calls[0]?.[0]).toHaveProperty('data.load', load)
    expect(JSON.parse(result.body)).toMatchObject({ template: prescribeProgram(selection, body.brief, body.today, load) })
  })
  it('rejects an invalid history before a paid model call', async () => {
    const result = await handler({ httpMethod: 'POST', body: { ...request(), context: {} } })
    expect(result.statusCode).not.toBe(200)
    expect(programModelJson).not.toHaveBeenCalled()
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
})
