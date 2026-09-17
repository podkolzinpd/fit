import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { runAssistantTurn, type AssistantAction } from './index.js'
import { programModelJson } from './program/model.js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('./program/model.js', async (original) => ({ ...await original<typeof import('./program/model.js')>(), programModelJson: vi.fn() }))
const actorId = '2a234267-baa7-441c-ad31-a7e83d657d60'
const conversationId = '9b9a7e77-27de-4eb6-84c2-0af76dcc3827'
const actionId = '1a5e5661-0a39-48c1-9c01-4e4af2310fef'
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'publishable')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
  vi.stubEnv('ASSISTANT_PROGRAM_ENABLED', 'true')
})
afterEach(() => vi.unstubAllEnvs())

function setup(tool: 'record_workout' | 'create_program_draft', status: string, hideActiveFromHistory = false, role = 'trainer') {
  const action: AssistantAction = { id: actionId, tool, status: 'proposed', title: 'Черновик', description: 'Проверьте', payload: { step: 'confirm', transcript: 'жим 3 по 10', clientId: 'client-1', ...(tool === 'create_program_draft' ? { programPilot: true } : {}) } }
  const actor = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: actorId } } }) }, from: vi.fn(), rpc: vi.fn().mockImplementation((name: string) => Promise.resolve({ error: null, data: name === 'list_clients' ? [{ id: 'client-1', full_name: 'Антон Ковалёв', age_years: 30 }] : {} })) }
  const service = { rpc: vi.fn().mockResolvedValue({ error: null, data: {} }), from: vi.fn((table: string) => {
    let stateQuery = false
    const history = hideActiveFromHistory ? Array.from({ length: 20 }, () => ({ author: 'assistant', content: 'Обычная реплика', action: null }))
      : [{ author: 'assistant', content: 'Обычная реплика', action: null }, { author: 'assistant', content: 'Черновик', action }]
    const value = (single = false) => ({ error: null, data: table === 'assistant_conversations' ? { id: conversationId, owner_id: actorId }
      : table === 'profiles' ? { account_role: role, timezone: 'Europe/Moscow' }
        : table === 'assistant_actions' ? { status, version: 2 }
          : table === 'assistant_messages' ? single ? stateQuery ? { author: 'assistant', content: 'Черновик', action } : null : history : null })
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query), insert: vi.fn(() => query),
      or: vi.fn(() => { stateQuery = true; return query }),
      maybeSingle: vi.fn(() => Promise.resolve(value(true))),
      then: (resolve: (result: ReturnType<typeof value>) => unknown) => Promise.resolve(value()).then(resolve),
    }
    return query
  }) }
  vi.mocked(createClient).mockImplementation((_url, key) => (key === 'service' ? service : actor) as unknown as ReturnType<typeof createClient>)
  return { action, actor, service }
}

