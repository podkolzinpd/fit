import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'

const id = '52500000-0000-4000-8000-000000000010'
const token = `ABCDEF123456.${'a'.repeat(64)}`
const offer = { source: 'link', locator: token }
const draft = { ...offer, expectedRelationshipId: null, offerVersion: id, operationId: id }
const apps: FastifyInstance[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())) })
function fixture() {
  const service = { preview: vi.fn().mockResolvedValue({ clientId: id }), confirm: vi.fn().mockResolvedValue(id) }
  const app = buildApp({ trainerConnectionConfirmation: service, logger: false }); apps.push(app)
  return { app, service }
}
describe('athlete connection confirmation API', () => {
  it('validates and forwards per-field merge choices without choosing a source', async () => {
    const { app, service } = fixture()
    const headers = { 'x-fit-session': 's'.repeat(43) }
    const payload = { ...draft, mergeVersion: 'a'.repeat(64), mergeChoices: { 'profile:height_cm': 'card' } }
    expect((await app.inject({ method: 'POST', url: '/v1/trainer-connections/confirm', headers, payload })).statusCode).toBe(200)
    expect(service.confirm).toHaveBeenLastCalledWith(expect.anything(), payload)
    for (const invalid of [{ mergeChoices: [] }, { mergeChoices: { x: 'automatic' } }, { mergeVersion: 'stale' }]) {
      expect((await app.inject({ method: 'POST', url: '/v1/trainer-connections/confirm', headers, payload: { ...payload, ...invalid } })).statusCode).toBe(400)
    }
    expect(service.confirm).toHaveBeenCalledOnce()
  })
  it('requires a read-write session and a complete confirmation before using the store', async () => {
    const { app, service } = fixture()
    for (const [headers, payload, status] of [
      [{}, draft, 401],
      [{ 'x-fit-pilot-session': 's'.repeat(43) }, draft, 403],
      [{ 'x-fit-session': 's'.repeat(43) }, offer, 400],
      [{ 'x-fit-session': 's'.repeat(43) }, { ...draft, expectedRelationshipId: undefined }, 400],
    ] as const) {
      const response = await app.inject({ method: 'POST', url: '/v1/trainer-connections/confirm', headers, payload })
      expect(response.statusCode).toBe(status)
    }
    expect(service.confirm).not.toHaveBeenCalled()
  })
  it.each(['link', 'code', 'chat'] as const)('previews and confirms %s through the same session contract', async source => {
    const { app, service } = fixture()
    const payload = { ...draft, source, locator: source === 'link' ? token : source === 'code' ? 'ABCDEF123456' : id }
    const headers = { 'x-fit-session': 's'.repeat(43) }
    const preview = await app.inject({ method: 'POST', url: '/v1/trainer-connections/preview', headers, payload })
    const confirm = await app.inject({ method: 'POST', url: '/v1/trainer-connections/confirm', headers, payload })
    expect(preview.statusCode).toBe(200)
    expect(confirm.statusCode).toBe(200)
    expect(confirm.headers['cache-control']).toBe('no-store')
    expect(confirm.json()).toEqual({ clientId: id })
    expect(service.confirm).toHaveBeenCalledWith({ token: 's'.repeat(43), accessMode: 'read_write' }, payload)
  })
  it.each([['connection_changed', 409], ['connection_offer_unavailable', 409], ['connection_forbidden', 403], ['SQL secret detail', 503]] as const)(
    'returns a safe %s failure', async (failure, status) => {
      const { app, service } = fixture(); service.confirm.mockRejectedValue(new Error(failure))
      const response = await app.inject({ method: 'POST', url: '/v1/trainer-connections/confirm', headers: { 'x-fit-session': 's'.repeat(43) }, payload: draft })
      expect(response.statusCode).toBe(status)
      expect(response.json()).toEqual({ error: status === 503 ? 'service_unavailable' : failure })
      expect(response.body).not.toContain(token)
    })
})
