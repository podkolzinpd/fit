import { describe, expect, it, vi } from 'vitest'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('./client', () => ({ supabase: { from } }))

import { assistantHistoryQueries } from './assistant-history.queries'

describe('assistant history queries', () => {
  it('creates a conversation under the authenticated actor identity supplied by the caller', () => {
    const single = vi.fn()
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    from.mockReturnValue({ insert })

    assistantHistoryQueries.createConversation('00000000-0000-4000-8000-000000000001', 'Новая беседа')

    expect(from).toHaveBeenCalledWith('assistant_conversations')
    expect(insert).toHaveBeenCalledWith({ owner_id: '00000000-0000-4000-8000-000000000001', title: 'Новая беседа' })
  })

  it('never inserts an assistant response from the browser transport', () => {
    const single = vi.fn()
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    from.mockReturnValue({ insert })

    assistantHistoryQueries.appendUserMessage('00000000-0000-4000-8000-000000000002', 'Покажи прогресс')

    expect(from).toHaveBeenCalledWith('assistant_messages')
    expect(insert).toHaveBeenCalledWith({
      conversation_id: '00000000-0000-4000-8000-000000000002', author: 'user', content: 'Покажи прогресс',
    })
  })
})
