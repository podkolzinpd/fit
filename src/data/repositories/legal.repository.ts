import {
  PRIVACY_VERSION,
  TERMS_VERSION,
  type AccountDeletionStatus,
  type LegalAcceptanceStatus,
} from '../../shared/legal'
import { authQueries } from '../queries/auth.queries'
import { legalQueries } from '../queries/legal.queries'
import { repositoryError } from './error'

async function currentSupabaseUser() {
  const session = await authQueries.getSession()
  if (session.error) throw repositoryError(session.error)
  return session.data.session?.user ?? null
}

async function recordAcceptance(
  userId: string,
  source: 'registration' | 'existing_user',
  acceptedAt?: string,
): Promise<string> {
  const resolvedAcceptedAt = acceptedAt ?? new Date().toISOString()
  const result = await legalQueries.recordAcceptance({
    userId,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    source,
    acceptedAt: resolvedAcceptedAt,
  })
  if (result.error) throw repositoryError(result.error)
  return resolvedAcceptedAt
}

export const legalRepository = {
  async getAcceptanceStatus(): Promise<LegalAcceptanceStatus> {
    const user = await currentSupabaseUser()
    // The isolated Yandex ID pilot has its own session and does not use the
    // Supabase legal tables. It must not be blocked by a query it cannot make.
    if (!user) return { applicable: false, accepted: true, acceptedAt: null }

    const result = await legalQueries.getAcceptance(user.id, TERMS_VERSION, PRIVACY_VERSION)
    if (result.error) throw repositoryError(result.error)
    if (result.data) return { applicable: true, accepted: true, acceptedAt: result.data.accepted_at }

    // Registration click is the explicit acceptance action. The metadata lets
    // the first protected render finish the audit row if the auth event wins a
    // race with the repository call immediately after sign-up.
    const metadata = user.user_metadata
    if (metadata.legal_terms_version === TERMS_VERSION
      && metadata.legal_privacy_version === PRIVACY_VERSION
      && typeof metadata.legal_accepted_at === 'string') {
      const acceptedAt = await recordAcceptance(user.id, 'registration', metadata.legal_accepted_at)
      return { applicable: true, accepted: true, acceptedAt }
    }

    return { applicable: true, accepted: false, acceptedAt: null }
  },
  async acceptCurrent(source: 'registration' | 'existing_user' = 'existing_user'): Promise<string> {
    const user = await currentSupabaseUser()
    if (!user) throw new Error('Сессия завершена. Войдите снова.')
    return recordAcceptance(user.id, source)
  },
  async getAccountDeletionStatus(): Promise<AccountDeletionStatus> {
    const user = await currentSupabaseUser()
    if (!user) return { supported: false, request: null }
    const result = await legalQueries.getCurrentDeletionRequest(user.id)
    if (result.error) throw repositoryError(result.error)
    const requestStatus = result.data?.status
    if (requestStatus !== undefined && requestStatus !== 'requested'
      && requestStatus !== 'cancelled' && requestStatus !== 'completed') {
      throw new Error('Получен неизвестный статус запроса')
    }
    return {
      supported: true,
      request: result.data ? {
        id: result.data.id,
        status: requestStatus ?? 'requested',
        requestedAt: result.data.requested_at,
      } : null,
    }
  },
  async requestAccountDeletion(): Promise<string> {
    if (!await currentSupabaseUser()) throw new Error('Сессия завершена. Войдите снова.')
    const result = await legalQueries.requestAccountDeletion()
    if (result.error) throw repositoryError(result.error)
    if (!result.data) throw new Error('Не удалось сохранить запрос')
    return result.data
  },
  async cancelAccountDeletionRequest(): Promise<void> {
    if (!await currentSupabaseUser()) throw new Error('Сессия завершена. Войдите снова.')
    const result = await legalQueries.cancelAccountDeletionRequest()
    if (result.error) throw repositoryError(result.error)
  },
}
