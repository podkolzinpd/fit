import type { QueryResultRow } from 'pg'

import { SupabaseBridge, SupabaseBridgeError } from './supabase-bridge.js'
import { withActorTransaction } from './db/actor-transaction.js'
import type { DatabaseClient, DatabasePool } from './db/types.js'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ExistingActorProvider {
  resolveActor(accessToken: string): Promise<string | undefined>
}

export class ExistingActorUnavailableError extends Error {
  constructor() {
    super('Existing auth provider is unavailable')
    this.name = 'ExistingActorUnavailableError'
  }
}

export interface YandexIdentityLink {
  profileId: string
}

export interface YandexAccountLinker {
  linkActor(actorId: string, subjectHash: string): Promise<YandexIdentityLink>
}

export type YandexAccountLinkFailure =
  | 'conflict'
  | 'forbidden'
  | 'invalid'
  | 'not_found'

export class YandexAccountLinkError extends Error {
  constructor(readonly failure: YandexAccountLinkFailure) {
    super(`Yandex account link failed: ${failure}`)
    this.name = 'YandexAccountLinkError'
  }
}

interface LinkedIdentityRow extends QueryResultRow {
  profile_id: string
}

function mapYandexAccountLinkError(error: unknown): YandexAccountLinkError | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return undefined
  }
  const message = error.message
  if (message === 'authentication_required') {
    return new YandexAccountLinkError('forbidden')
  }
  if (message === 'profile_not_found') {
    return new YandexAccountLinkError('not_found')
  }
  if (
    message === 'yandex_identity_already_linked'
    || message === 'yandex_profile_already_linked'
  ) {
    return new YandexAccountLinkError('conflict')
  }
  if (typeof message === 'string' && message.startsWith('yandex_')) {
    return new YandexAccountLinkError('invalid')
  }
  return undefined
}

async function linkYandexIdentity(
  client: DatabaseClient,
  subjectHash: string,
): Promise<YandexIdentityLink> {
  try {
    const rows = await client.query<LinkedIdentityRow>(
      'select public.link_yandex_identity($1) as profile_id',
      [subjectHash],
    )
    const profileId = rows[0]?.profile_id
    if (profileId === undefined || !UUID_PATTERN.test(profileId)) {
      throw new YandexAccountLinkError('not_found')
    }
    return { profileId }
  } catch (error) {
    throw mapYandexAccountLinkError(error) ?? error
  }
}

export class SupabaseExistingActorProvider implements ExistingActorProvider {
  constructor(private readonly supabase: SupabaseBridge) {}

  async resolveActor(accessToken: string): Promise<string | undefined> {
    try {
      return await this.supabase.authenticatedUserId(accessToken)
    } catch (error) {
      if (error instanceof SupabaseBridgeError && error.status === 503) {
        throw new ExistingActorUnavailableError()
      }
      throw error
    }
  }
}

export class DatabaseYandexAccountLinker implements YandexAccountLinker {
  constructor(private readonly pool: DatabasePool) {}

  linkActor(actorId: string, subjectHash: string): Promise<YandexIdentityLink> {
    return withActorTransaction(this.pool, actorId, (client) =>
      linkYandexIdentity(client, subjectHash))
  }
}
