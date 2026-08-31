import { describe, expect, it } from 'vitest'

import {
  readAssistantActionRequest,
  readAssistantConversationRequest,
  readAssistantTurnRequest,
  readAssistantVersionRequest,
} from './assistant-state-request.js'

describe('assistant state request parsing', () => {
  it('normalizes an optional conversation title', () => {
    expect(readAssistantConversationRequest({})).toEqual({ title: null })
    expect(readAssistantConversationRequest({ title: '  План на неделю  ' }))
      .toEqual({ title: 'План на неделю' })
    expect(readAssistantConversationRequest({ title: ' '.repeat(3) })).toBeUndefined()
    expect(readAssistantConversationRequest({ title: 'x'.repeat(201) })).toBeUndefined()
  })

  it('normalizes and validates assistant turn requests', () => {
    expect(readAssistantTurnRequest({
      conversation_id: '6e577cc7-3b56-4a86-bc85-1ce2426ce249',
      turn_id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
      message: '  что ты умеешь?  ',
    })).toEqual({
      conversationId: '6e577cc7-3b56-4a86-bc85-1ce2426ce249',
      turnId: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
      message: 'что ты умеешь?',
    })
    expect(readAssistantTurnRequest({
      conversation_id: 'bad',
      message: 'Привет',
    })).toBeUndefined()
    expect(readAssistantTurnRequest({
      conversation_id: '6e577cc7-3b56-4a86-bc85-1ce2426ce249',
      turn_id: 'bad',
      message: 'Привет',
    })).toBeUndefined()
    expect(readAssistantTurnRequest({
      conversation_id: '6e577cc7-3b56-4a86-bc85-1ce2426ce249',
      message: '   ',
    })).toBeUndefined()
  })

  it('accepts only positive safe action versions and object input', () => {
    expect(readAssistantActionRequest({ expectedVersion: 2 })).toEqual({
      expectedVersion: 2,
      input: {},
    })
    expect(readAssistantActionRequest({ expectedVersion: 2, input: { workout: {} } }))
      .toEqual({ expectedVersion: 2, input: { workout: {} } })
    expect(readAssistantActionRequest({ expectedVersion: 0 })).toBeUndefined()
    expect(readAssistantActionRequest({ expectedVersion: 1, input: [] })).toBeUndefined()
  })

  it('parses version-only commands', () => {
    expect(readAssistantVersionRequest({ expectedVersion: 1 }))
      .toEqual({ expectedVersion: 1 })
    expect(readAssistantVersionRequest({ expectedVersion: 1.5 })).toBeUndefined()
  })
})
