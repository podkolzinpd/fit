import { describe, expect, it } from 'vitest'
import type { AssistantOrchestratorAction } from '../../data/repositories/assistant.repository'
import type { LocalDate } from '../../shared/local-date'
import { conversationTitle, groupAssistantConversations, isInteractiveAssistantAction, isReadOnlyConversation, mergeAssistantMessages, selectTodayConversation } from './assistant-sessions'

const conversations = [
  { id: 'old', title: null, created_at: '2026-08-24T18:00:00.000Z' },
  { id: 'today-old', title: 'Утренняя беседа', created_at: '2026-08-25T06:00:00.000Z' },
  { id: 'today-new', title: null, created_at: '2026-08-25T09:00:00.000Z' },
]

describe('assistant sessions', () => {
  it('groups conversations by the actor local date and selects the newest today', () => {
    const groups = groupAssistantConversations(conversations, 'Europe/Moscow', '2026-08-25' as LocalDate)
    expect(groups.map((group) => [group.date, group.conversations.map((item) => item.id)])).toEqual([
      ['2026-08-25', ['today-new', 'today-old']],
      ['2026-08-24', ['old']],
    ])
    expect(selectTodayConversation(conversations, 'Europe/Moscow', '2026-08-25' as LocalDate)?.id).toBe('today-new')
  })

  it('keeps a previous session read-only when it is not today', () => {
    const groups = groupAssistantConversations(conversations, 'Europe/Moscow', '2026-08-26' as LocalDate)
    expect(groups.map((group) => group.date)).toEqual(['2026-08-25', '2026-08-24'])
    expect(isReadOnlyConversation('old', 'today-new')).toBe(true)
    expect(isReadOnlyConversation('today-new', 'today-new')).toBe(false)
    expect(conversationTitle(conversations[0]!, '2026-08-24' as LocalDate, '2026-08-26' as LocalDate)).toBe('Диалог за день')
  })

  it('merges only actions belonging to the selected conversation and identifies terminal actions', () => {
    const action: AssistantOrchestratorAction = { tool: 'record_workout', status: 'proposed', title: 'Тренировка', description: 'Сохранить', payload: { step: 'confirm' } }
    const messages = [{ id: 'message-1', conversation_id: 'today', turn_id: 'turn-1', author: 'assistant', content: 'Проверьте', action, created_at: '2026-08-25T09:00:00.000Z' }]
    const merged = mergeAssistantMessages(messages, [{ id: 'action-1', conversation_id: 'today', assistant_message_id: 'message-1', status: 'applied', version: 2, result: { workoutId: 'workout-1' } }])
    expect(merged[0]?.action).toMatchObject({ id: 'action-1', lifecycleStatus: 'applied' })
    expect(isInteractiveAssistantAction(merged[0]?.action ?? null)).toBe(false)
    expect(isInteractiveAssistantAction(action)).toBe(true)

    const foreign = mergeAssistantMessages(messages, [{ id: 'foreign-action', conversation_id: 'old', assistant_message_id: 'message-1', status: 'cancelled', version: 1, result: null }])
    expect(foreign[0]?.action).toEqual(action)
  })
})
