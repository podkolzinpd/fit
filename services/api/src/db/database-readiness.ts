import type { DatabaseConnection, DatabasePool } from './types.js'

export type DatabaseReadinessFailureCategory =
  | 'authentication'
  | 'permission'
  | 'network'
  | 'tls'
  | 'unknown'

export type DatabaseReadinessResult =
  | Readonly<{ ready: true }>
  | Readonly<{
      ready: false
      category: DatabaseReadinessFailureCategory
      code: string
    }>

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
])

function safeDatabaseErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return 'unknown'
  }
  const code = Reflect.get(error, 'code')
  return typeof code === 'string' && /^[A-Z0-9_]{2,64}$/u.test(code)
    ? code
    : 'unknown'
}

function classifyDatabaseError(code: string): DatabaseReadinessFailureCategory {
  if (code.startsWith('28')) return 'authentication'
  if (code === '42501') return 'permission'
  if (code.startsWith('08') || NETWORK_ERROR_CODES.has(code)) return 'network'
  if (
    /^(?:CERT_|DEPTH_|ERR_OSSL_|SELF_SIGNED_|UNABLE_TO_VERIFY_)/u.test(code)
  ) return 'tls'
  return 'unknown'
}

export function safeDatabaseErrorDiagnostics(error: unknown): Readonly<{
  category: DatabaseReadinessFailureCategory
  code: string
}> {
  const code = safeDatabaseErrorCode(error)
  return { category: classifyDatabaseError(code), code }
}

export async function inspectDatabaseReadiness(
  pool: DatabasePool,
): Promise<DatabaseReadinessResult> {
  let connection: DatabaseConnection | undefined
  try {
    connection = await pool.connect()
    await connection.query('select 1')
    return { ready: true }
  } catch (error) {
    const diagnostics = safeDatabaseErrorDiagnostics(error)
    return {
      ready: false,
      ...diagnostics,
    }
  } finally {
    connection?.release()
  }
}
