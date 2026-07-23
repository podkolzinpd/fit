import { RepositoryError } from '../data/repositories/error'

const NON_RETRYABLE_CODES = new Set(['PGRST116', '42501'])
const TRANSIENT_POSTGREST_CODES = new Set(['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'])
const TRANSIENT_DATABASE_CODES = new Set(['57P01', '57P02', '57P03'])
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504])
const NETWORK_MESSAGE = /failed to fetch|fetch failed|networkerror|network request failed|load failed/i

function errorCode(error: unknown): string | undefined {
  if (error instanceof RepositoryError) return error.code
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return undefined
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
    return error.status
  }
  return undefined
}

function isPermanentCode(code: string): boolean {
  return code.startsWith('PT4')
    || code.startsWith('28')
    || NON_RETRYABLE_CODES.has(code)
}

function isTransientCode(code: string): boolean {
  return code.startsWith('08')
    || code.startsWith('53')
    || TRANSIENT_DATABASE_CODES.has(code)
    || TRANSIENT_POSTGREST_CODES.has(code)
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  return error instanceof Error && NETWORK_MESSAGE.test(error.message)
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false

  const code = errorCode(error)
  if (code && isPermanentCode(code)) return false
  if (code && isTransientCode(code)) return true

  const status = errorStatus(error)
  if (status !== undefined) {
    if (status >= 400 && status < 500) return false
    return TRANSIENT_HTTP_STATUSES.has(status)
  }

  return isNetworkError(error)
}

export function queryRetryDelay(attemptIndex: number): number {
  const exponentialDelay = Math.min(1_000 * 2 ** attemptIndex, 5_000)
  const jitter = 0.75 + Math.random() * 0.5
  return Math.round(exponentialDelay * jitter)
}