describe('program routing in the authenticated orchestrator', () => {
  it('asks for a client before reading history when a new program request shares a word with a client alias', async () => {
    const { actor } = setup('record_workout', 'applied')
    actor.rpc.mockResolvedValue({ error: null, data: [{ id: 'pilot', full_name: 'Пилот программы', age_years: 30 }] })
    vi.mocked(programModelJson).mockResolvedValueOnce({ tool: 'create_program_draft', mode: 'start', reply: '' }).mockResolvedValueOnce({ changes: [], clarification: null })
    const result = await runAssistantTurn('Bearer actor-token', { conversationId, turnId: crypto.randomUUID(), message: 'Составь программу на четыре недели' })
    expect(result.reply).toContain('Для кого составить программу')
    expect(result.action?.payload).toMatchObject({ step: 'client', candidates: [{ id: 'pilot', fullName: 'Пилот программы' }] })
    expect(result.action?.payload).not.toHaveProperty('clientId')
    expect(actor.from).not.toHaveBeenCalled()
    expect(actor.rpc).toHaveBeenCalledOnce()
  })
  it('resolves an explicitly named program client despite generic words inside the full alias', async () => {
    const { actor } = setup('record_workout', 'applied')
    actor.rpc.mockResolvedValue({ error: null, data: [{ id: 'pilot', full_name: 'Пилот программы', age_years: 30 }] })
    vi.mocked(programModelJson).mockResolvedValueOnce({ tool: 'create_program_draft', mode: 'start', reply: '' }).mockResolvedValueOnce({ changes: [], clarification: null })
    const result = await runAssistantTurn('Bearer actor-token', { conversationId, turnId: crypto.randomUUID(), message: 'Подготовить программу для Пилот программы' })
    expect(result.action?.payload).toMatchObject({ step: 'brief', clientId: 'pilot', clientName: 'Пилот программы' })
    expect(actor.from).toHaveBeenCalledWith('workouts')
  })
  it.each([
    ['record_workout', 'applied'], ['record_workout', 'cancelled'], ['create_program_draft', 'applied'], ['create_program_draft', 'cancelled'],
  ] as const)('clears %s lifecycle=%s before selecting a new function', async (tool, status) => {
    const { service } = setup(tool, status)
    vi.mocked(programModelJson).mockResolvedValueOnce({ tool: 'create_program_draft', mode: 'start', reply: '' })
      .mockResolvedValueOnce({ changes: [], clarification: null })
    const result = await runAssistantTurn('Bearer actor-token', { conversationId, turnId: crypto.randomUUID(), message: 'Нужен план на месяц' })
    expect(result.action).toMatchObject({ tool: 'create_program_draft', status: 'needs_input', payload: { step: 'client' } })
    expect(vi.mocked(programModelJson).mock.calls[0]![0].data).toMatchObject({ active: null })
    expect(service.rpc).toHaveBeenCalledWith('persist_assistant_response', expect.objectContaining({ p_action: result.action }))
  })
  it('keeps an unsaved recording across action-free history and blocks a new program', async () => {
    setup('record_workout', 'proposed')
    vi.mocked(programModelJson).mockResolvedValue({ tool: 'create_program_draft', mode: 'start', reply: '' })
    const result = await runAssistantTurn('Bearer actor-token', { conversationId, turnId: crypto.randomUUID(), message: 'Нужен план на месяц' })
    expect(result.reply).toContain('текущую запись тренировки')
    expect(result.action).toBeNull()
    expect(programModelJson).toHaveBeenCalledOnce()
  })
  it('keeps an unfinished tool after it leaves the 20-message conversation window', async () => {
    setup('record_workout', 'proposed', true)
    vi.mocked(programModelJson).mockResolvedValue({ tool: 'create_program_draft', mode: 'start', reply: '' })
    const result = await runAssistantTurn('Bearer actor-token', { conversationId, turnId: crypto.randomUUID(), message: 'Нужен план на месяц' })
    expect(result.reply).toContain('текущую запись тренировки')
    expect(vi.mocked(programModelJson).mock.calls[0]![0].data).toMatchObject({ active: { tool: 'record_workout' } })
    expect((vi.mocked(programModelJson).mock.calls[0]![0].data as { history: unknown[] }).history).toHaveLength(6)
  })
  it('cancels the persisted recording through its current version before clearing chat state', async () => {
    const { actor } = setup('record_workout', 'failed')
    const result = await runAssistantTurn('Bearer actor-token', { conversationId, turnId: crypto.randomUUID(), message: 'Отмена' })
    expect(actor.rpc).toHaveBeenCalledWith('cancel_assistant_action', { p_action_id: actionId, p_expected_version: 2 })
    expect(result).toEqual({ reply: 'Хорошо, запись тренировки отменена.', action: null })
    expect(programModelJson).not.toHaveBeenCalled()
  })
  it('leaves disabled-program recording on its existing path without a model router', async () => {
    setup('record_workout', 'applied')
    vi.stubEnv('ASSISTANT_PROGRAM_ENABLED', 'false')
    const result = await runAssistantTurn('Bearer actor-token', { conversationId, turnId: crypto.randomUUID(), message: 'Запиши тренировку Антону Ковалёву: жим 3 по 10' })
    expect(result.action?.tool).toBe('record_workout')
    expect(programModelJson).not.toHaveBeenCalled()
  })
})

it('allows a client account to use the shared assistant without trainer program routing', async () => {
  const { actor, service } = setup('record_workout', 'applied', false, 'client')
  await expect(runAssistantTurn('Bearer actor-token', { conversationId, turnId: crypto.randomUUID(), message: 'Что ты умеешь?' })).resolves.toEqual({
    reply: 'Могу коротко пообщаться и записать тренировку — целиком или по одному упражнению, текстом или голосом.',
    action: null,
  })
  expect(programModelJson).not.toHaveBeenCalled()
  expect(actor.rpc).not.toHaveBeenCalled()
  expect(service.rpc).toHaveBeenCalledWith('persist_assistant_response', expect.any(Object))
})
