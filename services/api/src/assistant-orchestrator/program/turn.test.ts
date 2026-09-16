import { describe, expect, it, vi } from 'vitest'
import { extractProgramBrief, programPilotTurn } from './turn.js'
import { CONFIRM_ACTIVITY_OVERLAP, CONFIRM_PROGRAM_BRIEF, HISTORY_COMPLETE, HISTORY_INCOMPLETE } from './brief.js'
import { fixture } from './fixtures.js'
import { buildProgramHistoryContext } from './context.js'
import type { ProgramBrief } from './brief.js'
import type { BriefAnswerContext } from './answer.js'

const client = { id: 'client', fullName: 'Тестик', ageYears: 30, goal: 'Старая цель' }
function setup() {
  const { brief, template } = fixture()
  const context = { ...buildProgramHistoryContext({ clientId: client.id, periodStart: '2026-07-22', periodEnd: '2026-09-15', workouts: [], exercises: [], sets: [] }), capturedAt: '2026-09-15T10:00:00Z', profile: { ageYears: 30, goal: null, latestWeight: null } }
  const deps = { actorId: 'trainer', turnId: 'turn', today: '2026-09-15', duplicateTurn: false,
    loadContext: vi.fn().mockResolvedValue(context), extract: vi.fn(), generate: vi.fn().mockResolvedValue(template), canGenerate: vi.fn().mockResolvedValue(true), matchClients: vi.fn().mockReturnValue([]) }
  const latest = { payload: { programPilot: true, briefAnswerVersion: 2, step: 'brief', clientId: client.id, briefState: brief, readyToGenerate: true } }
  return { deps, latest, context }
}
describe('program chat state', () => {
  it('keeps one question and passes its context to the next extraction', async () => {
    const { deps, latest } = setup()
    const active = { payload: { ...latest.payload, hasHistory: true, briefState: { adult: true }, guidance: 'Продолжаем прежний подход или меняем программу? Что важно сохранить?', askedFields: ['continuationPlan'] } }
    deps.extract.mockResolvedValue({ patch: { continuationPlan: 'Меняем программу', goalText: 'выносливость', goal: 'general_fitness' }, clear: [], evidence: { continuationPlan: 'Меняем программу', goalText: 'выносливость', goal: 'выносливость' }, clarification: null })
    const result = await programPilotTurn('Меняем программу, цель — выносливость', [client], active, deps)
    expect(deps.extract).toHaveBeenCalledWith({ adult: true }, 'Меняем программу, цель — выносливость', { question: active.payload.guidance, fields: ['continuationPlan'] })
    expect(result?.reply).toBe('Сколько занятий в неделю планируем: одно, два или три?')
    expect(result?.action?.payload.askedFields).toEqual(['frequency'])
  })
  it.each(['нет', 'предпочтений нет'])('advances past preferences on %s using the real extractor', async (message) => {
    const { deps, latest } = setup()
    const brief = { ...latest.payload.briefState }
    delete brief.preferences
    delete brief.otherActivity
    const active = { payload: { ...latest.payload, briefState: brief, askedFields: ['preferences'], guidance: 'Есть ли любимые или нежелательные упражнения?' } }
    deps.extract.mockImplementation((current: ProgramBrief, text: string, context?: BriefAnswerContext) => extractProgramBrief(current, text, deps.today, deps.turnId, context))
    const result = await programPilotTurn(message, [client], active, deps)
    expect(result?.action?.payload.briefState).toMatchObject({ preferences: 'нет', limitations: 'none' })
    expect(result?.action?.payload.askedFields).toEqual(['otherActivity'])
    expect(result?.reply).not.toContain('любимые')
  })
  it('does not generate from an old quiz where a preference negative could erase pain', async () => {
    const { deps, latest } = setup()
    const old = { ...latest.payload, briefAnswerVersion: undefined }
    const result = await programPilotTurn(CONFIRM_PROGRAM_BRIEF, [client], { payload: old }, deps)
    expect(result?.action?.payload.briefState).not.toHaveProperty('limitations')
    expect(result?.action?.payload.briefState).toMatchObject({ frequency: 3, durationMin: latest.payload.briefState.durationMin })
    expect(result?.action?.payload).toMatchObject({ readyToGenerate: false, briefAnswerVersion: 2, askedFields: ['limitations'] })
    expect(deps.generate).not.toHaveBeenCalled()
  })
  it('ignores unrelated new requests', async () => {
    const { deps } = setup()
    expect(await programPilotTurn('Привет', [client], null, deps)).toBeUndefined()
    expect(deps.extract).not.toHaveBeenCalled()
  })
  it('lets the model router distinguish a negated edit from cancellation', async () => {
    const { deps, latest } = setup()
    deps.extract.mockResolvedValue({ patch: {}, clear: [], evidence: {}, clarification: null })
    const result = await programPilotTurn('Не надо менять упражнения', [client], latest, deps, true)
    expect(result?.action?.tool).toBe('create_program_draft')
    expect(result?.action?.payload.briefState).toEqual(latest.payload.briefState)
    expect(result?.reply).not.toContain('отменено')
  })
  it('generates only on explicit confirmation with a fresh context', async () => {
    const { deps, latest } = setup()
    const result = await programPilotTurn(CONFIRM_PROGRAM_BRIEF, [client], latest, deps)
    expect(result?.action?.status).toBe('proposed')
    expect(result?.action?.payload.canonicalWorkouts).toHaveLength(12)
    expect(deps.loadContext).toHaveBeenCalledOnce()
    expect(deps.matchClients).not.toHaveBeenCalled()
  })
  it('allows a retry to read the durable generation cache', async () => {
    const { deps, latest } = setup(); deps.duplicateTurn = true
    expect((await programPilotTurn(CONFIRM_PROGRAM_BRIEF, [client], latest, deps))?.action?.status).toBe('proposed')
    expect(deps.generate).toHaveBeenCalledOnce()
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
  it.each(['Сменить клиента', 'Другой клиент'])('does not copy old answers or call the model before choosing a client: %s', async (message) => {
    const { deps, latest } = setup()
    deps.extract.mockResolvedValue({ patch: {}, clear: [], evidence: {}, clarification: null })
    const pending = await programPilotTurn(message, [client], latest, deps)
    expect(pending?.action?.payload.step).toBe('client')
    expect(pending?.action?.payload.pendingBrief).toEqual({})
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.loadContext).not.toHaveBeenCalled()
    expect(deps.generate).not.toHaveBeenCalled()
    const selected = await programPilotTurn('1', [client], pending?.action, deps)
    expect(selected?.action?.payload.briefState).toEqual({ adult: true })
  })
  it.each([undefined, 'pilot'])('selects the exact client button by candidate ID despite an ambiguous matcher and previous client %s', async (previousClientId) => {
    const { deps } = setup()
    const pilot = { ...client, id: 'pilot', fullName: 'Пилот программы' }
    const san = { ...client, id: 'san', fullName: 'Сан Саныч' }
    deps.matchClients.mockReturnValue([pilot, san])
    const pending = { payload: { programPilot: true, step: 'client', clientId: previousClientId, candidates: [pilot, san], pendingBrief: { frequency: 2 }, briefState: { frequency: 3, goalText: 'Старая цель Пилота' } } }
    const result = await programPilotTurn('Подготовить программу для Сан Саныч', [pilot, san], pending, deps, true)
    expect(result?.action?.payload).toMatchObject({ step: 'brief', clientId: 'san', clientName: 'Сан Саныч', briefState: { frequency: 2, adult: true } })
    expect(result?.action?.payload.briefState).not.toHaveProperty('goalText')
    expect(deps.loadContext).toHaveBeenCalledExactlyOnceWith(san)
    expect(deps.matchClients).not.toHaveBeenCalled()
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.generate).not.toHaveBeenCalled()
  })
  it('rejects a button candidate outside actor clients instead of falling back to the old client', async () => {
    const { deps } = setup()
    const pending = { payload: { programPilot: true, step: 'client', clientId: client.id, candidates: [{ id: 'foreign-client', fullName: 'Сан Саныч' }], pendingBrief: { frequency: 2 } } }
    const result = await programPilotTurn('Подготовить программу для Сан Саныч', [client], pending, deps, true)
    expect(result?.action?.payload).toMatchObject({ step: 'client', candidates: [{ id: client.id, fullName: client.fullName }], pendingBrief: { frequency: 2 } })
    expect(result?.action?.payload.clientId).toBeUndefined()
    expect(deps.loadContext).not.toHaveBeenCalled()
    expect(deps.matchClients).not.toHaveBeenCalled()
    expect(deps.extract).not.toHaveBeenCalled()
  })
  it('does not show old client facts if loading the explicitly selected client fails', async () => {
    const { deps } = setup()
    const san = { ...client, id: 'san', fullName: 'Сан Саныч' }
    deps.loadContext.mockRejectedValue(new Error('offline'))
    const pending = { payload: { programPilot: true, step: 'client', clientId: client.id, candidates: [san], pendingBrief: { frequency: 2 }, sourceSummary: 'Факты прежнего клиента', hasHistory: true } }
    const result = await programPilotTurn('Подготовить программу для Сан Саныч', [client, san], pending, deps, true)
    expect(result?.action?.payload).toMatchObject({ clientId: 'san', clientName: 'Сан Саныч', briefState: { frequency: 2, adult: true } })
    expect(result?.action?.payload.sourceSummary).toBeUndefined()
    expect(result?.action?.payload.hasHistory).toBeUndefined()
    expect(deps.extract).not.toHaveBeenCalled()
  })
  it.each(['present', 'unknown'])('asks about adjustments and continues with limitations %s', async (limitations) => {
    const { deps, latest } = setup()
    deps.extract.mockResolvedValue({ patch: { limitations, limitationsText: 'Есть боль' }, clear: [], evidence: { limitations: 'Есть боль', limitationsText: 'Есть боль' }, clarification: null })
    const result = await programPilotTurn('Есть боль', [client], latest, deps)
    expect(result?.reply).toContain('Какие движения')
    expect(result?.action?.payload).toMatchObject({ readyToGenerate: false, askedFields: ['limitationAdjustments'] })
    expect(deps.generate).not.toHaveBeenCalled()
    deps.extract.mockResolvedValue({ patch: { limitationAdjustments: 'пока неизвестно' }, clear: [], evidence: { limitationAdjustments: 'пока неизвестно' }, clarification: null })
    const ready = await programPilotTurn('пока неизвестно', [client], result?.action, deps)
    expect(ready?.action?.payload.readyToGenerate).toBe(true)
    const generated = await programPilotTurn(CONFIRM_PROGRAM_BRIEF, [client], ready?.action, deps)
    expect(generated?.action?.status).toBe('proposed')
    expect(generated?.action?.payload.limitationReview).toContain('пока неизвестно')
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
    expect(result?.action?.payload.readyToGenerate).toBe(false)
    expect(result?.action?.payload.guidance).toBe(result?.reply)
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.generate).not.toHaveBeenCalled()
  })
  it('asks visibly about small history and does not inflate volume after an incomplete-history answer', async () => {
    const { deps, latest, context } = setup()
    latest.payload.briefState.continuationPlan = 'Продолжить прежний подход'
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
    expect(clarified?.action?.payload.readyToGenerate).toBe(false)
    expect(deps.generate).not.toHaveBeenCalled()
    const generated = await programPilotTurn(CONFIRM_PROGRAM_BRIEF, [client], clarified?.action, deps)
    expect(generated?.action?.status).toBe('needs_input')
    expect(deps.generate).not.toHaveBeenCalled()
    expect(deps.extract).not.toHaveBeenCalled()
  })
})

it('retains the proposal on questions and repeated confirmation', async () => {
  const { deps, latest } = setup()
  const proposal = await programPilotTurn(CONFIRM_PROGRAM_BRIEF, [client], latest, deps)
  for (const message of ['Почему выбраны эти упражнения?', CONFIRM_PROGRAM_BRIEF]) {
    const result = await programPilotTurn(message, [client], proposal?.action, deps)
    expect(result?.action?.payload.canonicalWorkouts).toEqual(proposal?.action?.payload.canonicalWorkouts)
    expect(result?.action?.payload.step).toBe('confirm')
  }
  expect(deps.generate).toHaveBeenCalledOnce()
  expect(deps.extract).not.toHaveBeenCalled()
})
it('rejects existing planned sessions anywhere inside the program period before a model call', async () => {
  const { deps, latest, context } = setup()
  deps.loadContext.mockResolvedValue({ ...context, plannedWorkouts: [{ id: 'planned', date: '2026-09-17' }] })
  const result = await programPilotTurn(CONFIRM_PROGRAM_BRIEF, [client], latest, deps)
  expect(result?.action?.payload.readyToGenerate).toBe(false)
  expect(result?.reply).toContain('уже назначены')
  expect(deps.generate).not.toHaveBeenCalled()
})
