import type { QueryResultRow } from 'pg'
import type { DatabasePool, DatabaseClient } from './db/types.js'
import { withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'

export type TrainerProfileDraft = {
  displayName: string
  bio: string
  specialties: string[]
  city: string
  trainingModes: Array<'online' | 'in_person'>
  experienceStartYear: number | null
  education: string
  formats: string
  price: string
  acceptingClients: boolean
  avatarDataUrl: string | null
  certificates: Array<{ title: string; organization: string; year: number | null }>
}

export type TrainerCatalogFilters = {
  query: string
  specialty: string
  city: string
  mode: 'online' | 'in_person' | ''
  acceptingClients: boolean | null
}

interface TrainerProfileRow extends QueryResultRow {
  public_id: string
  draft_data: TrainerProfileDraft
  published_data: TrainerProfileDraft | null
  listed_in_catalog: boolean
  published_at: string | null
  updated_at: string
  version: string | number
}

export class TrainerProfileError extends Error {
  constructor(public readonly failure: 'forbidden' | 'not_found' | 'invalid') {
    super(failure)
    this.name = 'TrainerProfileError'
  }
}

function response(row: TrainerProfileRow) {
  return {
    publicId: row.public_id,
    draft: row.draft_data,
    published: row.published_data,
    listedInCatalog: row.listed_in_catalog,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
  }
}

function text(value: unknown, max: number, min = 0): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max
}

export function readTrainerProfileDraft(value: unknown): TrainerProfileDraft | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const draft = value as Record<string, unknown>
  const specialties = draft.specialties
  const modes = draft.trainingModes
  const certificates = draft.certificates
  const year = draft.experienceStartYear
  if (!text(draft.displayName, 120, 2) || !text(draft.bio, 1200)
    || !text(draft.city, 100) || !text(draft.education, 800)
    || !text(draft.formats, 800) || !text(draft.price, 120)
    || typeof draft.acceptingClients !== 'boolean'
    || !Array.isArray(specialties) || specialties.length > 12
    || specialties.some((item) => !text(item, 60, 1))
    || !Array.isArray(modes) || modes.length > 2
    || modes.some((item) => item !== 'online' && item !== 'in_person')
    || (year !== null && (!Number.isInteger(year) || Number(year) < 1950 || Number(year) > new Date().getFullYear()))
    || (draft.avatarDataUrl !== null && (typeof draft.avatarDataUrl !== 'string'
      || draft.avatarDataUrl.length > 900_000 || !/^data:image\/(?:jpeg|png|webp);base64,/.test(draft.avatarDataUrl)))
    || !Array.isArray(certificates) || certificates.length > 10
    || certificates.some((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return true
      const certificate = item as Record<string, unknown>
      return !text(certificate.title, 120, 1) || !text(certificate.organization, 120)
        || (certificate.year !== null && (!Number.isInteger(certificate.year)
          || Number(certificate.year) < 1950 || Number(certificate.year) > new Date().getFullYear()))
    })) return undefined
  return value as TrainerProfileDraft
}

async function ensureTrainer(client: DatabaseClient) {
  const rows = await client.query('select profile_id from public.trainers where profile_id = auth.uid()')
  if (rows[0] === undefined) throw new TrainerProfileError('forbidden')
}

export interface PilotTrainerProfiles {
  getOwn(session: YandexActorSessionInput): Promise<ReturnType<typeof response> | null>
  saveDraft(session: YandexActorSessionInput, draft: TrainerProfileDraft): Promise<ReturnType<typeof response>>
  publish(session: YandexActorSessionInput): Promise<ReturnType<typeof response>>
  unpublish(session: YandexActorSessionInput): Promise<ReturnType<typeof response>>
  setCatalogListing(session: YandexActorSessionInput, listed: boolean): Promise<ReturnType<typeof response>>
  getPublic(publicId: string): Promise<ReturnType<typeof response> | null>
  listPublic(filters: TrainerCatalogFilters): Promise<Array<ReturnType<typeof response>>>
}

export class DatabasePilotTrainerProfiles implements PilotTrainerProfiles {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(session: YandexActorSessionInput, work: (client: DatabaseClient) => Promise<Result>) {
    return withYandexActorSession(this.pool, session, work)
  }

