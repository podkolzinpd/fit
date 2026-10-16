import { describe, expect, it, vi } from 'vitest'
import { inspectNutritionBindings } from './cloudru-nutrition-bindings.js'

const clients = ['a', 'b', 'c', 'd', 'e'].map(x => x.repeat(64))
const trainers = ['f', '1'].map(x => x.repeat(64))
function connection(report: Record<string, unknown> | undefined, readOnly = 'on') {
  const query = vi.fn<Parameters<typeof inspectNutritionBindings>[0]['query']>().mockResolvedValue([])
    .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ readOnly }]).mockResolvedValueOnce(report ? [report] : [])
  return { query }
}
describe('nutrition cohort replacement capacity audit', () => {
  it('checks actual binding capacity with private parameters and only aggregate read-only output', async () => {
    const client = connection({ clients: 4, trainers: 1, outside: 0 })
    await expect(inspectNutritionBindings(client, clients, trainers)).resolves.toEqual({ boundClients: 4, boundTrainers: 1, outside: 0 })
    expect(client.query.mock.calls[0]?.[0]).toBe('begin read only')
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('commit')
    expect(client.query.mock.calls[4]?.[1]).toEqual([clients, trainers])
    expect(client.query.mock.calls.map(x => x[0]).join('\n')).not.toMatch(/\b(insert|update|delete|grant|alter)\b|subject_sha256|profile_id/iu)
  })
  it('refuses a retired binding, exhausted capacity, malformed aggregates or non-read-only transaction', async () => {
    for (const row of [{ clients: 5, trainers: 2, outside: 1 }, { clients: 6, trainers: 2, outside: 0 },
      { clients: 4, trainers: 3, outside: 0 }, { clients: -1, trainers: 2, outside: 0 }, undefined]) {
      const client = connection(row)
      await expect(inspectNutritionBindings(client, clients, trainers)).rejects.toThrow()
      expect(client.query.mock.calls.at(-1)?.[0]).toBe('rollback')
    }
    await expect(inspectNutritionBindings(connection({}, 'off'), clients, trainers)).rejects.toThrow('nutrition_binding_readonly_required')
  })
  it('rejects malformed or expanded input before querying', async () => {
    for (const input of [clients.slice(0, 3), [...clients, '2'.repeat(64)], [...clients.slice(0, 4), trainers[0]!], ['private', ...clients.slice(1)]]) {
      const client = connection(undefined)
      await expect(inspectNutritionBindings(client, input, trainers)).rejects.toThrow('nutrition_binding_cohort_rejected')
      expect(client.query).not.toHaveBeenCalled()
    }
  })
})
