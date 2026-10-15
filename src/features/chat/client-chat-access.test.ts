import { describe, expect, it } from 'vitest'
import type { ChatThread } from '../../shared/domain'
import { canOpenClientChat } from './client-chat-access'

describe('trainer client chat entry', () => {
  it('keeps history independent of account, archive and connection', () => {
    const history: ChatThread = {
      conversationId: 'existing', clientId: 'client', trainerId: 'trainer',
      partnerUserId: 'user', partnerName: 'Спортсмен', activeConnection: false,
      lastMessageBody: null, lastMessageAt: null, lastMessageSenderId: null,
      unreadCount: 0, canMessage: false, blockedByMe: false, blockedByPartner: false,
    }
    expect(canOpenClientChat({ hasAccount: false, archivedAt: '2026-10-15' }, history)).toBe(true)
    expect(canOpenClientChat({ hasAccount: false, archivedAt: null }, history)).toBe(true)
  })
  it('starts only for a connected non-archived account without history', () => {
    expect(canOpenClientChat({ hasAccount: true, archivedAt: null })).toBe(true)
    expect(canOpenClientChat({ hasAccount: false, archivedAt: null })).toBe(false)
    expect(canOpenClientChat({ hasAccount: true, archivedAt: '2026-10-15' })).toBe(false)
  })
})
