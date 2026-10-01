import { describe, expect, it } from 'vitest'
import { invitationShareText, invitationShareUrl } from './invitation-share'

describe('invitation share', () => {
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
