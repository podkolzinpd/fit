import { describe, expect, it, vi } from 'vitest'
import type { DatabasePool, DatabaseClient } from './db/types.js'
import { DatabaseNutritionAutoActivator, nutritionLoginHash, nutritionProfileAllowed, readNativeNutritionPilot,
  withNutritionProfileDecision } from './nutrition-pilot.js'

const hashes = Array.from({ length: 5 }, (_, i) => String(i + 1).repeat(64))
const raw = JSON.stringify({ clients: hashes.slice(0, 3), trainers: hashes.slice(3) })
const pilot = readNativeNutritionPilot('true', raw)!
function fixture(rows: readonly Record<string, unknown>[] = [{ bound: true }]) {
  const query = vi.fn().mockResolvedValue(rows), release = vi.fn()
  const pool = { connect: vi.fn().mockResolvedValue({ query, release }), end: vi.fn() } as unknown as DatabasePool
  return { pool, query, release, client: { query } as DatabaseClient }
}

describe('native nutrition cohort', () => {
  it('uses only native login equivalence, not a guessed profile or an external-email prefix', () => {
    expect(nutritionLoginHash(' SAMPLE.NAME@yandex.ru ')).toBe(nutritionLoginHash('sample-name'))
    expect(nutritionLoginHash(' SAMPLE_NAME@yandex.ru ')).toBe(nutritionLoginHash('sample_name'))
    expect(nutritionLoginHash('sample_name')).not.toBe(nutritionLoginHash('sample-name'))
    expect(nutritionLoginHash('sample_name')).not.toBe(nutritionLoginHash('sample.name'))
    expect(nutritionLoginHash('sample.name@example.test')).not.toBe(nutritionLoginHash('sample-name@example.test'))
    expect(nutritionLoginHash('sample@example.test')).not.toBe(nutritionLoginHash('sample'))
    expect(nutritionLoginHash('sample@example.test')).not.toBe(nutritionLoginHash('sample@other.test'))
    expect(nutritionLoginHash('bad login')).toBeUndefined()
  })
  it('requires the independent flag, three to five clients and the same two unique trainers', () => {
    expect(pilot).toEqual({ clients: hashes.slice(0, 3), trainers: hashes.slice(3), native: true })
    for (const value of ['', '{}', '[]', '{', JSON.stringify({ clients: hashes, trainers: [] }),
      JSON.stringify({ clients: hashes.slice(0, 3), trainers: [hashes[0], hashes[4]] }),
      JSON.stringify({ clients: hashes.slice(0, 3), trainers: hashes.slice(3), all: true }),
      JSON.stringify({ clients: ['invalid', ...hashes.slice(1, 3)], trainers: hashes.slice(3) })]) {
      expect(readNativeNutritionPilot('true', value)).toBeNull()
    }
    for (const enabled of [undefined, 'false', 'TRUE', '1']) expect(readNativeNutritionPilot(enabled, raw)).toBeNull()
  })
  it('admits additional clients only in their exact configuration, never a sixth client or third trainer', async () => {
    const fourth = '6'.repeat(64), fifth = '7'.repeat(64)
    const priorSix = readNativeNutritionPilot('true', JSON.stringify({ clients: [...pilot.clients, fourth], trainers: pilot.trainers }))!
    const expanded = readNativeNutritionPilot('true', JSON.stringify({ clients: [...priorSix.clients, fifth], trainers: pilot.trainers }))!
    expect(priorSix.clients).toHaveLength(4)
    expect(expanded.clients).toHaveLength(5)
    expect(readNativeNutritionPilot('true', JSON.stringify({ clients: [...expanded.clients, '8'.repeat(64)], trainers: pilot.trainers }))).toBeNull()
    expect(readNativeNutritionPilot('true', JSON.stringify({ clients: expanded.clients, trainers: [...pilot.trainers, '7'.repeat(64)] }))).toBeNull()
    expect(readNativeNutritionPilot('true', JSON.stringify({ clients: [...pilot.clients, pilot.trainers[0]], trainers: pilot.trainers }))).toBeNull()
    const f = fixture()
    expect(await new DatabaseNutritionAutoActivator(f.pool, pilot).bind('a'.repeat(64), fourth)).toEqual({ bound: false })
    expect(f.query).not.toHaveBeenCalled()
    expect(await new DatabaseNutritionAutoActivator(f.pool, expanded).bind('a'.repeat(64), fourth)).toEqual({ bound: true })
    expect(f.query.mock.calls[0]?.[1]).toEqual(['a'.repeat(64), fourth, 'client'])
    f.query.mockResolvedValue([{ login_hash: fourth }])
    expect(await nutritionProfileAllowed(f.client, expanded, 'fourth', 'client')).toBe(true)
    expect(await nutritionProfileAllowed(f.client, pilot, 'fourth', 'client')).toBe(false)
    expect(await nutritionProfileAllowed(f.client, expanded, 'fourth', 'trainer')).toBe(false)
    f.query.mockClear()
    expect(await new DatabaseNutritionAutoActivator(f.pool, priorSix).bind('a'.repeat(64), fifth)).toEqual({ bound: false })
    expect(f.query).not.toHaveBeenCalled()
    f.query.mockResolvedValue([{ bound: true }])
    expect(await new DatabaseNutritionAutoActivator(f.pool, expanded).bind('a'.repeat(64), fifth)).toEqual({ bound: true })
    expect(f.query.mock.calls[0]?.[1]).toEqual(['a'.repeat(64), fifth, 'client'])
    f.query.mockResolvedValue([{ login_hash: fifth }])
    expect(await nutritionProfileAllowed(f.client, expanded, 'fifth', 'client')).toBe(true)
    expect(await nutritionProfileAllowed(f.client, priorSix, 'fifth', 'client')).toBe(false)
  })
  it('binds only the exact approved verified login with its expected role through the feature-only function', async () => {
    const f = fixture()
    const binder = new DatabaseNutritionAutoActivator(f.pool, pilot)
    expect(await binder.bind('a'.repeat(64), hashes[0]!)).toEqual({ bound: true })
    expect(f.query).toHaveBeenCalledExactlyOnceWith(
      'select app_private.bind_nutrition_for_yandex_login($1, $2, $3) bound', ['a'.repeat(64), hashes[0], 'client'])
    expect(f.release).toHaveBeenCalledOnce()
  })
  it('does not query or alter anything for unapproved, malformed or disabled identities', async () => {
    const f = fixture()
    for (const selected of [pilot, null, { clients: pilot.clients, trainers: pilot.trainers }]) {
      const binder = new DatabaseNutritionAutoActivator(f.pool, selected)
      expect(await binder.bind('bad', hashes[0]!)).toEqual({ bound: false })
      expect(await binder.bind('a'.repeat(64), 'b'.repeat(64))).toEqual({ bound: false })
    }
    expect(f.query).not.toHaveBeenCalled()
  })
  it('fails closed on a role mismatch or immutable binding conflict without granting consent', async () => {
    const f = fixture([{ bound: false }])
    expect(await new DatabaseNutritionAutoActivator(f.pool, pilot).bind('a'.repeat(64), hashes[4]!)).toEqual({ bound: false })
    expect(f.query.mock.calls[0]?.[1]).toEqual(['a'.repeat(64), hashes[4], 'trainer'])
    expect(f.release).toHaveBeenCalledOnce()
  })
  it('checks the current protected binding and role rather than accepting a UUID or stale decision', async () => {
    const f = fixture([{ login_hash: hashes[0] }])
    expect(await nutritionProfileAllowed(f.client, pilot, 'profile', 'client')).toBe(true)
    expect(await nutritionProfileAllowed(f.client, pilot, 'profile', 'trainer')).toBe(false)
    f.query.mockResolvedValue([{ login_hash: null }])
    expect(await nutritionProfileAllowed(f.client, pilot, 'profile', 'client')).toBe(false)
    expect(await nutritionProfileAllowed(f.client, null, 'profile', 'client')).toBe(false)
    expect(await withNutritionProfileDecision(f.client, undefined, pilot)).toBeUndefined()
  })
})
