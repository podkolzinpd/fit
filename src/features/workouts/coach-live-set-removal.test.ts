import { describe, expect, it } from 'vitest'
import { coachLiveSetRemovalError } from './coach-live-set-removal'

const pending = { id: 'pending', confirmedAt: null }
const confirmed = { id: 'confirmed', confirmedAt: '2026-10-10T09:00:00Z' }

describe('Coach Live safe set removal', () => {
  it('permits only an existing unconfirmed non-last set', () => {
    expect(coachLiveSetRemovalError({ exercises: [{ sets: [confirmed, pending] }] }, pending.id)).toBeNull()
  })
  it('protects confirmed facts even when other sets remain', () => {
    expect(coachLiveSetRemovalError({ exercises: [{ sets: [confirmed, pending] }] }, confirmed.id)).toContain('сохранить результат')
  })
  it('rechecks a set confirmed after the original delete request', () => {
    const sets: { id: string; confirmedAt: string | null }[] = [{ ...pending }, { id: 'other', confirmedAt: null }]
    const state = { exercises: [{ sets }] }
    expect(coachLiveSetRemovalError(state, pending.id)).toBeNull()
    sets[0]!.confirmedAt = confirmed.confirmedAt
    expect(coachLiveSetRemovalError(state, pending.id)).toContain('подтверждён')
  })
  it('protects the remaining last set', () => {
    expect(coachLiveSetRemovalError({ exercises: [{ sets: [pending] }] }, pending.id)).toContain('Последний подход')
  })
  it('stops a retry when the set has already disappeared', () => {
    expect(coachLiveSetRemovalError({ exercises: [{ sets: [confirmed] }] }, pending.id)).toContain('уже удалён')
  })
  it('fails closed without current workout data', () => {
    expect(coachLiveSetRemovalError(undefined, pending.id)).toContain('не загружена')
  })
})

describe('client explicit confirmed-result removal', () => {
  const set = { id: 'done', confirmedAt: '2026-10-23T09:00:00Z', version: 7 }
  const state = { exercises: [{ sets: [set, { id: 'other', confirmedAt: null, version: 1 }] }] }
  it('requires explicit approval of the exact confirmed version', () => {
    expect(coachLiveSetRemovalError(state, set.id)).toContain('сохранить результат')
    expect(coachLiveSetRemovalError(state, set.id, { setId: set.id, expectedSetVersion: 7 })).toContain('сохранить результат')
    expect(coachLiveSetRemovalError(state, set.id, { setId: set.id, expectedSetVersion: 7, confirmedVersion: 7 })).toBeNull()
    expect(coachLiveSetRemovalError(state, set.id, { setId: 'other', expectedSetVersion: 7, confirmedVersion: 7 })).toContain('Выберите подход')
  })
  it('blocks a changed fact and preserves the last-set guard', () => {
    expect(coachLiveSetRemovalError(state, set.id, { setId: set.id, expectedSetVersion: 6, confirmedVersion: 6 })).toContain('изменился')
    expect(coachLiveSetRemovalError({ exercises: [{ sets: [set] }] }, set.id, { setId: set.id, expectedSetVersion: 7, confirmedVersion: 7 })).toContain('Последний')
  })
})
