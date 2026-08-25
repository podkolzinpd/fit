import { describe, expect, it } from 'vitest'
import { allowsAssistantAction, assistantCapabilitiesReply, assistantModelMessages, createClientTurn, createProgramTurn, isAssistantCapabilityQuestion, isSummaryCancellation, isSummaryRequest, isTurnIdReuse, readAssistantTurnRequest, recordWorkoutTurn, summaryPeriodFromMessage, summaryTurn, usesInformalAddress, validateAssistantTurnResponse } from './index.js'

describe('assistant orchestrator contract', () => {
  it('sends one bounded user prompt after the system message', () => {
    const messages = assistantModelMessages('Контекст и текущая реплика')
    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.text).toContain('безопасный ассистент')
    expect(messages[1]).toEqual({ role: 'user', text: 'Контекст и текущая реплика' })
  })

  it('accepts only bounded conversation turns', () => {
    expect(readAssistantTurnRequest({ conversation_id: '6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447', message: '  Составь программу  ' })).toEqual({ conversationId: '6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447', message: 'Составь программу' })
    expect(readAssistantTurnRequest({ conversation_id: 'bad', message: '' })).toBeUndefined()
    expect(isTurnIdReuse('исходный текст', 'другой текст')).toBe(true)
    expect(isTurnIdReuse('исходный текст', 'исходный текст')).toBe(false)
  })

  it('rejects model output outside the proposed-action union', () => {
    expect(validateAssistantTurnResponse({ reply: 'Нужны уточнения', action: { tool: 'delete_everything', status: 'applied', title: 'x', description: 'x', payload: {} } })).toBeUndefined()
    const validResponse = validateAssistantTurnResponse({ reply: 'Нужны дни и ограничения', action: { tool: 'create_program_draft', status: 'needs_input', title: 'Черновик программы', description: 'Уточню данные', payload: { fields: ['Цель'] } } })
    expect(validResponse?.action?.tool).toBe('create_program_draft')
    expect(validateAssistantTurnResponse({ reply: 'Готово', action: { tool: 'create_program_draft', status: 'proposed', title: 'Программа', description: '...', payload: { step: 'confirm', clientId: '6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447', clientName: 'Антон', brief: 'Новичок', sessions: [{ title: 'Тренировка A', day: 'Понедельник', exercises: [{ name: 'Жим лёжа', sets: 3, reps: 8 }] }] } } })?.action?.tool).toBe('create_program_draft')
    expect(validateAssistantTurnResponse({ reply: 'Готово', action: { tool: 'create_program_draft', status: 'proposed', title: 'Программа', description: '...', payload: { step: 'confirm' } } })).toBeUndefined()
    expect(validateAssistantTurnResponse({ reply: 'Готово', action: { tool: 'create_program_draft', status: 'proposed', title: 'Программа', description: '...', payload: { step: 'confirm', clientId: 'client-1', clientName: 'Антон', brief: 'Новичок', sessions: [{ title: 'Тренировка A', day: 'Понедельник', exercises: [{ name: 'Жим лёжа', sets: 3, reps: 8 }] }] } } })).toBeUndefined()
    expect(validateAssistantTurnResponse({ reply: 'Готово', action: { tool: 'create_program_draft', status: 'proposed', title: 'Программа', description: '...', payload: { step: 'confirm', clientId: '6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447', clientName: 'Антон', brief: 'Новичок', sessions: [{ title: 'Тренировка A', day: 'Понедельник', exercises: [{ name: 'Жим лёжа', sets: 0, reps: 8 }] }] } } })).toBeUndefined()
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

  it('collects workout dictation in fragments before handing it to review', () => {
    const clients = [{ id: 'client-1', fullName: 'Антон Ковалёв', goal: null, ageYears: null, heightCm: null, gender: null }]
    const start = recordWorkoutTurn('Запиши тренировку', clients, null)
    expect(start?.action?.payload).toEqual({ step: 'client' })
    const client = recordWorkoutTurn('Антон Ковалёв', clients, start?.action)
    expect(client?.action?.payload).toMatchObject({ step: 'workout', clientName: 'Антон Ковалёв' })
    const first = recordWorkoutTurn('жим лёжа 3 подхода по 50 кг 10 повторений', clients, client?.action)
    expect(first?.action).toMatchObject({ tool: 'record_workout', status: 'needs_input', payload: { step: 'workout', transcript: 'жим лёжа 3 подхода по 50 кг 10 повторений' } })
    const second = recordWorkoutTurn('присед 80 кг 3 подхода по 8', clients, first?.action)
    expect(second?.action?.payload).toMatchObject({ step: 'workout', transcript: 'жим лёжа 3 подхода по 50 кг 10 повторений\nприсед 80 кг 3 подхода по 8' })
    const draft = recordWorkoutTurn('Готово, разобрать тренировку', clients, second?.action)
    expect(draft?.action).toMatchObject({ tool: 'record_workout', status: 'proposed', payload: { step: 'confirm', clientName: 'Антон Ковалёв', transcript: 'жим лёжа 3 подхода по 50 кг 10 повторений\nприсед 80 кг 3 подхода по 8' } })
    expect(recordWorkoutTurn('отмена', clients, draft?.action)).toEqual({ reply: 'Хорошо, запись тренировки отменена.', action: null })
  })

  it('keeps a request to prepare a workout in the deterministic recording flow', () => {
    const clients = [{ id: 'client-1', fullName: 'Сан Саныч', goal: null, ageYears: null, heightCm: null, gender: null }]
    const result = recordWorkoutTurn('Давай подготовим запись тренировки для Сан Саныча', clients, null)
    expect(result?.action).toMatchObject({
      tool: 'record_workout', status: 'needs_input', payload: { step: 'workout', clientId: 'client-1', clientName: 'Сан Саныч', transcript: '' },
    })
    expect(result?.reply).toContain('по одному или все сразу')
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
