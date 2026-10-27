import type { DatabasePool } from './db/types.js'

export interface StaffEmployeeVerifier {
  verifyLogin(verifiedLogin: string): Promise<boolean | undefined>
}
export interface YandexEmployeeObserver {
  observe(subjectHash: string, verifiedLogin: string): Promise<void>
}

/** Exact, provider-verified external login, never a client-supplied mailbox. */
export class StaffEmployeeClient implements StaffEmployeeVerifier {
  constructor(private readonly token: string, private readonly fetchImplementation: typeof fetch = globalThis.fetch) {}

  async verifyLogin(verifiedLogin: string): Promise<boolean | undefined> {
    const login = verifiedLogin.trim().toLowerCase()
    if (!/^[a-z0-9_.@+-]{1,254}$/.test(login) || !this.token.trim()) return undefined
    const url = new URL('https://staff-api.yandex-team.ru/v4/persons')
    url.searchParams.set('_query', `yandex.login_lower==${JSON.stringify(login)} and official.affiliation=="yandex" and official.is_dismissed==false and official.is_robot==false and official.is_agent==false and is_deleted==false`)
    url.searchParams.set('_fields', 'id,yandex.login_lower,official.affiliation,official.is_dismissed,official.is_robot,official.is_agent,is_deleted')
    url.searchParams.set('_limit', '2')
    try {
      const response = await this.fetchImplementation(url.href, {
        headers: { authorization: `OAuth ${this.token}`, accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(1_500),
      })
      if (!response.ok) return undefined
      const body: unknown = await response.json()
      if (typeof body !== 'object' || body === null || !('result' in body) || !('has_more' in body)
        || body.has_more !== false || !Array.isArray(body.result)) return undefined
      if (body.result.length === 0) return false
      // An ambiguous or malformed response must never revoke a previous result.
      if (body.result.length !== 1) return undefined
      const person: unknown = body.result[0]
      if (typeof person !== 'object' || person === null || !('id' in person) || !Number.isSafeInteger(person.id)
        || !('yandex' in person) || typeof person.yandex !== 'object' || person.yandex === null
        || !('login_lower' in person.yandex) || person.yandex.login_lower !== login
        || !('is_deleted' in person) || person.is_deleted !== false
        || !('official' in person) || typeof person.official !== 'object' || person.official === null) return undefined
      const official = person.official
      if (!('affiliation' in official) || official.affiliation !== 'yandex'
        || !('is_dismissed' in official) || official.is_dismissed !== false
        || !('is_robot' in official) || official.is_robot !== false
        || !('is_agent' in official) || official.is_agent !== false) return undefined
      return true
    } catch {
      // Network/timeout/credentials/parse failure is unknown, not non-employee.
      // Do not propagate upstream exceptions containing contacts or credentials.
      return undefined
    }
  }
}

export class DatabaseYandexEmployeeObserver implements YandexEmployeeObserver {
  constructor(private readonly pool: DatabasePool, private readonly verifier: StaffEmployeeVerifier,
    private readonly now: () => Date = () => new Date()) {}

  async observe(subjectHash: string, verifiedLogin: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(subjectHash)) return
    const observedAt = this.now().toISOString()
    const result = await this.verifier.verifyLogin(verifiedLogin)
    if (result === undefined) return
    const connection = await this.pool.connect()
    try {
      await connection.query('select app_private.record_yandex_employee_verification($1, $2, $3)',
        [subjectHash, result, observedAt])
    } finally { connection.release() }
  }
}

export function configuredStaffVerifier(enabled: string | undefined, token: string | undefined): StaffEmployeeClient | undefined {
  return enabled === 'true' && token?.trim() ? new StaffEmployeeClient(token.trim()) : undefined
}
