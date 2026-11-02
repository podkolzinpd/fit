import { expect, it, vi } from 'vitest'
import { summaryDiagnosticQuery } from '../queries/summary-diagnostic.queries'
import { getSummaryDiagnostic } from './summary-diagnostic.repository'

vi.mock('../queries/summary-diagnostic.queries', () => ({ summaryDiagnosticQuery: vi.fn() }))
const valid = {
  diagnostic: true,
  ready: true,
  code: 'available',
  fingerprint: 'f',
  request_id: 'request-id',
  release_id: 'release-id',
  stats: { workouts: 14, exercises: 149, sets: 376, model_input_chars: 44511 },
}

it.each([null, 1, {}, { diagnostic: false }, { diagnostic: true }, { diagnostic: true, fingerprint: 1 }, { diagnostic: true, fingerprint: 'f' }, { ...valid, stats: null }, { ...valid, stats: 1 }])('rejects a malformed diagnostic envelope (%j)', async (value) => {
  vi.mocked(summaryDiagnosticQuery).mockResolvedValue(value)
  await expect(getSummaryDiagnostic('api', 'session', 'client', '2026-08-16', '2026-09-15')).rejects.toThrow('Неожиданный ответ')
})

it.each(['workouts', 'exercises', 'sets', 'model_input_chars'])('validates counter %s', async (key) => {
  const stats: Record<string, unknown> = { ...valid.stats }
  delete stats[key]
  vi.mocked(summaryDiagnosticQuery).mockResolvedValue({ ...valid, stats })
  await expect(getSummaryDiagnostic('api', 'session', 'client', '2026-08-16', '2026-09-15')).rejects.toThrow('Нет счётчиков')
  stats[key] = 'invalid'
  vi.mocked(summaryDiagnosticQuery).mockResolvedValue({ ...valid, stats })
  await expect(getSummaryDiagnostic('api', 'session', 'client', '2026-08-16', '2026-09-15')).rejects.toThrow('Нет счётчиков')
})

it('keeps a valid no-model preflight with trace metadata', async () => {
  vi.mocked(summaryDiagnosticQuery).mockResolvedValue(valid)
  expect(await getSummaryDiagnostic('api', 'session', 'client', '2026-08-16', '2026-09-15')).toEqual({
    fingerprint: 'f',
    ready: true,
    code: 'available',
    stats: valid.stats,
    requestId: 'request-id',
    releaseId: 'release-id',
  })
})
