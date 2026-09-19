import type { QueryResultRow } from 'pg'

import { createPilotSessionToken, hashPilotSessionToken } from './auth/pilot-session-token.js'
import type { DatabasePool } from './db/types.js'
import type { ExistingActor } from './yandex-account-linking.js'
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from './legal-document-versions.js'
import type { YandexNativeRegistrationInput } from './yandex-native-registration.js'

const HANDOFF_TTL_MS = 10 * 60 * 1_000
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/

export interface YandexAuthHandoffToken {
  token: string
  expiresAt: string
}

export interface CompletedYandexAuthHandoff {
  profileId: string
  subjectHash: string
}

export type YandexAuthHandoffFailure =
  | 'conflict'
  | 'expired'
  | 'invalid'
  | 'not_found'
  | 'not_ready'

export class YandexAuthHandoffError extends Error {
  constructor(readonly failure: YandexAuthHandoffFailure) {
    super(`Yandex auth handoff failed: ${failure}`)
    this.name = 'YandexAuthHandoffError'
  }
}

export interface YandexAuthHandoffService {
  issue(subjectHash: string): Promise<YandexAuthHandoffToken | undefined>
  recordRecoveryAttempt(token: string): Promise<void>
  linkExisting(token: string, actor: ExistingActor): Promise<CompletedYandexAuthHandoff>
  register(
    token: string,
    input: YandexNativeRegistrationInput,
  ): Promise<CompletedYandexAuthHandoff>
}

interface CreatedRow extends QueryResultRow {
  created: boolean
}

interface CompletedRow extends QueryResultRow {
  profile_id: string
  subject_sha256: string
}

function mapHandoffError(error: unknown): YandexAuthHandoffError | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error)) return undefined
  switch (error.message) {
    case 'yandex_auth_handoff_expired': return new YandexAuthHandoffError('expired')
    case 'migrated_profile_not_found': return new YandexAuthHandoffError('not_found')
    case 'migrated_profile_not_ready': return new YandexAuthHandoffError('not_ready')
    case 'migrated_profile_role_mismatch':
    case 'yandex_identity_already_linked':
    case 'yandex_profile_already_linked':
    case 'yandex_identity_existing_account':
      return new YandexAuthHandoffError('conflict')
    default:
      return typeof error.message === 'string' && error.message.startsWith('yandex_')
        ? new YandexAuthHandoffError('invalid')
        : undefined
  }
}

function readCompleted(rows: readonly CompletedRow[]): CompletedYandexAuthHandoff {
  const row = rows[0]
  if (row === undefined || !UUID_PATTERN.test(row.profile_id) || !SHA256_PATTERN.test(row.subject_sha256)) {
    throw new YandexAuthHandoffError('invalid')
  }
  return { profileId: row.profile_id, subjectHash: row.subject_sha256 }
}

export class DatabaseYandexAuthHandoffService implements YandexAuthHandoffService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(subjectHash: string): Promise<YandexAuthHandoffToken | undefined> {
    if (!SHA256_PATTERN.test(subjectHash)) throw new YandexAuthHandoffError('invalid')
    const handoff = createPilotSessionToken()
    const expiresAt = new Date(this.now().getTime() + HANDOFF_TTL_MS)
    const connection = await this.pool.connect()
    try {
      const rows = await connection.query<CreatedRow>(
        'select app_private.create_yandex_auth_handoff($1, $2, $3) as created',
        [subjectHash, handoff.sha256, expiresAt.toISOString()],
      )
      return rows[0]?.created === true
        ? { token: handoff.raw, expiresAt: expiresAt.toISOString() }
        : undefined
    } catch (error) {
      throw mapHandoffError(error) ?? error
    } finally {
      connection.release()
    }
  }

  async linkExisting(token: string, actor: ExistingActor): Promise<CompletedYandexAuthHandoff> {
    const tokenHash = hashPilotSessionToken(token)
    if (tokenHash === undefined) throw new YandexAuthHandoffError('invalid')
    const connection = await this.pool.connect()
    try {
      return readCompleted(await connection.query<CompletedRow>(
        `select profile_id, subject_sha256
         from app_private.link_migrated_yandex_account($1, $2, $3)`,
        [tokenHash, actor.profile.id, actor.profile.accountRole],
      ))
    } catch (error) {
      throw mapHandoffError(error) ?? error
    } finally {
      connection.release()
    }
  }

  async recordRecoveryAttempt(token: string): Promise<void> {
    const tokenHash = hashPilotSessionToken(token)
    if (tokenHash === undefined) throw new YandexAuthHandoffError('invalid')
    const connection = await this.pool.connect()
    try {
      await connection.query(
        'select app_private.record_yandex_auth_recovery_attempt($1)',
        [tokenHash],
      )
    } catch (error) {
      throw mapHandoffError(error) ?? error
    } finally {
      connection.release()
    }
  }

  async register(
    token: string,
    input: YandexNativeRegistrationInput,
  ): Promise<CompletedYandexAuthHandoff> {
    const tokenHash = hashPilotSessionToken(token)
    if (tokenHash === undefined) throw new YandexAuthHandoffError('invalid')
    const connection = await this.pool.connect()
    try {
      return readCompleted(await connection.query<CompletedRow>(
        `select profile_id, subject_sha256
         from app_private.register_yandex_account_from_handoff(
           $1, $2, $3, $4, $5, $6
         )`,
        [
          tokenHash,
          input.firstName,
          input.timezone,
          input.accountRole,
          CURRENT_TERMS_VERSION,
          CURRENT_PRIVACY_VERSION,
        ],
      ))
    } catch (error) {
      throw mapHandoffError(error) ?? error
    } finally {
      connection.release()
    }
  }
}
