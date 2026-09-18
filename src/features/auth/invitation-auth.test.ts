import { beforeEach, describe, expect, it } from 'vitest'
import {
  consumePendingInvitation,
  invitationAuthPath,
  readPendingInvitation,
  readPendingInvitationRole,
  savePendingInvitation,
} from './invitation-auth'

const LINK_TOKEN = `AB12CD34EF56.${'a'.repeat(64)}`

describe('invitation auth handoff', () => {
  const storage = new Map<string, string>()
  const storageAdapter = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
  }

  beforeEach(() => storage.clear())

  it('keeps legacy codes and protected link tokens for one auth roundtrip', () => {
    for (const path of [
      '/join?code=ab12cd34ef56',
      `/invite?token=${LINK_TOKEN}`,
    ]) {
      savePendingInvitation(path, storageAdapter, 'client')
      const expected = path.startsWith('/join') ? '/join?code=AB12CD34EF56' : path
      expect(readPendingInvitation(storageAdapter)).toBe(expected)
      expect(readPendingInvitationRole(storageAdapter)).toBe('client')
      expect(consumePendingInvitation(storageAdapter)).toBe(expected)
      expect(consumePendingInvitation(storageAdapter)).toBeNull()
      expect(readPendingInvitationRole(storageAdapter)).toBeNull()
    }
  })

  it('rejects external, malformed and ambiguous redirect targets', () => {
    for (const unsafe of [
      'https://example.test/join?code=AB12CD34EF56',
      '/profile?code=AB12CD34EF56',
      '/join?code=short',
      '/join?code=AB12CD34EF56&next=/profile',
      '/join?code=AB12CD34EF56#fragment',
      '/join?code=AB12CD34EF56&code=123456789012',
      '/invite?token=short',
      `/invite?token=${LINK_TOKEN}&next=/profile`,
      `/invite?token=${LINK_TOKEN}#fragment`,
      `/invite?token=${LINK_TOKEN}&token=${LINK_TOKEN}`,
    ]) {
      expect(invitationAuthPath(unsafe)).toBeNull()
    }

    savePendingInvitation('/auth', storageAdapter)
    expect(readPendingInvitation(storageAdapter)).toBeNull()
  })
})
