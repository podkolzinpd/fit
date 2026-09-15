import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantAction } from './index.js'
import { recordWorkoutTurn } from './index.js'
import { chooseAssistantRoute, latestActiveAssistantTool, readAssistantRoute, routedAssistantTurn } from './router.js'
import { programModelJson } from './program/model.js'
import { CONFIRM_PROGRAM_BRIEF } from './program/brief.js'
import { programPilotTurn } from './program/turn.js'
import { buildProgramHistoryContext } from './program/context.js'

vi.mock('./program/model.js', async (original) => ({ ...await original<typeof import('./program/model.js')>(), programModelJson: vi.fn() }))
beforeEach(() => vi.clearAllMocks())
const client = { id: 'client-1', fullName: 'Антон Ковалёв', ageYears: 30, goal: null, heightCm: null, gender: null }
function draft(tool: 'record_workout' | 'create_program_draft'): AssistantAction {
  return { tool, status: 'needs_input', title: 'Черновик', description: 'Уточняю', payload: { step: tool === 'record_workout' ? 'workout' : 'brief', clientId: client.id, transcript: 'жим 3 по 10', privateContext: 'must-not-enter-router' } }
}
function deps(tool: 'record_workout' | 'create_program_draft', mode: 'start' | 'continue' | 'cancel' = 'start') {
  return { choose: vi.fn().mockResolvedValue({ tool, mode, reply: '' }), record: vi.fn(), program: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) }
}

