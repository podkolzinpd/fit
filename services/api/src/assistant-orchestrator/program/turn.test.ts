import { describe, expect, it, vi } from 'vitest'
import { programPilotTurn } from './turn.js'
import { CONFIRM_PROGRAM_BRIEF } from './brief.js'
import { fixture } from './fixtures.js'
import { buildProgramHistoryContext } from './context.js'

const client = { id: 'client', fullName: 'Тестик', ageYears: 30, goal: 'Старая цель' }
function setup() {
  const { brief, template } = fixture()
  const context = { ...buildProgramHistoryContext({ clientId: client.id, periodStart: '2026-07-22', periodEnd: '2026-09-15', workouts: [], exercises: [], sets: [] }), capturedAt: '2026-09-15T10:00:00Z', profile: { ageYears: 30, goal: null, latestWeight: null } }
  const deps = { actorId: 'trainer', turnId: 'turn', today: '2026-09-15', duplicateTurn: false,
    loadContext: vi.fn().mockResolvedValue(context), extract: vi.fn(), generate: vi.fn().mockResolvedValue(template), canGenerate: vi.fn().mockResolvedValue(true), matchClients: vi.fn().mockReturnValue([]) }
  const latest = { payload: { programPilot: true, step: 'brief', clientId: client.id, briefState: brief, readyToGenerate: true } }
  return { deps, latest }
}
describe('program chat state', () => {
  it('ignores unrelated new requests', async () => {
    const { deps } = setup()
    expect(await programPilotTurn('Привет', [client], null, deps)).toBeUndefined()
    expect(deps.extract).not.toHaveBeenCalled()
  })
  it('generates only on explicit confirmation with a fresh context', async () => {
    const { deps, latest } = setup()
    const result = await programPilotTurn(CONFIRM_PROGRAM_BRIEF, [client], latest, deps)
    expect(result?.action?.status).toBe('proposed')
    expect(result?.action?.payload.canonicalWorkouts).toHaveLength(12)
    expect(deps.loadContext).toHaveBeenCalledOnce()
    expect(deps.matchClients).not.toHaveBeenCalled()
  })
  it('does not pay for a duplicate generation turn', async () => {
    const { deps, latest } = setup(); deps.duplicateTurn = true
    await expect(programPilotTurn(CONFIRM_PROGRAM_BRIEF, [client], latest, deps)).rejects.toThrow('program_generation_in_progress_or_interrupted')
    expect(deps.generate).not.toHaveBeenCalled()
  })
  it('rate limit prevents generation', async () => {
    const { deps, latest } = setup(); deps.canGenerate.mockResolvedValue(false)
    expect((await programPilotTurn(CONFIRM_PROGRAM_BRIEF, [client], latest, deps))?.reply).toContain('лимит')
    expect(deps.generate).not.toHaveBeenCalled()
  })
  it('clarification disables confirmation even with a previously complete brief', async () => {
    const { deps, latest } = setup()
    deps.extract.mockResolvedValue({ patch: {}, clear: [], evidence: {}, clarification: 'Какое упражнение исключить?' })
    expect((await programPilotTurn('Исключить упражнение', [client], latest, deps))?.action?.payload.readyToGenerate).toBe(false)
  })
  it('model failure retains answers for an explicit new attempt', async () => {
    const { deps, latest } = setup(); deps.generate.mockRejectedValue(new Error('timeout'))
    const result = await programPilotTurn(CONFIRM_PROGRAM_BRIEF, [client], latest, deps)
    expect(result?.action?.status).toBe('needs_input')
    expect(result?.action?.payload.briefState).toEqual(latest.payload.briefState)
  })
})
