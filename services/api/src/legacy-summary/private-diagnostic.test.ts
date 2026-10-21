import { afterEach, describe, expect, it, vi } from 'vitest'
import { diagnosticAllowed, PrivateSummaryDiagnostic } from './private-diagnostic.js'
import { requestYandexSummary } from '../training-summary-core.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('private summary diagnostic', () => {

  it('denies unverified, unrelated and expired identities', () => {
    const approved = { email: 'test@client-testgmail.com', email_confirmed_at: '2026-01-01' }
    expect(diagnosticAllowed(approved, true, Date.parse('2026-09-11T10:00:00Z'))).toBe(true)
    expect(diagnosticAllowed(approved, false, 0)).toBe(false)
    expect(diagnosticAllowed({ email: approved.email }, true, 0)).toBe(false)
    expect(diagnosticAllowed(approved, true, Date.parse('2026-09-18T00:00:00Z'))).toBe(false)
    expect(diagnosticAllowed({}, true, 0)).toBe(false)
    expect(diagnosticAllowed({ email: 'other@example.test', email_confirmed_at: '2026-01-01' }, true, 0)).toBe(false)
    expect(diagnosticAllowed({ email: 'other@example.test', email_confirmed_at: '2026-01-01' }, false, 0)).toBe(false)
    expect(diagnosticAllowed({}, true, Date.parse('2026-09-18T00:00:00Z'))).toBe(false)
  })

  it('returns rejected text privately with one call and no raw logging', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const answer = 'private malformed answer'
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ result: {
      alternatives: [{ message: { text: answer }, status: 'ALTERNATIVE_STATUS_FINAL' }],
      usage: { completionTokens: '3' }, modelVersion: 'test',
    } }))
    let captured: unknown
    try {
      await requestYandexSummary({}, '2026-08-12', '2026-09-11', { diagnostic: true, fetchImpl })
    } catch (error) { captured = error }
    expect(captured).toBeInstanceOf(PrivateSummaryDiagnostic)
    expect((captured as PrivateSummaryDiagnostic).result).toMatchObject({ answer, issues: ['diagnostic_response_parse_failed'] })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
    expect(errorLog).not.toHaveBeenCalled()
  })

  it('does not retry a diagnostic network failure or create chunks', async () => {
    vi.stubEnv('YANDEX_CLOUD_API_KEY', 'test-key')
    vi.stubEnv('YANDEX_CLOUD_FOLDER_ID', 'test-folder')
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('network'))
    await expect(requestYandexSummary({}, '2026-08-12', '2026-09-11', { diagnostic: true, fetchImpl })).rejects.toThrow('yandex_cloud_unavailable')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    fetchImpl.mockClear()
    await expect(requestYandexSummary({ text: 'x'.repeat(80001) }, '2026-08-12', '2026-09-11', { diagnostic: true, fetchImpl })).rejects.toThrow('diagnostic_direct_only')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
