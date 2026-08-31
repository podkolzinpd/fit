import { describe, expect, it } from 'vitest'

import {
  readAssistantActionRequest,
  readAssistantConversationRequest,
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