describe('model assistant router', () => {
  it('passes only short recent chat and active tool metadata to the model', async () => {
    vi.mocked(programModelJson).mockResolvedValue({ tool: 'create_program_draft', mode: 'start', reply: '' })
    const history = Array.from({ length: 10 }, (_, index) => ({ author: 'user', content: String(index).repeat(1_500) }))
    expect(await chooseAssistantRoute('Нужен план на месяц', history, draft('record_workout'), 'turn')).toMatchObject({ tool: 'create_program_draft', mode: 'start' })
    const args = vi.mocked(programModelJson).mock.calls[0]![0]
    expect(args).toMatchObject({ maxTokens: 300, timeoutMs: 15_000 })
    const data = args.data as { history: typeof history; active: unknown }
    expect(data.history).toHaveLength(6)
    expect(data.history.every((row) => row.content.length <= 1_000)).toBe(true)
    expect(data.active).toEqual({ tool: 'record_workout', step: 'workout', status: 'needs_input' })
    expect(JSON.stringify(data)).not.toContain('must-not-enter-router')
  })
  it('continues exact active program controls without a second paid routing call', async () => {
    expect(await chooseAssistantRoute(CONFIRM_PROGRAM_BRIEF, [], draft('create_program_draft'), 'turn')).toMatchObject({ tool: 'create_program_draft', mode: 'continue' })
    expect(programModelJson).not.toHaveBeenCalled()
  })
  it.each([
    ['create_program_draft', 'Подготовить программу для Антон Ковалёв'],
    ['record_workout', 'Записать тренировку для Антон Ковалёв'],
  ] as const)('continues the actual client-selection button for %s without another model call', async (tool, message) => {
    const active = draft(tool)
    active.payload = { step: 'client', candidates: [{ id: client.id, fullName: client.fullName }] }
    expect(await chooseAssistantRoute(message, [], active, 'turn')).toEqual({ tool, mode: 'continue', reply: '' })
    expect(programModelJson).not.toHaveBeenCalled()
  })
  it.each(['Подготовить программу для Другой клиент', 'Записать тренировку для Антон Ковалёв'])('does not bypass model routing for a foreign name or mismatched client-button tool: %s', async (message) => {
    const active = draft('create_program_draft')
    active.payload = { step: 'client', candidates: [{ id: client.id, fullName: client.fullName }] }
    vi.mocked(programModelJson).mockResolvedValue({ tool: null, mode: 'chat', reply: 'Уточните клиента.' })
    expect(await chooseAssistantRoute(message, [], active, 'turn')).toMatchObject({ mode: 'chat' })
    expect(programModelJson).toHaveBeenCalledOnce()
  })
  it('withdraws the old program proposal before changing conditions through the actual UI control', async () => {
    const active = draft('create_program_draft')
    const handlers = deps('create_program_draft', 'continue')
    handlers.program.mockResolvedValue({ reply: 'Уточните условия', action: null })
    const message = 'Изменить условия программы'
    expect(await chooseAssistantRoute(message, [], active, 'turn')).toMatchObject({ mode: 'continue' })
    expect(programModelJson).not.toHaveBeenCalled()
    await routedAssistantTurn({ message, history: [], active, operationId: 'turn' }, handlers)
    expect(handlers.cancel).toHaveBeenCalledWith(active)
    expect(handlers.program).toHaveBeenCalledWith(active)
    expect(handlers.cancel.mock.invocationCallOrder[0]).toBeLessThan(handlers.program.mock.invocationCallOrder[0]!)
  })
  it.each(['Сменить клиента', 'Другой клиент', 'сменить клиента', 'другой клиент'])('changes the program client without model routing and withdraws the old saveable proposal: %s', async (message) => {
    const active = { ...draft('create_program_draft'), id: 'old-program-action', status: 'proposed' as const }
    const cancel = vi.fn().mockResolvedValue(undefined)
    const program = vi.fn().mockImplementation((previous) => {
      expect(cancel).toHaveBeenCalledWith(active)
      expect(previous).toBe(active)
      return Promise.resolve({ reply: 'Выберите клиента', action: { ...draft('create_program_draft'), payload: { step: 'client', candidates: [{ id: client.id, fullName: client.fullName }] } } })
    })
    const record = vi.fn()
    const result = await routedAssistantTurn({ message, history: [], active, operationId: 'turn' }, { program, record, cancel })
    expect(programModelJson).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
    expect(program).toHaveBeenCalledOnce()
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(program.mock.invocationCallOrder[0]!)
    expect(result.action).toMatchObject({ tool: 'create_program_draft', status: 'needs_input', payload: { step: 'client' } })
    expect(result.action?.id).toBeUndefined()
    expect(record).not.toHaveBeenCalled()
  })
  it('does not select a new client if withdrawing the old program action fails', async () => {
    const active = { ...draft('create_program_draft'), id: 'old-program-action', status: 'proposed' as const }
    const before = structuredClone(active)
    const handlers = { cancel: vi.fn().mockRejectedValue(new Error('assistant_action_conflict')), program: vi.fn(), record: vi.fn() }
    await expect(routedAssistantTurn({ message: 'Сменить клиента', history: [], active, operationId: 'turn' }, handlers)).rejects.toThrow('assistant_action_conflict')
    expect(handlers.cancel).toHaveBeenCalledWith(active)
    expect(handlers.program).not.toHaveBeenCalled()
    expect(handlers.record).not.toHaveBeenCalled()
    expect(active).toEqual(before)
    expect(programModelJson).not.toHaveBeenCalled()
  })
  it('allows changing an unfinished program client before a durable action exists', async () => {
    const active = draft('create_program_draft')
    const handlers = { cancel: vi.fn().mockResolvedValue(undefined), program: vi.fn().mockResolvedValue({ reply: 'Выберите клиента', action: null }), record: vi.fn() }
    await routedAssistantTurn({ message: 'Другой клиент', history: [], active, operationId: 'turn' }, handlers)
    expect(active.id).toBeUndefined()
    expect(handlers.cancel).toHaveBeenCalledWith(active)
    expect(handlers.program).toHaveBeenCalledWith(active)
    expect(programModelJson).not.toHaveBeenCalled()
  })
  it.each(['Сменить клиента', 'Другой клиент'])('does not apply the program client-change control to an existing workout: %s', async (message) => {
    const active = { ...draft('record_workout'), id: 'workout-action', status: 'proposed' as const }
    const before = structuredClone(active)
    vi.mocked(programModelJson).mockResolvedValue({ tool: 'create_program_draft', mode: 'start', reply: '' })
    const handlers = { cancel: vi.fn(), program: vi.fn(), record: vi.fn() }
    const result = await routedAssistantTurn({ message, history: [], active, operationId: 'turn' }, handlers)
    expect(programModelJson).toHaveBeenCalledOnce()
    expect(result.reply).toContain('Сначала завершите или отмените текущую запись тренировки')
    expect(handlers.cancel).not.toHaveBeenCalled()
    expect(handlers.program).not.toHaveBeenCalled()
    expect(handlers.record).not.toHaveBeenCalled()
    expect(active).toEqual(before)
  })
  it.each([
    { tool: 'delete_client', mode: 'start', reply: '' },
    { tool: null, mode: 'cancel', reply: '' },
    { tool: 'record_workout', mode: 'chat', reply: 'Привет' },
    { tool: null, mode: 'chat', reply: ' ' },
    { tool: null, mode: 'chat', reply: 'Создание программы отменено.' },
  ])('rejects unsupported or contradictory router output %j', (value) => {
    expect(() => readAssistantRoute(value)).toThrow('assistant_router_invalid_response')
  })
  it('invokes program collection by model choice without a regex trigger or workout parser', async () => {
    const message = 'Нужен план на месяц для Антона'
    const context = { ...buildProgramHistoryContext({ clientId: client.id, periodStart: '2026-07-22', periodEnd: '2026-09-15', workouts: [], exercises: [], sets: [] }), capturedAt: '2026-09-15T10:00:00Z', profile: { ageYears: 30, goal: null, latestWeight: null } }
    const programDeps = { actorId: 'trainer', turnId: 'turn', today: '2026-09-15', duplicateTurn: false,
      matchClients: () => [client], loadContext: vi.fn().mockResolvedValue(context), extract: vi.fn().mockResolvedValue({ patch: {}, clear: [], evidence: {}, clarification: null }), generate: vi.fn(), canGenerate: vi.fn() }
    const handlers = deps('create_program_draft')
    handlers.program.mockImplementation((previous) => programPilotTurn(message, [client], previous, programDeps, true))
    const result = await routedAssistantTurn({ message, history: [], active: null, operationId: 'turn' }, handlers)
    expect(result.action).toMatchObject({ tool: 'create_program_draft', payload: { step: 'brief', clientId: client.id } })
    expect(handlers.program).toHaveBeenCalledWith(null)
    expect(handlers.record).not.toHaveBeenCalled()
    expect(programDeps.loadContext).toHaveBeenCalledOnce()
    expect(programDeps.generate).not.toHaveBeenCalled()
  })
  it('invokes the existing recording flow with the unchanged dictated text', async () => {
    const message = 'Антон Ковалёв: жим лёжа 3 по 10 50 кг'
    const handlers = deps('record_workout')
    handlers.record.mockImplementation((previous) => recordWorkoutTurn(message, [client], previous, true))
    const result = await routedAssistantTurn({ message, history: [], active: null, operationId: 'turn' }, handlers)
    expect(result.action).toMatchObject({ tool: 'record_workout', payload: { transcript: 'жим лёжа 3 по 10 50 кг' } })
    expect(handlers.record).toHaveBeenCalledWith(null)
    expect(handlers.program).not.toHaveBeenCalled()
  })
  it('blocks a tool switch without feeding its text into the current draft', async () => {
    const active = draft('create_program_draft'); const before = structuredClone(active)
    const handlers = deps('record_workout')
    const result = await routedAssistantTurn({ message: 'Запиши тренировку', history: [], active, operationId: 'turn' }, handlers)
    expect(result.reply).toContain('завершите или отмените')
    expect(result.action).toBeNull()
    expect(handlers.record).not.toHaveBeenCalled()
    expect(handlers.program).not.toHaveBeenCalled()
    expect(active).toEqual(before)
    expect(latestActiveAssistantTool([{ author: 'assistant', content: result.reply, action: null }, { author: 'assistant', action: active }])).toBe(active)
  })
  it('preserves a recording draft across ordinary conversation without appending the question', async () => {
    const active = draft('record_workout'); const before = structuredClone(active)
    const handlers = deps('record_workout')
    handlers.choose.mockResolvedValue({ tool: null, mode: 'chat', reply: 'Да, я на связи.' })
    const result = await routedAssistantTurn({ message: 'Ты тут?', history: [], active, operationId: 'turn' }, handlers)
    expect(result).toEqual({ reply: 'Да, я на связи.', action: null })
    expect(handlers.record).not.toHaveBeenCalled()
    expect(active).toEqual(before)
  })
  it('rejects a continuation for a different tool', async () => {
    const handlers = deps('record_workout', 'continue')
    const result = await routedAssistantTurn({ message: 'Ещё одно упражнение', history: [], active: draft('create_program_draft'), operationId: 'turn' }, handlers)
    expect(result.reply).toContain('Уточните')
    expect(handlers.record).not.toHaveBeenCalled()
    expect(handlers.program).not.toHaveBeenCalled()
  })
  it.each(['record_workout', 'create_program_draft'] as const)('cancels %s and stops older draft resurrection', async (tool) => {
    const active = draft(tool); const handlers = deps(tool, 'cancel')
    const result = await routedAssistantTurn({ message: 'Отмена', history: [], active, operationId: 'turn' }, handlers)
    expect(handlers.cancel).toHaveBeenCalledWith(active)
    expect(latestActiveAssistantTool([{ author: 'assistant', content: 'Ок', action: null }, { author: 'assistant', content: result.reply, action: null }, { author: 'assistant', action: active }])).toBeNull()
  })
  it('rejects the real model inferred cancellation on a request for a new four-week plan', async () => {
    const active = draft('record_workout'); const before = structuredClone(active)
    const handlers = deps('record_workout', 'cancel')
    handlers.choose.mockResolvedValue({ tool: 'record_workout', mode: 'cancel', reply: 'Хорошо, отменим текущую запись тренировки.' })
    const result = await routedAssistantTurn({ message: 'Теперь нужен план занятий на четыре недели.', history: [], active, operationId: 'turn' }, handlers)
    expect(result.reply).toContain('Сначала завершите или отмените')
    expect(handlers.cancel).not.toHaveBeenCalled()
    expect(handlers.record).not.toHaveBeenCalled()
    expect(handlers.program).not.toHaveBeenCalled()
    expect(active).toEqual(before)
    expect(latestActiveAssistantTool([{ author: 'assistant', content: result.reply, action: null }, { author: 'assistant', action: active }])).toBe(active)
  })
  it.each(['Не надо менять упражнения', 'Не отменяй программу', 'Он сказал «отмена»', 'Отмени запись тренировки'])('does not cancel a program on an unsupported cancellation intent: %s', async (message) => {
    const active = draft('create_program_draft'); const handlers = deps('create_program_draft', 'cancel')
    const result = await routedAssistantTurn({ message, history: [], active, operationId: 'turn' }, handlers)
    expect(result.reply).toContain('Черновик сохранён')
    expect(handlers.cancel).not.toHaveBeenCalled()
  })
  it.each(['Отмени текущую запись тренировки', 'Пожалуйста, закрой этот черновик.', 'Не надо'])('accepts explicit cancellation of the active recording: %s', async (message) => {
    const active = draft('record_workout'); const handlers = deps('record_workout', 'cancel')
    expect(await chooseAssistantRoute(message, [], active, 'turn')).toMatchObject({ tool: 'record_workout', mode: 'cancel' })
    expect(programModelJson).not.toHaveBeenCalled()
    await routedAssistantTurn({ message, history: [], active, operationId: 'turn' }, handlers)
    expect(handlers.cancel).toHaveBeenCalledWith(active)
  })
  it('fails closed on router errors and preserves the draft for retry', async () => {
    const handlers = deps('record_workout'); handlers.choose.mockRejectedValue(new Error('timeout'))
    const result = await routedAssistantTurn({ message: 'Нужен план на месяц', history: [], active: draft('record_workout'), operationId: 'turn' }, handlers)
    expect(result.reply).toContain('Повторите сообщение')
    expect(handlers.record).not.toHaveBeenCalled()
    expect(handlers.program).not.toHaveBeenCalled()
    expect(handlers.cancel).not.toHaveBeenCalled()
  })
})
