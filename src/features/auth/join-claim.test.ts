import { describe, expect, it } from 'vitest'
import { nextAutomaticInviteClaim } from './join-claim'

describe('nextAutomaticInviteClaim', () => {
  it('claims an invitation link once and never retries it automatically', () => {
    expect(nextAutomaticInviteClaim('ABCD1234EFGH', null)).toBe('ABCD1234EFGH')
    expect(nextAutomaticInviteClaim('ABCD1234EFGH', 'ABCD1234EFGH')).toBeNull()
  })

  it('allows one automatic claim for a different invitation link', () => {
    expect(nextAutomaticInviteClaim('NEXT1234CODE', 'ABCD1234EFGH')).toBe('NEXT1234CODE')
    expect(nextAutomaticInviteClaim(null, 'ABCD1234EFGH')).toBeNull()
  })
})
