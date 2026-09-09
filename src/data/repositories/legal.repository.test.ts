import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVACY_VERSION, TERMS_VERSION } from '../../shared/legal'
import { legalRepository } from './legal.repository'

const auth = vi.hoisted(() => ({ getSession: vi.fn() }))
const legal = vi.hoisted(() => ({
  getAcceptance: vi.fn(),
  recordAcceptance: vi.fn(),
  getCurrentDeletionRequest: vi.fn(),
  requestAccountDeletion: vi.fn(),
  cancelAccountDeletionRequest: vi.fn(),
}))

vi.mock('../queries/auth.queries', () => ({ authQueries: auth }))
vi.mock('../queries/legal.queries', () => ({ legalQueries: legal }))

describe('legalRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1', user_metadata: {} } } }, error: null })
    legal.getAcceptance.mockResolvedValue({ data: null, error: null })
    legal.recordAcceptance.mockResolvedValue({ data: { accepted_at: '2026-09-09T10:00:00Z' }, error: null })
  })

  it('requires current documents from an existing Supabase user', async () => {
    await expect(legalRepository.getAcceptanceStatus()).resolves.toEqual({ applicable: true, accepted: false, acceptedAt: null })
    expect(legal.getAcceptance).toHaveBeenCalledWith('user-1', TERMS_VERSION, PRIVACY_VERSION)
  })

  it('finishes the registration audit row from accepted auth metadata', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: {
      id: 'user-1',
      user_metadata: {
        legal_terms_version: TERMS_VERSION,
        legal_privacy_version: PRIVACY_VERSION,
        legal_accepted_at: '2026-09-09T09:00:00Z',
      },
    } } }, error: null })

    await expect(legalRepository.getAcceptanceStatus()).resolves.toMatchObject({ accepted: true })
    expect(legal.recordAcceptance).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      source: 'registration',
      acceptedAt: '2026-09-09T09:00:00Z',
    }))
  })

  it('does not block an isolated Yandex session without Supabase auth', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    await expect(legalRepository.getAcceptanceStatus()).resolves.toEqual({ applicable: false, accepted: true, acceptedAt: null })
    expect(legal.getAcceptance).not.toHaveBeenCalled()
  })
})
