import { describe, expect, it, vi } from 'vitest'
import { inspectCloudruQueue } from './cloudru-operations-health.js'

describe('Cloud.ru private queue monitoring', () => {
  it('reports only safe aggregate counts inside an explicitly read-only transaction', async () => {
    const query = vi.fn<Parameters<typeof inspectCloudruQueue>[0]['query']>().mockResolvedValue([])
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ pending: 2, overdue: 1, staleLeases: 0, terminalFailures: 0 }])
    await expect(inspectCloudruQueue({ query })).resolves.toEqual({ pending: 2, overdue: 1, staleLeases: 0, terminalFailures: 0 })
    expect(query.mock.calls[0]?.[0]).toBe('begin read only')
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit')
    const sql = query.mock.calls[2]?.[0] ?? ''
    expect(sql).toContain('count(*) filter')
    expect(sql).not.toMatch(/select\s+\*|\b(title|body|user_id|endpoint)\b/iu)
  })
  it('rolls back and fails closed on a malformed report', async () => {
    const query = vi.fn<Parameters<typeof inspectCloudruQueue>[0]['query']>().mockResolvedValue([])
    await expect(inspectCloudruQueue({ query })).rejects.toThrow('cloudru_queue_report_rejected')
    expect(query.mock.calls.at(-1)?.[0]).toBe('rollback')
  })
})
