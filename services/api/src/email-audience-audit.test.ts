import { describe, expect, it } from 'vitest'
import { aggregateEmailAudience } from './email-audience-audit.js'
describe('email audience aggregate', () => {
  it('counts registered emails without confirmation or status filtering', () => {
    const counts = aggregateEmailAudience([
      { id: 'a', email: ' Person@real.org ', email_confirmed_at: '2026-01-01' },
      { id: 'b', email: 'person@real.org', email_confirmed_at: '2026-01-01' },
      { id: 'c', email: 'other@real.org' },
      { id: 'd', email: 'nobody@example.com', email_confirmed_at: '2026-01-01' },
      { id: 'e', email: 'banned@real.org', banned_until: '2999-01-01' },
      { id: 'f' }, { id: 'legacy-only', email: 'old@real.org', email_confirmed_at: '2026-01-01' },
    ], new Set(['a', 'b', 'c', 'd', 'e', 'f', 'native-only']), new Set(['a']))
    expect(counts).toEqual({ currentProfiles: 7, registeredAccounts: 7,
      registeredAccountsWithEmail: 6, uniqueRegisteredEmails: 5, registeredAccountsWithoutEmail: 1,
      matchedCurrentProfiles: 6, currentProfilesWithRegisteredEmail: 5,
      uniqueRegisteredEmailsForCurrentProfiles: 4, currentProfilesWithRegisteredEmailWithoutPush: 4 })
    expect(JSON.stringify(counts)).not.toContain('@')
  })
})