  getOwn(session: YandexActorSessionInput) {
    return this.withSession(session, async (client) => {
      await ensureTrainer(client)
      const rows = await client.query<TrainerProfileRow>('select * from public.trainer_professional_profiles where trainer_id = auth.uid()')
      return rows[0] === undefined ? null : response(rows[0])
    })
  }

  saveDraft(session: YandexActorSessionInput, draft: TrainerProfileDraft) {
    return this.withSession(session, async (client) => {
      await ensureTrainer(client)
      const rows = await client.query<TrainerProfileRow>(`
        insert into public.trainer_professional_profiles (trainer_id, draft_data)
        values (auth.uid(), $1::jsonb)
        on conflict (trainer_id) do update set draft_data = excluded.draft_data,
          version = public.trainer_professional_profiles.version + 1
        returning *
      `, [JSON.stringify(draft)])
      return response(rows[0]!)
    })
  }

  publish(session: YandexActorSessionInput) {
    return this.withSession(session, async (client) => {
      const current = await client.query<TrainerProfileRow>('select * from public.trainer_professional_profiles where trainer_id = auth.uid() for update')
      const row = current[0]
      if (row === undefined) throw new TrainerProfileError('not_found')
      if (row.draft_data.displayName.trim().length < 2) throw new TrainerProfileError('invalid')
      const rows = await client.query<TrainerProfileRow>(`
        update public.trainer_professional_profiles set published_data = draft_data,
          listed_in_catalog = case when published_data is null then true else listed_in_catalog end,
          published_at = now(), version = version + 1
        where trainer_id = auth.uid() returning *
      `)
      return response(rows[0]!)
    })
  }

  unpublish(session: YandexActorSessionInput) {
    return this.withSession(session, async (client) => {
      const rows = await client.query<TrainerProfileRow>(`
        update public.trainer_professional_profiles set published_data = null,
          published_at = null, listed_in_catalog = false, version = version + 1
        where trainer_id = auth.uid() returning *
      `)
      if (rows[0] === undefined) throw new TrainerProfileError('not_found')
      return response(rows[0])
    })
  }

  setCatalogListing(session: YandexActorSessionInput, listed: boolean) {
    return this.withSession(session, async (client) => {
      const rows = await client.query<TrainerProfileRow>(`
        update public.trainer_professional_profiles
        set listed_in_catalog = $1, version = version + 1
        where trainer_id = auth.uid()
          and (not $1 or published_data is not null)
        returning *
      `, [listed])
      if (rows[0] === undefined) throw new TrainerProfileError('invalid')
      return response(rows[0])
    })
  }

  async getPublic(publicId: string) {
    const connection = await this.pool.connect()
    try {
      const rows = await connection.query<TrainerProfileRow>(`
        select * from public.trainer_professional_profiles
        where public_id = $1 and published_data is not null
      `, [publicId])
      return rows[0] === undefined ? null : response(rows[0])
    } finally {
      connection.release()
    }
  }

  async listPublic(filters: TrainerCatalogFilters) {
    const connection = await this.pool.connect()
    const clauses = ['published_data is not null', 'listed_in_catalog = true']
    const values: unknown[] = []
    const add = (value: unknown) => {
      values.push(value)
      return `$${values.length}`
    }
    if (filters.query) clauses.push(`published_data->>'displayName' ilike '%' || ${add(filters.query)} || '%'`)
    if (filters.specialty) clauses.push(`exists (
      select 1 from jsonb_array_elements_text(coalesce(published_data->'specialties', '[]'::jsonb)) item
      where item ilike '%' || ${add(filters.specialty)} || '%'
    )`)
    if (filters.city) clauses.push(`published_data->>'city' ilike '%' || ${add(filters.city)} || '%'`)
    if (filters.mode) clauses.push(`published_data->'trainingModes' ? ${add(filters.mode)}`)
    if (filters.acceptingClients !== null) {
      clauses.push(`(published_data->>'acceptingClients')::boolean = ${add(filters.acceptingClients)}`)
    }
    try {
      const rows = await connection.query<TrainerProfileRow>(`
        select * from public.trainer_professional_profiles
        where ${clauses.join(' and ')}
        order by ((published_data->>'acceptingClients')::boolean) desc,
          published_at desc, published_data->>'displayName'
        limit 100
      `, values)
      return rows.map(response)
    } finally {
      connection.release()
    }
  }
}
