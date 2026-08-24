import { describe, expect, it } from 'vitest'
import { allowsAssistantAction, assistantCapabilitiesReply, isAssistantCapabilityQuestion, readAssistantTurnRequest, validateAssistantTurnResponse } from './index.js'

describe('assistant orchestrator contract', () => {
  it('accepts only bounded conversation turns', () => {
    expect(readAssistantTurnRequest({ conversation_id: '6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447', message: '  Составь программу  ' })).toEqual({ conversationId: '6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447', message: 'Составь программу' })
    expect(readAssistantTurnRequest({ conversation_id: 'bad', message: '' })).toBeUndefined()
  })

  it('rejects model output outside the proposed-action union', () => {
    expect(validateAssistantTurnResponse({ reply: 'Нужны уточнения', action: { tool: 'delete_everything', status: 'applied', title: 'x', description: 'x', payload: {} } })).toBeUndefined()
    const validResponse = validateAssistantTurnResponse({ reply: 'Нужны дни и ограничения', action: { tool: 'create_program_draft', status: 'needs_input', title: 'Черновик программы', description: 'Уточню данные', payload: { fields: ['Цель'] } } })
    expect(validResponse?.action?.tool).toBe('create_program_draft')
  })

  it('allows action cards only for explicit application commands', () => {
    expect(allowsAssistantAction('привет?')).toBe(false)
    expect(allowsAssistantAction('Что ты умеешь')).toBe(false)
    expect(allowsAssistantAction('какие функции вообще есть?')).toBe(false)
    expect(allowsAssistantAction('Привет, составь программу')).toBe(true)
    expect(allowsAssistantAction('Добавь нового клиента')).toBe(true)
  })

  it('answers capability questions from the executable capability registry', () => {
    expect(isAssistantCapabilityQuestion('что ты умеешь?')).toBe(true)
    expect(isAssistantCapabilityQuestion('какие функции вообще есть?')).toBe(true)
    expect(isAssistantCapabilityQuestion('привет')).toBe(false)
    expect(assistantCapabilitiesReply()).toBe('Пока я не выполняю действий в приложении. Могу только коротко пообщаться.')
  })
})
