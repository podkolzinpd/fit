import type { QueryResultRow } from 'pg'

import type { DatabasePool } from './db/types.js'
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from './legal-document-versions.js'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface YandexNativeRegistrationInput {
  accountRole: 'trainer' | 'client'
  firstName: string
  timezone: string
}

export interface YandexNativeRegistration {
  profileId: string
}

export interface YandexNativeRegistrar {
  register(
    subjectHash: string,
    input: YandexNativeRegistrationInput,
  ): Promise<YandexNativeRegistration>
}

export type YandexNativeRegistrationFailure = 'conflict' | 'invalid'

export class YandexNativeRegistrationError extends Error {
  constructor(readonly failure: YandexNativeRegistrationFailure) {
    super(`Yandex native registration failed: ${failure}`)
    this.name = 'YandexNativeRegistrationError'
  }
}

interface RegistrationRow extends QueryResultRow {
  profile_id: string
}

function mapRegistrationError(error: unknown): YandexNativeRegistrationError | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return undefined
  }
  if (error.message === 'yandex_identity_existing_account') {
    return new YandexNativeRegistrationError('conflict')
  }
  if (typeof error.message === 'string' && error.message.startsWith('yandex_registration_')) {
    return new YandexNativeRegistrationError('invalid')
  }
  return undefined
}

export class DatabaseYandexNativeRegistrar implements YandexNativeRegistrar {
  constructor(private readonly pool: DatabasePool) {}

  async register(
    subjectHash: string,
    input: YandexNativeRegistrationInput,
  ): Promise<YandexNativeRegistration> {
    const connection = await this.pool.connect()
    try {
      const rows = await connection.query<RegistrationRow>(
        `select app_private.register_yandex_account(
           $1, $2, $3, $4, $5, $6
         ) as profile_id`,
        [
          subjectHash,
          input.firstName,
          input.timezone,
          input.accountRole,
          CURRENT_TERMS_VERSION,
          CURRENT_PRIVACY_VERSION,
        ],
      )
      const profileId = rows[0]?.profile_id
      if (profileId === undefined || !UUID_PATTERN.test(profileId)) {
        throw new YandexNativeRegistrationError('invalid')
      }
      return { profileId }
    } catch (error) {
      throw mapRegistrationError(error) ?? error
    } finally {
      connection.release()
    }
  }
}
