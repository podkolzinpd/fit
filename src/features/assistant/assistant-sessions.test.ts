import { describe, expect, it } from 'vitest'
import type { AssistantOrchestratorAction } from '../../data/repositories/assistant.repository'
import type { LocalDate } from '../../shared/local-date'
import { compactAssistantContent, conversationTitle, filterTerminalAssistantMessages, groupAssistantConversations, groupWorkoutDictationReceipts, isInteractiveAssistantAction, isReadOnlyConversation, isWorkoutDictationReceipt, latestActiveAssistantAction, latestActiveWorkoutAction, mergeAssistantMessages, selectTodayConversation, workoutDictationFragmentLabel } from './assistant-sessions'

const conversations = [
  { id: 'old', title: null, created_at: '2026-08-24T18:00:00.000Z' },
  { id: 'today-old', title: 'Утренняя беседа', created_at: '2026-08-25T06:00:00.000Z' },
  { id: 'today-new', title: null, created_at: '2026-08-25T09:00:00.000Z' },
]

describe('assistant sessions', () => {
  it('compacts the legacy workout-only wall in persisted history', () => {
    expect(compactAssistantContent('Сейчас в чате можно только добавить тренировку. Напишите «добавь тренировку» и укажите клиента, упражнения, подходы, повторы и вес.')).toBe('Сейчас я помогаю только записывать тренировки.')
    expect(compactAssistantContent('Привет!')).toBe('Привет!')
  })
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

  it('returns only the newest active action for the selected session', () => {
    const makeAction = (step: string, lifecycleStatus?: 'applied' | 'cancelled') => ({ tool: 'record_workout' as const, status: 'proposed' as const, title: step, description: step, payload: { step }, lifecycleStatus })
    const messages = [
      { id: 'old', conversation_id: 'today', turn_id: 'old', author: 'assistant', content: 'old', action: makeAction('old'), created_at: '2026-08-25T09:00:00.000Z' },
      { id: 'terminal', conversation_id: 'today', turn_id: 'terminal', author: 'assistant', content: 'Тренировка сохранена', action: makeAction('done', 'applied'), created_at: '2026-08-25T09:01:00.000Z' },
      { id: 'latest', conversation_id: 'today', turn_id: 'latest', author: 'assistant', content: 'latest', action: makeAction('latest'), created_at: '2026-08-25T09:02:00.000Z' },
      { id: 'archive', conversation_id: 'yesterday', turn_id: 'archive', author: 'assistant', content: 'archive', action: makeAction('archive'), created_at: '2026-08-24T09:00:00.000Z' },
    ]
    expect(latestActiveAssistantAction(messages, 'today')?.message.id).toBe('latest')
    const visible = filterTerminalAssistantMessages(messages)
    expect(visible.map((message) => message.id)).toEqual(['old', 'terminal', 'latest', 'archive'])
    expect(visible.find((message) => message.id === 'terminal')?.action?.lifecycleStatus).toBe('applied')
  })

  it('does not resurrect an older workout after the newest workout was applied', () => {
    const makeAction = (lifecycleStatus?: 'applied') => ({ tool: 'record_workout' as const, status: 'proposed' as const, title: 'Тренировка', description: 'Тренировка', payload: { step: 'confirm' }, lifecycleStatus })
    const messages = [
      { id: 'older-draft', conversation_id: 'today', turn_id: 'older', author: 'assistant', content: 'Черновик', action: makeAction(), created_at: '2026-08-25T09:00:00.000Z' },
      { id: 'saved', conversation_id: 'today', turn_id: 'saved', author: 'assistant', content: 'Тренировка сохранена', action: makeAction('applied'), created_at: '2026-08-25T09:01:00.000Z' },
    ]

    expect(latestActiveWorkoutAction(messages, 'today')).toBeUndefined()
    expect(filterTerminalAssistantMessages(messages).find((message) => message.id === 'saved')?.action?.lifecycleStatus).toBe('applied')
  })

  it('closes an undurable workout after a persisted cancel reply but keeps it through small talk', () => {
    const draft = { tool: 'record_workout' as const, status: 'needs_input' as const, title: 'Тренировка', description: 'Продолжайте', payload: { step: 'workout' } }
    const base = [
      { id: 'draft', conversation_id: 'today', turn_id: 'draft', author: 'assistant', content: 'Продолжайте', action: draft, created_at: '2026-08-25T09:00:00.000Z' },
      { id: 'small-talk', conversation_id: 'today', turn_id: 'hello', author: 'assistant', content: 'Здравствуйте!', action: null, created_at: '2026-08-25T09:01:00.000Z' },
    ]
    expect(latestActiveWorkoutAction(base, 'today')?.message.id).toBe('draft')
    const cancelled = [...base, { id: 'cancelled', conversation_id: 'today', turn_id: 'cancel', author: 'assistant', content: 'Хорошо, запись тренировки отменена.', action: null, created_at: '2026-08-25T09:02:00.000Z' }]
    expect(latestActiveWorkoutAction(cancelled, 'today')).toBeUndefined()
    const restarted = [...cancelled, { id: 'new-draft', conversation_id: 'today', turn_id: 'new-draft', author: 'assistant', content: 'Новая тренировка', action: draft, created_at: '2026-08-25T09:03:00.000Z' }]
    expect(latestActiveWorkoutAction(restarted, 'today')?.message.id).toBe('new-draft')
  })

  it('ignores legacy active tools when the chat is temporarily workout-only', () => {
    const workout = { tool: 'record_workout' as const, status: 'needs_input' as const, title: 'Тренировка', description: 'Продолжайте', payload: { step: 'workout' } }
    const legacy = { tool: 'create_program_draft' as const, status: 'needs_input' as const, title: 'Программа', description: 'Уточните', payload: { step: 'brief' } }
    const messages = [
      { id: 'workout', conversation_id: 'today', turn_id: 'workout', author: 'assistant', content: 'Продолжайте', action: workout, created_at: '2026-08-25T09:00:00.000Z' },
      { id: 'legacy', conversation_id: 'today', turn_id: 'legacy', author: 'assistant', content: 'Уточните', action: legacy, created_at: '2026-08-25T09:01:00.000Z' },
    ]
    expect(latestActiveAssistantAction(messages, 'today')?.message.id).toBe('legacy')
    expect(latestActiveWorkoutAction(messages, 'today')).toBeUndefined()
  })

  it('keeps an applied progress action for the durable inline summary', () => {
    const message = {
      id: 'summary', conversation_id: 'today', turn_id: 'summary', author: 'assistant',
      content: 'Сводка сформирована', action: {
        tool: 'summarize_progress' as const, status: 'proposed' as const, title: 'Сводка',
        description: 'Сводка сформирована', payload: { step: 'confirm' }, lifecycleStatus: 'applied' as const,
        result: { status: 'applied' },
      }, created_at: '2026-08-25T09:03:00.000Z',
    }
    expect(filterTerminalAssistantMessages([message])).toEqual([message])
  })

  it('identifies only user turns paired with a workout collection fragment', () => {
    const user = { id: 'user', conversation_id: 'today', turn_id: 'turn', author: 'user', content: 'жим лёжа', action: null, created_at: '2026-08-25T09:04:00.000Z' }
    const workout = { id: 'assistant', conversation_id: 'today', turn_id: 'turn', author: 'assistant', content: 'Добавила фрагмент', action: { tool: 'record_workout' as const, status: 'needs_input' as const, title: 'Тренировка', description: 'Добавила', payload: { step: 'workout', transcript: 'жим лёжа' } }, created_at: '2026-08-25T09:04:01.000Z' }
    expect(isWorkoutDictationReceipt(user, [user, workout])).toBe(true)
    expect(isWorkoutDictationReceipt({ ...user, turn_id: 'other' }, [user, workout])).toBe(false)
    expect(isWorkoutDictationReceipt(user, [user, { ...workout, action: { ...workout.action, payload: { step: 'confirm', transcript: 'жим лёжа' } } }])).toBe(false)
  })

  it('groups consecutive workout dictation receipts and keeps separate workout turns apart', () => {
    const userOne = { id: 'user-1', conversation_id: 'today', turn_id: 'turn-1', author: 'user', content: 'жим лёжа', action: null, created_at: '2026-08-25T09:04:00.000Z' }
    const actionOne = { id: 'assistant-1', conversation_id: 'today', turn_id: 'turn-1', author: 'assistant', content: 'Добавила', action: { tool: 'record_workout' as const, status: 'needs_input' as const, title: 'Тренировка', description: 'Добавила', payload: { step: 'workout', transcript: 'жим лёжа' } }, created_at: '2026-08-25T09:04:01.000Z' }
    const userTwo = { ...userOne, id: 'user-2', turn_id: 'turn-2', content: 'приседания' }
    const actionTwo = { ...actionOne, id: 'assistant-2', turn_id: 'turn-2', action: { ...actionOne.action, payload: { step: 'workout', transcript: 'приседания' } } }
    const cancelled = { id: 'cancelled', conversation_id: 'today', turn_id: 'turn-3', author: 'assistant', content: 'Хорошо, запись тренировки отменена.', action: null, created_at: '2026-08-25T09:05:00.000Z' }
    const userThree = { ...userOne, id: 'user-3', turn_id: 'turn-4', content: 'планка' }
    const actionThree = { ...actionOne, id: 'assistant-3', turn_id: 'turn-4', action: { ...actionOne.action, payload: { step: 'workout', transcript: 'планка' } } }
    const allMessages = [userOne, actionOne, userTwo, actionTwo, cancelled, userThree, actionThree]

    expect(groupWorkoutDictationReceipts(allMessages, allMessages)).toEqual([
      { firstMessageId: 'user-1', messageIds: ['user-1', 'user-2'], fragments: ['жим лёжа', 'приседания'] },
      { firstMessageId: 'user-3', messageIds: ['user-3'], fragments: ['планка'] },
    ])
  })

  it('formats Russian dictation fragment counts', () => {
    expect(workoutDictationFragmentLabel(1)).toBe('1 фрагмент')
    expect(workoutDictationFragmentLabel(3)).toBe('3 фрагмента')
    expect(workoutDictationFragmentLabel(12)).toBe('12 фрагментов')
    expect(workoutDictationFragmentLabel(21)).toBe('21 фрагмент')
  })
})
