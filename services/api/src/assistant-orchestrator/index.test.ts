import { describe, expect, it } from 'vitest'
import { allowsAssistantAction, assistantCapabilitiesReply, createClientTurn, createProgramTurn, isAssistantCapabilityQuestion, isSummaryCancellation, isSummaryRequest, readAssistantTurnRequest, recordWorkoutTurn, summaryPeriodFromMessage, summaryTurn, usesInformalAddress, validateAssistantTurnResponse } from './index.js'

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

  it('collects a client draft before proposing creation', () => {
    const start = createClientTurn('Добавь нового клиента', null)
    expect(start?.action?.payload).toEqual({ step: 'name' })
    const name = createClientTurn('Анна Смирнова', start?.action)
    expect(name?.action?.payload).toMatchObject({ step: 'profile', fullName: 'Анна Смирнова' })
    const details = createClientTurn('женщина, 32 года, 168 см', name?.action)
    expect(details?.action).toMatchObject({ status: 'proposed', payload: { step: 'confirm', fullName: 'Анна Смирнова', gender: 'female', ageYears: 32, heightCm: 168 } })
    expect(createClientTurn('отмена', details?.action)).toEqual({ reply: 'Хорошо, создание карточки клиента отменено.', action: null })
  })

  it('hands a workout draft to the existing workout review after client selection', () => {
    const clients = [{ id: 'client-1', fullName: 'Антон Ковалёв', goal: null, ageYears: null, heightCm: null, gender: null }]
    const start = recordWorkoutTurn('Запиши тренировку', clients, null)
    expect(start?.action?.payload).toEqual({ step: 'client' })
    const client = recordWorkoutTurn('Антон Ковалёв', clients, start?.action)
    expect(client?.action?.payload).toMatchObject({ step: 'workout', clientName: 'Антон Ковалёв' })
    const draft = recordWorkoutTurn('жим лёжа 3 подхода по 50 кг 10 повторений', clients, client?.action)
    expect(draft?.action).toMatchObject({ tool: 'record_workout', status: 'proposed', payload: { step: 'confirm', clientName: 'Антон Ковалёв', transcript: 'жим лёжа 3 подхода по 50 кг 10 повторений' } })
    expect(recordWorkoutTurn('отмена', clients, draft?.action)).toEqual({ reply: 'Хорошо, запись тренировки отменена.', action: null })
  })

  it('collects a complete brief before proposing a training program', () => {
    const clients = [{ id: 'client-1', fullName: 'Антон Ковалёв', goal: 'Набрать силу', ageYears: 32, heightCm: 180, gender: 'male' }]
    const start = createProgramTurn('Составь программу тренировок', clients, null)
    const client = createProgramTurn('Антон Ковалёв', clients, start?.action)
    expect(client?.action?.payload).toMatchObject({ step: 'brief', clientId: 'client-1' })
    const brief = createProgramTurn('Новичок, без ограничений, понедельник и четверг', clients, client?.action)
    expect(brief?.action).toMatchObject({ tool: 'create_program_draft', status: 'proposed', payload: { step: 'generate', clientId: 'client-1' } })
    expect(createProgramTurn('отмена', clients, brief?.action)).toEqual({ reply: 'Хорошо, создание программы отменено.', action: null })
  })
})
