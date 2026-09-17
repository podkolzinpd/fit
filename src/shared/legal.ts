import legalDocuments from './legal-documents.json'

export const TERMS_VERSION = `sha256:${legalDocuments.terms.sourceTextSha256.slice(0, 24)}`
export const PRIVACY_VERSION = `sha256:${legalDocuments.privacy.sourceTextSha256.slice(0, 24)}`

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
