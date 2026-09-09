export const TERMS_VERSION = '2026-09-09'
export const PRIVACY_VERSION = '2026-09-09'
export const LEGAL_REVISION_LABEL = '9 сентября 2026 г.'

export const LEGAL_PATHS = {
  terms: '/legal/terms',
  privacy: '/legal/privacy',
  deleteAccount: '/legal/delete-account',
} as const

export interface LegalAcceptanceStatus {
  applicable: boolean
  accepted: boolean
  acceptedAt: string | null
}

export interface AccountDeletionRequest {
  id: string
  status: 'requested' | 'cancelled' | 'completed'
  requestedAt: string
}

export interface AccountDeletionStatus {
  supported: boolean
  request: AccountDeletionRequest | null
}
