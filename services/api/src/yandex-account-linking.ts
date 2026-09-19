import type { QueryResultRow } from 'pg'

import { SupabaseBridge, SupabaseBridgeError } from './supabase-bridge.js'
import { withActorTransaction } from './db/actor-transaction.js'
import type { DatabaseClient, DatabasePool } from './db/types.js'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ExistingActorProvider {
  resolveActor(accessToken: string): Promise<ExistingActor | undefined>
}

export interface ExistingCredentialsProvider {
  resolveCredentials(email: string, password: string): Promise<ExistingActor | undefined>
}

export interface ExistingActorProfile {
  id: string
  firstName: string | null
  lastName: string | null
  timezone: string
  accountRole: 'trainer' | 'client'
  createdAt: string
  updatedAt: string
}

export interface ExistingActorTrainer {
  profileId: string
  createdAt: string
  updatedAt: string
}

export interface ExistingActor {
  profile: ExistingActorProfile
  trainer?: ExistingActorTrainer
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

export interface YandexIdentityLinkStatus {
  linked: boolean
}

export interface YandexAccountLinker {
  linkActor(actor: ExistingActor, subjectHash: string): Promise<YandexIdentityLink>
  readStatus(actor: ExistingActor): Promise<YandexIdentityLinkStatus>
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

interface LinkedIdentityStatusRow extends QueryResultRow {
  linked: boolean
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
  actor: ExistingActor,
  subjectHash: string,
): Promise<YandexIdentityLink> {
  try {
    const rows = await client.query<LinkedIdentityRow>(
      `select public.bootstrap_and_link_yandex_identity(
         $1, $2, $3, $4, $5, $6, $7, $8, $9
       ) as profile_id`,
      [
        subjectHash,
        actor.profile.firstName,
        actor.profile.lastName,
        actor.profile.timezone,
        actor.profile.accountRole,
        actor.profile.createdAt,
        actor.profile.updatedAt,
        actor.trainer?.createdAt ?? null,
        actor.trainer?.updatedAt ?? null,
      ],
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

interface SupabaseProfileRow {
  id?: unknown
  first_name?: unknown
  last_name?: unknown
  timezone?: unknown
  account_role?: unknown
  created_at?: unknown
  updated_at?: unknown
}

interface SupabaseTrainerRow {
  profile_id?: unknown
  created_at?: unknown
  updated_at?: unknown
}

function readNullableName(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  return value
}

function readTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined
  return value
}

function readProfile(row: SupabaseProfileRow, actorId: string): ExistingActorProfile | undefined {
  const firstName = readNullableName(row.first_name)
  const lastName = readNullableName(row.last_name)
  const createdAt = readTimestamp(row.created_at)
  const updatedAt = readTimestamp(row.updated_at)
  if (
    row.id !== actorId
    || !UUID_PATTERN.test(actorId)
    || firstName === undefined
    || lastName === undefined
    || typeof row.timezone !== 'string'
    || row.timezone.trim().length === 0
    || (row.account_role !== 'trainer' && row.account_role !== 'client')
    || createdAt === undefined
    || updatedAt === undefined
  ) return undefined

  return {
    id: actorId,
    firstName,
    lastName,
    timezone: row.timezone,
    accountRole: row.account_role,
    createdAt,
    updatedAt,
  }
}

function readTrainer(row: SupabaseTrainerRow, actorId: string): ExistingActorTrainer | undefined {
  const createdAt = readTimestamp(row.created_at)
  const updatedAt = readTimestamp(row.updated_at)
  if (row.profile_id !== actorId || createdAt === undefined || updatedAt === undefined) {
    return undefined
  }
  return { profileId: actorId, createdAt, updatedAt }
}

export class SupabaseExistingActorProvider implements ExistingActorProvider {
  constructor(private readonly supabase: SupabaseBridge) {}

  async resolveActor(accessToken: string): Promise<ExistingActor | undefined> {
    try {
      const actorId = await this.supabase.authenticatedUserId(accessToken)
      if (actorId === undefined || !UUID_PATTERN.test(actorId)) return undefined

      const [profiles, trainers] = await Promise.all([
        this.supabase.select<SupabaseProfileRow[]>(
          'profiles?select=id,first_name,last_name,timezone,account_role,created_at,updated_at',
          accessToken,
        ),
        this.supabase.select<SupabaseTrainerRow[]>(
          'trainers?select=profile_id,created_at,updated_at',
          accessToken,
        ),
      ])
      if (profiles.length !== 1 || trainers.length > 1) return undefined
      const profileRow = profiles[0]
      if (profileRow === undefined) return undefined
      const profile = readProfile(profileRow, actorId)
      if (profile === undefined) return undefined

      if (profile.accountRole === 'trainer') {
        const trainerRow = trainers[0]
        if (trainerRow === undefined) return undefined
        const trainer = readTrainer(trainerRow, actorId)
        return trainer === undefined ? undefined : { profile, trainer }
      }
      if (trainers.length !== 0) return undefined
      return { profile }
    } catch (error) {
      if (error instanceof SupabaseBridgeError && error.status === 503) {
        throw new ExistingActorUnavailableError()
      }
      throw error
    }
  }
}

export class SupabaseExistingCredentialsProvider implements ExistingCredentialsProvider {
  constructor(
    private readonly supabase: SupabaseBridge,
    private readonly actorProvider = new SupabaseExistingActorProvider(supabase),
  ) {}

  async resolveCredentials(email: string, password: string): Promise<ExistingActor | undefined> {
    try {
      const accessToken = await this.supabase.passwordAccessToken(email, password)
      return accessToken === undefined
        ? undefined
        : await this.actorProvider.resolveActor(accessToken)
    } catch (error) {
      if (error instanceof SupabaseBridgeError && error.status >= 500) {
        throw new ExistingActorUnavailableError()
      }
      throw error
    }
  }
}

export class DatabaseYandexAccountLinker implements YandexAccountLinker {
  constructor(private readonly pool: DatabasePool) {}

  linkActor(actor: ExistingActor, subjectHash: string): Promise<YandexIdentityLink> {
    return withActorTransaction(this.pool, actor.profile.id, (client) =>
      linkYandexIdentity(client, actor, subjectHash))
  }

  readStatus(actor: ExistingActor): Promise<YandexIdentityLinkStatus> {
    return withActorTransaction(this.pool, actor.profile.id, async (client) => {
      const rows = await client.query<LinkedIdentityStatusRow>(
        'select public.has_yandex_identity() as linked',
      )
      return { linked: rows[0]?.linked === true }
    })
  }
}
