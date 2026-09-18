import { beforeEach, describe, expect, it } from 'vitest'

import {
  captureInvitationLink,
  clearPendingInvitationLink,
  hasPendingInvitationLink,
  readPendingInvitationLink,
} from './invitation-link-continuation'

const token = `ABCDEF123456.${'a'.repeat(64)}`

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('invitation link continuation', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() })
  })

  it('keeps the protected token through authentication without putting personal data in storage', () => {
    expect(captureInvitationLink(`#token=${token}&source=yandex`, window.localStorage, 1000)).toEqual({
      token, source: 'yandex', savedAt: 1000,
    })
    expect(readPendingInvitationLink(window.localStorage, 2000)).toEqual({
      token, source: 'yandex', savedAt: 1000,
    })
    expect(window.localStorage.getItem('fit.pendingInvitationLink.v1')).not.toContain('Антон')
  })

  it('rejects malformed and stale values and removes a completed invitation', () => {
    expect(captureInvitationLink('#token=short&source=supabase', window.localStorage, 1000)).toBeNull()
    captureInvitationLink(`#token=${token}&source=supabase`, window.localStorage, 1000)
    expect(readPendingInvitationLink(window.localStorage, 8 * 24 * 60 * 60 * 1000)).toBeNull()

    captureInvitationLink(`#token=${token}&source=supabase`, window.localStorage, Date.now())
    expect(hasPendingInvitationLink()).toBe(true)
    clearPendingInvitationLink()
    expect(hasPendingInvitationLink()).toBe(false)
  })
})
