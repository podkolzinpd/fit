import { describe, expect, it } from 'vitest'
import { parseTrainerDiscoveryPrompt } from './trainer-discovery.repository'

describe('trainer discovery repository', () => {
  it('parses the server-owned prompt state', () => {
    expect(parseTrainerDiscoveryPrompt({
      state: 'snoozed',
      remindAt: '2026-10-12T09:00:00.000Z',
      updatedAt: '2026-09-12T09:00:00.000Z',
    })).toEqual({
      state: 'snoozed',
      remindAt: '2026-10-12T09:00:00.000Z',
      updatedAt: '2026-09-12T09:00:00.000Z',
    })
  })

  it('rejects malformed prompt state', () => {
    expect(() => parseTrainerDiscoveryPrompt({ state: 'later', remindAt: null, updatedAt: null }))
      .toThrow('Некорректное состояние')
  })
})
