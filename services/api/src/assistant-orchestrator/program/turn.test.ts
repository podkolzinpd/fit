import { describe, expect, it, vi } from 'vitest'
import { programPilotTurn } from './turn.js'
import { CONFIRM_ACTIVITY_OVERLAP, CONFIRM_PROGRAM_BRIEF, HISTORY_COMPLETE, HISTORY_INCOMPLETE } from './brief.js'
import { fixture } from './fixtures.js'
import { buildProgramHistoryContext } from './context.js'

const client = { id: 'client', fullName: 'Тестик', ageYears: 30, goal: 'Старая цель' }
function setup() {
  const { brief, template } = fixture()
  const context = { ...buildProgramHistoryContext({ clientId: client.id, periodStart: '2026-07-22', periodEnd: '2026-09-15', workouts: [], exercises: [], sets: [] }), capturedAt: '2026-09-15T10:00:00Z', profile: { ageYears: 30, goal: null, latestWeight: null } }
  const deps = { actorId: 'trainer', turnId: 'turn', today: '2026-09-15', duplicateTurn: false,
    loadContext: vi.fn().mockResolvedValue(context), extract: vi.fn(), generate: vi.fn().mockResolvedValue(template), canGenerate: vi.fn().mockResolvedValue(true), matchClients: vi.fn().mockReturnValue([]) }
  const latest = { payload: { programPilot: true, step: 'brief', clientId: client.id, briefState: brief, readyToGenerate: true } }
  return { deps, latest, context }
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
  it('retains conditions from the first message when a client is recognized', async () => {
    const { deps } = setup(); deps.matchClients.mockReturnValue([client])
    deps.extract.mockResolvedValue({ patch: { goalText: 'стать сильнее', goal: 'strength', frequency: 3, durationMin: 60 }, clear: [],
      evidence: { goalText: 'стать сильнее', goal: 'стать сильнее', frequency: 'три раза', durationMin: 'по часу' }, clarification: null })
    const result = await programPilotTurn('Составь программу для Тестика. Хочу стать сильнее, три раза в неделю по часу.', [client], null, deps)
    expect(result?.action?.payload.briefState).toMatchObject({ goalText: 'стать сильнее', frequency: 3, durationMin: 60, adult: true })
    expect(result?.reply).not.toContain('Какова цель')
    expect(deps.extract).toHaveBeenCalledOnce()
  })
  it('retains answers across an ambiguous selection without reading another client context', async () => {
    const { deps } = setup()
    const other = { ...client, id: 'other', fullName: 'Тестик Второй' }
    deps.matchClients.mockReturnValue([client, other])
    deps.extract.mockResolvedValue({ patch: { frequency: 2 }, clear: [], evidence: { frequency: 'два занятия' }, clarification: null })
    const pending = await programPilotTurn('Составь программу Тестику, два занятия в неделю', [client, other], null, deps)
    expect(pending?.action?.payload.pendingBrief).toEqual({ frequency: 2 })
    expect(deps.loadContext).not.toHaveBeenCalled()
    const selected = await programPilotTurn('2', [client, other], pending?.action, deps)
    expect(selected?.action?.payload.clientId).toBe('other')
    expect(selected?.action?.payload.briefState).toEqual({ frequency: 2, adult: true })
    expect(deps.extract).toHaveBeenCalledOnce()
  })
  it('does not copy old client answers when switching through unresolved selection', async () => {
    const { deps, latest } = setup()
    deps.extract.mockResolvedValue({ patch: {}, clear: [], evidence: {}, clarification: null })
    const pending = await programPilotTurn('Сменить клиента', [client], latest, deps)
    expect(pending?.action?.payload.step).toBe('client')
    expect(pending?.action?.payload.pendingBrief).toEqual({})
    const selected = await programPilotTurn('1', [client], pending?.action, deps)
    expect(selected?.action?.payload.briefState).toEqual({ adult: true })
  })
  it.each(['present', 'unknown'])('explains blocked limitations %s even when all answers exist', async (limitations) => {
    const { deps, latest } = setup()
    deps.extract.mockResolvedValue({ patch: { limitations }, clear: [], evidence: { limitations: 'Есть боль' }, clarification: null })
    const result = await programPilotTurn('Есть боль', [client], latest, deps)
    expect(result?.reply).toContain('Сначала нужно уточнить актуальные ограничения')
    expect(result?.action?.payload).toMatchObject({ readyToGenerate: false, briefStatus: 'needs_clarification', missing: [] })
    expect(deps.generate).not.toHaveBeenCalled()
  })
  it('retains old fields and explicitly asks again after a frequency mismatch', async () => {
    const { deps, latest } = setup()
    deps.extract.mockResolvedValue({ patch: { frequency: 2 }, clear: [], evidence: { frequency: 'Три занятия' }, clarification: null })
    const result = await programPilotTurn('Три занятия в неделю', [client], latest, deps)
    expect(result?.reply).toContain('однозначно определить частоту')
    expect(result?.action?.payload.briefState).toEqual(latest.payload.briefState)
    expect(result?.action?.payload.readyToGenerate).toBe(false)
    const repeat = await programPilotTurn(CONFIRM_PROGRAM_BRIEF, [client], result?.action, deps)
    expect(repeat?.action?.payload.readyToGenerate).toBe(false)
    expect(deps.generate).not.toHaveBeenCalled()
  })
  it('clarifies activity details and requires a specific acknowledgement of overlapping days', async () => {
    const { deps, latest } = setup()
    deps.extract.mockResolvedValue({ patch: { otherActivity: 'бег' }, clear: [], evidence: { otherActivity: 'бег' }, clarification: null })
    const details = await programPilotTurn('Ещё бег', [client], latest, deps)
    expect(details?.reply).toContain('какой вид, сколько раз')
    expect(details?.action?.payload.readyToGenerate).toBe(false)
    deps.extract.mockResolvedValue({ patch: { otherActivities: [{ kind: 'бег', frequency: 1, weekdays: [1] }] }, clear: [], evidence: { otherActivities: 'Бег раз в неделю, понедельник' }, clarification: null })
    const overlap = await programPilotTurn('Бег раз в неделю, понедельник', [client], details?.action, deps)
    expect(overlap?.reply).toContain('Дни программы совпадают')
    expect(overlap?.action?.payload.readyToGenerate).toBe(false)
    const confirmed = await programPilotTurn(CONFIRM_ACTIVITY_OVERLAP, [client], overlap?.action, deps)
    expect(confirmed?.action?.payload.readyToGenerate).toBe(true)
    expect(deps.generate).not.toHaveBeenCalled()
  })
  it('keeps the initial answers even if history is temporarily unavailable', async () => {
    const { deps } = setup(); deps.matchClients.mockReturnValue([client]); deps.loadContext.mockRejectedValue(new Error('offline'))
    deps.extract.mockResolvedValue({ patch: { frequency: 2 }, clear: [], evidence: { frequency: 'два занятия' }, clarification: null })
    const result = await programPilotTurn('Составь программу, два занятия', [client], null, deps)
    expect(result?.action?.payload.briefState).toMatchObject({ frequency: 2 })
    expect(result?.reply).toContain('Ответы сохранены')
  })
  it.each([HISTORY_COMPLETE, HISTORY_INCOMPLETE])('handles the visible history answer without an LLM call: %s', async (message) => {
    const { deps, latest } = setup()
    const result = await programPilotTurn(message, [client], { payload: { ...latest.payload, historyQuestion: true, readyToGenerate: false } }, deps)
    expect(result?.action?.payload.briefState).toMatchObject({ historyComplete: message === HISTORY_COMPLETE })
    expect(result?.action?.payload.readyToGenerate).toBe(message === HISTORY_INCOMPLETE)
    expect(result?.action?.payload.guidance).toBe(result?.reply)
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.generate).not.toHaveBeenCalled()
  })
  it('asks visibly about a small history, then generates only after the incomplete-history answer and a new confirmation', async () => {
    const { deps, latest, context } = setup()
    const workouts = ['2026-09-14', '2026-09-07', '2026-08-31', '2026-08-24'].map((date) => ({ id: date, date, clientId: client.id,
      status: 'done' as const, deletedAt: null, sessionRpe: 7, wellbeing: 'normal' as const, discomfort: false }))
    const source = buildProgramHistoryContext({ clientId: client.id, periodStart: '2026-07-22', periodEnd: '2026-09-15', workouts,
      exercises: workouts.map((row) => ({ id: row.id, workoutId: row.id, source: 'system', ref: 'leg-press', position: 0 })),
      sets: workouts.flatMap((row) => Array.from({ length: 4 }, (_, position) => ({ id: `${row.id}-${position}`, exerciseId: row.id, position,
        confirmedAt: `${row.date}T10:00:00Z`, factReps: 8, factWeightKg: 30, factDurationSec: null, factDistanceKm: null, factRpe: 7 }))),
    })
    deps.loadContext.mockResolvedValue({ ...context, ...source })
    const question = await programPilotTurn(CONFIRM_PROGRAM_BRIEF, [client], latest, deps)
    expect(question?.action?.payload).toMatchObject({ historyQuestion: true, readyToGenerate: false })
    expect(question?.action?.payload.guidance).toContain('Это вся история или часть тренировок не записана?')
    expect(deps.generate).not.toHaveBeenCalled()
    const clarified = await programPilotTurn(HISTORY_INCOMPLETE, [client], question?.action, deps)
    expect(clarified?.action?.payload.readyToGenerate).toBe(true)
    expect(deps.generate).not.toHaveBeenCalled()
    const generated = await programPilotTurn(CONFIRM_PROGRAM_BRIEF, [client], clarified?.action, deps)
    expect(generated?.action?.status).toBe('proposed')
    expect(generated?.action?.payload.loadBasis).toMatchObject({ mode: 'starting', weeklySetCeiling: null })
    expect(deps.generate).toHaveBeenCalledOnce()
    expect(deps.extract).not.toHaveBeenCalled()
  })
})
