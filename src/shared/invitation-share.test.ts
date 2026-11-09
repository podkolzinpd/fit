import { afterEach, describe, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { corporateInvitationShareUrl, invitationShareText, invitationShareUrl } from './invitation-share'

describe('invitation share', () => {
  afterEach(() => vi.restoreAllMocks())
  it.each(['capacitor://localhost', 'https://localhost'])('uses the public website for a native origin %s', (origin) => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    expect(new URL(invitationShareUrl(`ABCDEF123456.${'a'.repeat(64)}`, 'yandex', origin)).origin).toBe('https://fit-training.ru')
  })
  it('keeps the protected token in a transport-safe query', () => {
    const token = `ABCDEF123456.${'a'.repeat(64)}`
    const url = new URL(invitationShareUrl(token, 'yandex', 'https://fit.example'))

    expect(url.pathname).toBe('/invite')
    expect(url.hash).toBe('')
    expect(url.searchParams.get('token')).toBe(token)
    expect(url.searchParams.get('source')).toBe('yandex')
  })

  it.each(['capacitor://localhost', 'https://localhost'])('keeps corporate links public for a native origin %s', (origin) => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    const token = 'a'.repeat(43), url = new URL(corporateInvitationShareUrl(token, origin))
    expect(url.origin).toBe('https://fit-training.ru')
    expect(url.pathname).toBe('/corporate-invite')
    expect(url.search).toBe('')
    expect(url.hash).toBe(`#token=${token}`)
  })
  it('keeps corporate browser previews on their own origin without putting the secret in a query', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false)
    const url = new URL(corporateInvitationShareUrl('a'.repeat(43), 'http://127.0.0.1:6414'))
    expect(url.origin).toBe('http://127.0.0.1:6414')
    expect(url.pathname).toBe('/corporate-invite')
    expect(url.search).toBe('')
    expect(url.hash).toBe(`#token=${'a'.repeat(43)}`)
  })

  it('uses short role-specific copy', () => {
    expect(invitationShareText('Антон', 'trainer')).toBe('Антон приглашает вас стать тренером в Fit.')
    expect(invitationShareText('Анастасия', 'client')).toBe('Анастасия приглашает вас тренироваться вместе в Fit.')
  })
})
