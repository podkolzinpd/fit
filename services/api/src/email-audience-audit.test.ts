import { describe, expect, it } from 'vitest'
import { aggregateEmailAudience } from './email-audience-audit.js'
describe('email audience aggregate', () => {
  it('counts only matched current profiles, deduplicates emails and excludes missing, fake and banned addresses', () => {
    const counts = aggregateEmailAudience([
      { id: 'a', email: ' Person@real.org ', email_confirmed_at: '2026-01-01' },
      { id: 'b', email: 'person@real.org', email_confirmed_at: '2026-01-01' },
      { id: 'c', email: 'other@real.org' },
      { id: 'd', email: 'nobody@example.com', email_confirmed_at: '2026-01-01' },
      { id: 'e', email: 'banned@real.org', banned_until: '2999-01-01' },
      { id: 'f' }, { id: 'legacy-only', email: 'old@real.org', email_confirmed_at: '2026-01-01' },
    ], new Set(['a', 'b', 'c', 'd', 'e', 'f', 'native-only']), new Set(['a']))
    expect(counts).toEqual({ currentProfiles: 7, legacyAccounts: 7, matchedProfiles: 6,
      currentProfilesWithoutLegacyMatch: 1, profilesWithCandidateEmail: 3, uniqueCandidateEmails: 2,
      profilesWithConfirmedEmail: 2, uniqueConfirmedEmails: 1, confirmedProfilesWithoutPush: 1,
      uniqueConfirmedEmailsWithoutPush: 1, excludedMatchedProfiles: 3 })
    expect(JSON.stringify(counts)).not.toContain('@')
  })
})
