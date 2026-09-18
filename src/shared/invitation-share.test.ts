import { describe, expect, it } from 'vitest'
import { invitationShareText, invitationShareUrl } from './invitation-share'

describe('invitation share', () => {
  it('keeps the protected token in a URL fragment', () => {
    const token = `ABCDEF123456.${'a'.repeat(64)}`
    const url = new URL(invitationShareUrl(token, 'yandex', 'https://fit.example'))

    expect(url.pathname).toBe('/invite')
    expect(url.search).toBe('')
    expect(new URLSearchParams(url.hash.slice(1)).get('token')).toBe(token)
    expect(new URLSearchParams(url.hash.slice(1)).get('source')).toBe('yandex')
  })

  it('uses short role-specific copy', () => {
    expect(invitationShareText('Антон', 'trainer')).toBe('Антон приглашает вас стать тренером в Fit.')
    expect(invitationShareText('Анастасия', 'client')).toBe('Анастасия приглашает вас тренироваться вместе в Fit.')
  })
})
