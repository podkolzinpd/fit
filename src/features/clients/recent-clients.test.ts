import { describe, expect, it } from 'vitest'
import type { Client } from '../../shared/domain'
import { pushRecentClient, resolveRecentClients } from './recent-clients'

const client = (id: string, fullName: string): Client => ({
  id, fullName, canonicalFullName: fullName, hasAccount: false, gender: null,
  ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null,
  currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: null,
})

describe('recent clients', () => {
  it('moves a selected client to the top without duplicates', () => {
    expect(pushRecentClient(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })

  it('keeps stored order and skips clients no longer available', () => {
    expect(resolveRecentClients(['b', 'missing', 'a'], [client('a', 'Анна'), client('b', 'Борис')]).map((item) => item.fullName)).toEqual(['Борис', 'Анна'])
  })
})
