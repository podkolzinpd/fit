import { describe, expect, it } from 'vitest'
import { allowsAssistantAction, assistantCapabilitiesReply, isAssistantCapabilityQuestion, isSummaryCancellation, isSummaryRequest, readAssistantTurnRequest, summaryPeriodFromMessage, summaryTurn, usesInformalAddress, validateAssistantTurnResponse } from './index.js'

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
    expect(assistantCapabilitiesReply()).toContain('Сформировать сводку прогресса')
  })

  it('recognizes summary requests, periods and informal address deterministically', () => {
    expect(isSummaryRequest('Покажи динамику клиента')).toBe(true)
    expect(summaryPeriodFromMessage('за последние 30 дней', new Date('2026-08-24T12:00:00Z'))).toEqual({ periodStart: '2026-07-26', periodEnd: '2026-08-24', label: 'последние 30 дней' })
    expect(usesInformalAddress('Что ты умеешь?')).toBe(true)
    expect(usesInformalAddress('Что вы умеете?')).toBe(false)
  })

  it('cancels a summary flow and does not continue it on unrelated chat', () => {
    const clients = [{ id: 'client-1', fullName: 'Сан Саныч', goal: null, ageYears: null, heightCm: null, gender: null }]
    const waitingForClient = { tool: 'summarize_progress', status: 'needs_input', title: 'Уточните клиента', description: '...', payload: { step: 'client' } }
    expect(summaryTurn('привет', clients, waitingForClient, new Date('2026-08-24T12:00:00Z'))).toBeUndefined()
    const cancelled = summaryTurn('отмена', clients, waitingForClient, new Date('2026-08-24T12:00:00Z'))
    expect(cancelled).toEqual({ reply: 'Хорошо, сценарий формирования сводки отменён.', action: null })
    expect(isSummaryCancellation('закрыть сценарий')).toBe(true)
  })
})
