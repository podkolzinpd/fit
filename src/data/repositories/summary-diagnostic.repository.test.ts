import { expect, it, vi } from 'vitest'
import { summaryDiagnosticQuery } from '../queries/summary-diagnostic.queries'
import { getSummaryDiagnostic } from './summary-diagnostic.repository'

vi.mock('../queries/summary-diagnostic.queries', () => ({ summaryDiagnosticQuery: vi.fn() }))
const valid = { diagnostic: true, fingerprint: 'f', stats: { workouts: 14, exercises: 149, sets: 376, model_input_chars: 44511 } }

it.each([null, 1, {}, { diagnostic: false }, { diagnostic: true }, { diagnostic: true, fingerprint: 1 }, { diagnostic: true, fingerprint: 'f' }, { ...valid, stats: null }, { ...valid, stats: 1 }])('rejects a malformed diagnostic envelope (%j)', async (value) => {
  vi.mocked(summaryDiagnosticQuery).mockResolvedValue(value)
  await expect(getSummaryDiagnostic('client', 'preflight')).rejects.toThrow('Неожиданный ответ')
})

it.each(['workouts', 'exercises', 'sets', 'model_input_chars'])('validates counter %s', async (key) => {
  const stats: Record<string, unknown> = { ...valid.stats }
  delete stats[key]
  vi.mocked(summaryDiagnosticQuery).mockResolvedValue({ ...valid, stats })
  await expect(getSummaryDiagnostic('client', 'preflight')).rejects.toThrow('Нет счётчиков')
  stats[key] = 'invalid'
  vi.mocked(summaryDiagnosticQuery).mockResolvedValue({ ...valid, stats })
  await expect(getSummaryDiagnostic('client', 'preflight')).rejects.toThrow('Нет счётчиков')
})

it('keeps valid preflight and safely validates optional answer fields', async () => {
  vi.mocked(summaryDiagnosticQuery).mockResolvedValue(valid)
  expect(await getSummaryDiagnostic('client', 'preflight')).toEqual({ fingerprint: 'f', stats: valid.stats })
  vi.mocked(summaryDiagnosticQuery).mockResolvedValue({ ...valid, answer: 'text', issues: ['issue', 1] })
  expect(await getSummaryDiagnostic('client', 'run_once', 'f')).toMatchObject({ answer: 'text', issues: ['issue'] })
  vi.mocked(summaryDiagnosticQuery).mockResolvedValue({ ...valid, answer: 1, issues: 'bad' })
  expect(await getSummaryDiagnostic('client', 'preflight')).not.toHaveProperty('answer')
})
