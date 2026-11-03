import { beforeEach, describe, expect, it, vi } from 'vitest'
import { corporateServicesRepository as repository } from './corporate-services.repository'
const request = vi.hoisted(() => vi.fn())
vi.mock('../queries/corporate-services.queries', () => ({ corporateServiceRequest: request }))
const id = '20000000-0000-4000-8000-000000000001'
const range = { from: '2026-11-01', until: '2026-12-01' }
describe('corporate service repository', () => {
  beforeEach(() => request.mockReset())
  it('fails closed for denied actors and surfaces transport errors', async () => {
    for (const status of [401, 403]) { request.mockResolvedValueOnce(new Response(null, { status })); expect(await repository.access()).toBe(false) }
    request.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(repository.access()).rejects.toMatchObject({ status: 503 })
    request.mockResolvedValueOnce(Response.json({ allowed: 'yes' }))
    await expect(repository.access()).rejects.toThrow()
  })
  it('reports malformed successful responses as a recoverable error', async () => {
    request.mockResolvedValueOnce(new Response('broken response', { status: 200 }))
    await expect(repository.access()).rejects.toMatchObject({ status: 503, message: 'Ответ сервера повреждён. Повторите попытку.' })
  })
  it('does not convert missing or broken totals to zero and validates records', async () => {
    request.mockResolvedValueOnce(Response.json({ counts: {}, trainers: [], offices: [], timeZone: 'Europe/Moscow' }))
    await expect(repository.statistics(range, '', '')).rejects.toThrow()
    request.mockResolvedValueOnce(Response.json({ records: [{ id }], nextCursor: null, offices: [], timeZone: 'Europe/Moscow' }))
    await expect(repository.list(range)).rejects.toThrow()
  })
  it('encodes both cursor fields and preserves explicit receipt/conflict semantics', async () => {
    request.mockResolvedValueOnce(Response.json({ records: [], nextCursor: null, offices: [], timeZone: 'Europe/Moscow' }))
    await repository.list(range, { at: '2026-11-01T10:00:00+03:00', id })
    const url = new URL(request.mock.calls[0]![0] as string, 'https://fixture.invalid')
    expect(url.searchParams.get('cursorAt')).toBe('2026-11-01T10:00:00+03:00')
    expect(url.searchParams.get('cursorId')).toBe(id)
    request.mockResolvedValueOnce(Response.json({}))
    await expect(repository.void(id, id, 1)).rejects.toThrow()
    request.mockResolvedValueOnce(new Response(null, { status: 409 }))
    await expect(repository.void(id, id, 1)).rejects.toMatchObject({ status: 409 })
  })
})
