import { describe, expect, it } from 'vitest'
import {
  consumeInvitationAuthReturn,
  invitationAuthReturnPath,
  readInvitationAuthReturn,
  saveInvitationAuthReturn,
} from './invitation-auth-return'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('invitation auth return', () => {
  it('accepts only the public invitation route and an exact legacy code route', () => {
    expect(invitationAuthReturnPath('/invite')).toBe('/invite')
    expect(invitationAuthReturnPath('/join?code=ab12cd34ef56')).toBe('/join?code=AB12CD34EF56')
    expect(invitationAuthReturnPath('/join?code=AB12CD34EF56&next=/clients')).toBeNull()
    expect(invitationAuthReturnPath('/join?code=AB12CD34EF56#fragment')).toBeNull()
    expect(invitationAuthReturnPath('/invite?token=secret')).toBeNull()
    expect(invitationAuthReturnPath('https://example.test/join?code=AB12CD34EF56')).toBeNull()
  })

  it('stores a valid route for the OAuth roundtrip and consumes it once', () => {
    const storage = memoryStorage()
    saveInvitationAuthReturn('/join?code=ab12cd34ef56', storage, 1_000)

    expect(readInvitationAuthReturn(storage, 2_000)).toBe('/join?code=AB12CD34EF56')
    expect(consumeInvitationAuthReturn(storage, 2_000)).toBe('/join?code=AB12CD34EF56')
    expect(readInvitationAuthReturn(storage, 2_000)).toBeNull()
  })

  it('drops expired and malformed stored redirects', () => {
    const storage = memoryStorage()
    saveInvitationAuthReturn('/invite', storage, 1_000)
    expect(readInvitationAuthReturn(storage, 2 * 60 * 60 * 1_000 + 1_001)).toBeNull()

    storage.setItem('fit.auth.invitationReturn.v1', '{bad json')
    expect(readInvitationAuthReturn(storage)).toBeNull()
  })
})
