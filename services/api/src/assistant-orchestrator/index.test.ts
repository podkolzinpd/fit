import { describe, expect, it } from 'vitest'
import { readAssistantTurnRequest, validateAssistantTurnResponse } from './index.js'

describe('assistant orchestrator contract', () => {
  it('accepts only bounded conversation turns', () => {
    expect(readAssistantTurnRequest({ conversation_id: '6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447', message: '  Составь программу  ' })).toEqual({ conversationId: '6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447', message: 'Составь программу' })
    expect(readAssistantTurnRequest({ conversation_id: 'bad', message: '' })).toBeUndefined()
  })

  it('rejects model output outside the proposed-action union', () => {
    expect(validateAssistantTurnResponse({ reply: 'Нужны уточнения', action: { tool: 'delete_everything', status: 'applied', title: 'x', description: 'x', payload: {} } })).toBeUndefined()
    expect(validateAssistantTurnResponse({ reply: 'Нужны дни и ограничения', action: { tool: 'create_program_draft', status: 'needs_input', title: 'Черновик программы', description: 'Уточню данные', payload: { fields: ['Цель'] } } })).toEqual(expect.objectContaining({ action: expect.objectContaining({ tool: 'create_program_draft' }) }))
  })
})
