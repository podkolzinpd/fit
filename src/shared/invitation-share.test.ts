import { afterEach, describe, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { invitationShareText, invitationShareUrl } from './invitation-share'

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

  it('uses short role-specific copy', () => {
    expect(invitationShareText('Антон', 'trainer')).toBe('Антон приглашает вас стать тренером в Fit.')
    expect(invitationShareText('Анастасия', 'client')).toBe('Анастасия приглашает вас тренироваться вместе в Fit.')
  })
})
