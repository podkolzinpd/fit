import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import type { DatabasePool, DatabaseClient } from './db/types.js'
import type { MediaObjectStorage } from './object-storage-media.js'
import type { TrainerPhotoUpload } from './trainer-profile-media.js'
import { withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'

type TrainerProfileCore = {
  displayName: string
  bio: string
  specialties: string[]
  city: string
  metroStationIds: string[]
  customLocations: string[]
  trainingModes: Array<'online' | 'in_person'>
  experienceStartYear: number | null
  education: string
  formats: string
  price: string
  acceptingClients: boolean
  avatarDataUrl: string | null
  certificates: Array<{ title: string; organization: string; year: number | null }>
}

export type TrainerProfilePhoto = {
  id: string
  url: string | null
  thumbnailUrl: string
  mimeType: 'image/jpeg'
  width: number
  height: number
}

export type TrainerProfileDraft = TrainerProfileCore & {
  photos: TrainerProfilePhoto[]
}

type StoredTrainerProfilePhoto = {
  id: string
  path: string
  thumbnailPath: string
  mimeType: 'image/jpeg'
  width: number
  height: number
  sizeBytes: number
  thumbnailWidth: number
  thumbnailHeight: number
  thumbnailSizeBytes: number
}

type StoredTrainerProfileDraft = TrainerProfileCore & {
  photos?: StoredTrainerProfilePhoto[]
}

export type TrainerCatalogFilters = {
  query: string
  specialties: string[]
  city: string
  metroStationIds: string[]
  mode: 'online' | 'in_person' | ''
  acceptingClients: boolean | null
  brandTrainerOnly: boolean
}

export type TrainerCatalogPageOptions = { offset: number; limit: number }
export const MAX_TRAINER_CATALOG_PAGE_SIZE = 3
export type TrainerCatalogItem = {
  publicId: string
  profile: TrainerProfileDraft
  isBrandTrainer: boolean
}
export type TrainerCatalogPage = {
  items: TrainerCatalogItem[]
  totalCount: number
  nextOffset: number | null
}

interface TrainerProfileRow extends QueryResultRow {
  public_id: string
  draft_data: StoredTrainerProfileDraft
  published_data: StoredTrainerProfileDraft | null
  listed_in_catalog: boolean
  published_at: string | null
  updated_at: string
  version: string | number
  is_brand_trainer: boolean
}

interface PublicTrainerProfileRow extends QueryResultRow {
  public_id: string
  published_data: StoredTrainerProfileDraft
  listed_in_catalog: boolean
  published_at: string | null
  updated_at: string
  version: string | number
  is_brand_trainer: boolean
}

interface TrainerCatalogRow extends QueryResultRow {
  public_id: string
  published_data: StoredTrainerProfileDraft
  is_brand_trainer: boolean
}

export class TrainerProfileError extends Error {
  constructor(public readonly failure: 'forbidden' | 'not_found' | 'invalid' | 'limit_reached' | 'media_unavailable') {
    super(failure)
    this.name = 'TrainerProfileError'
  }
}

export type TrainerProfessionalProfileResponse = {
  publicId: string
  draft: TrainerProfileDraft
  published: TrainerProfileDraft | null
  listedInCatalog: boolean
  publishedAt: string | null
  updatedAt: string
  version: number
  isBrandTrainer: boolean
}

function storedPhotos(draft: StoredTrainerProfileDraft | null): StoredTrainerProfilePhoto[] {
  if (!draft || !Array.isArray(draft.photos)) return []
  return draft.photos.filter((photo) => photo && typeof photo === 'object'
    && typeof photo.id === 'string' && typeof photo.path === 'string'
    && typeof photo.thumbnailPath === 'string' && photo.mimeType === 'image/jpeg'
    && Number.isInteger(photo.width) && Number.isInteger(photo.height)
    && Number.isInteger(photo.sizeBytes) && Number.isInteger(photo.thumbnailWidth)
    && Number.isInteger(photo.thumbnailHeight) && Number.isInteger(photo.thumbnailSizeBytes)).slice(0, 3)
}

function withoutStoredPhotos(draft: StoredTrainerProfileDraft): TrainerProfileCore {
  const { photos: _photos, ...core } = draft
  void _photos
  return core
}

function storedDraft(input: TrainerProfileDraft, photos: StoredTrainerProfilePhoto[]): StoredTrainerProfileDraft {
  const { photos: _photos, ...core } = input
  void _photos
  return { ...core, photos }
}

function rowResponse(row: TrainerProfileRow, draft: TrainerProfileDraft, published: TrainerProfileDraft | null): TrainerProfessionalProfileResponse {
  return {
    publicId: row.public_id,
    draft,
    published,
    listedInCatalog: row.listed_in_catalog,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
    isBrandTrainer: row.is_brand_trainer,
  }
}

function publicResponse(row: PublicTrainerProfileRow, profile: TrainerProfileDraft): TrainerProfessionalProfileResponse {
  return {
    publicId: row.public_id,
    draft: profile,
    published: profile,
    listedInCatalog: row.listed_in_catalog,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
    isBrandTrainer: row.is_brand_trainer,
  }
}

function catalogResponse(row: TrainerCatalogRow, profile: TrainerProfileDraft): TrainerCatalogItem {
  return {
    publicId: row.public_id,
    profile,
    isBrandTrainer: row.is_brand_trainer,
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
  const metroStationIds = draft.metroStationIds ?? []
  const customLocations = draft.customLocations ?? []
  const photos = draft.photos ?? []
  const year = draft.experienceStartYear
  if (!text(draft.displayName, 120, 2) || !text(draft.bio, 1200)
    || !text(draft.city, 100) || !text(draft.education, 800)
    || !text(draft.formats, 800) || !text(draft.price, 120)
    || typeof draft.acceptingClients !== 'boolean'
    // 20/100 match metroStationIds/customLocations below, not the client's
    // narrower 14-item/80-char ceiling (src/shared/trainer-profile.ts) - the
    // server check drifting tighter than the client silently rejected valid
    // saves (e.g. "Реабилитация и адаптивная физкультура (после травм,
    // ограничения по здоровью)" at 76 chars). Give this one headroom so a
    // small client-side bump doesn't reopen the same gap.
    || !Array.isArray(specialties) || specialties.length > 20
    || specialties.some((item) => !text(item, 100, 1))
    || !Array.isArray(modes) || modes.length > 2
    || modes.some((item) => item !== 'online' && item !== 'in_person')
    || !Array.isArray(metroStationIds) || metroStationIds.length > 20
    || metroStationIds.some((item) => !text(item, 100, 1))
    || !Array.isArray(customLocations) || customLocations.length > 20
    || customLocations.some((item) => !text(item, 160, 1))
    || (year !== null && (!Number.isInteger(year) || Number(year) < 1950 || Number(year) > new Date().getFullYear()))
    || (draft.avatarDataUrl !== null && (typeof draft.avatarDataUrl !== 'string'
      || draft.avatarDataUrl.length > 900_000 || !/^data:image\/(?:jpeg|png|webp);base64,/.test(draft.avatarDataUrl)))
    || !Array.isArray(photos) || photos.length > 3
    || photos.some((item) => typeof item !== 'object' || item === null || Array.isArray(item)
      || !text((item as Record<string, unknown>).id, 64, 1))
    || !Array.isArray(certificates) || certificates.length > 10
    || certificates.some((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return true
      const certificate = item as Record<string, unknown>
      return !text(certificate.title, 120, 1) || !text(certificate.organization, 120)
        || (certificate.year !== null && (!Number.isInteger(certificate.year)
          || Number(certificate.year) < 1950 || Number(certificate.year) > new Date().getFullYear()))
    })) return undefined
  return {
    ...(value as Omit<TrainerProfileDraft, 'metroStationIds' | 'customLocations' | 'photos'>),
    metroStationIds: metroStationIds.map((item) => String(item)),
    customLocations: customLocations.map((item) => String(item)),
    // Signed URLs are response-only. saveDraft preserves trusted server metadata.
    photos: [],
  }
}

async function ensureTrainer(client: DatabaseClient) {
  const rows = await client.query('select profile_id from public.trainers where profile_id = auth.uid()')
  if (rows[0] === undefined) throw new TrainerProfileError('forbidden')
}

export interface PilotTrainerProfiles {
  getOwn(session: YandexActorSessionInput): Promise<TrainerProfessionalProfileResponse | null>
  saveDraft(session: YandexActorSessionInput, draft: TrainerProfileDraft): Promise<TrainerProfessionalProfileResponse>
  uploadPhoto: (session: YandexActorSessionInput, draft: TrainerProfileDraft, upload: TrainerPhotoUpload, replaceLegacy: boolean) => Promise<TrainerProfessionalProfileResponse>
  reorderPhotos: (session: YandexActorSessionInput, photoIds: string[]) => Promise<TrainerProfessionalProfileResponse>
  deletePhoto: (session: YandexActorSessionInput, photoId: string) => Promise<TrainerProfessionalProfileResponse>
  publish(session: YandexActorSessionInput): Promise<TrainerProfessionalProfileResponse>
  unpublish(session: YandexActorSessionInput): Promise<TrainerProfessionalProfileResponse>
  setCatalogListing(session: YandexActorSessionInput, listed: boolean): Promise<TrainerProfessionalProfileResponse>
  getPublic(publicId: string): Promise<TrainerProfessionalProfileResponse | null>
  listPublic(filters: TrainerCatalogFilters, page: TrainerCatalogPageOptions): Promise<TrainerCatalogPage>
}

export class DatabasePilotTrainerProfiles implements PilotTrainerProfiles {
  constructor(
    private readonly pool: DatabasePool,
    private readonly media?: MediaObjectStorage,
  ) {}

  private withSession<Result>(session: YandexActorSessionInput, work: (client: DatabaseClient) => Promise<Result>) {
    return withYandexActorSession(this.pool, session, work)
  }

  private async exposeDraft(draft: StoredTrainerProfileDraft, includeFull: boolean): Promise<TrainerProfileDraft> {
    const records = storedPhotos(draft)
    if (records.length > 0 && this.media === undefined) throw new TrainerProfileError('media_unavailable')
    const photos = await Promise.all(records.map(async (photo): Promise<TrainerProfilePhoto> => ({
      id: photo.id,
      url: includeFull ? await this.media!.sign('trainer-profile-media', photo.path) : null,
      thumbnailUrl: await this.media!.sign('trainer-profile-media', photo.thumbnailPath),
      mimeType: photo.mimeType,
      width: photo.width,
      height: photo.height,
    })))
    return { ...withoutStoredPhotos(draft), photos }
  }

  private async exposeRow(row: TrainerProfileRow): Promise<TrainerProfessionalProfileResponse> {
    const [draft, published] = await Promise.all([
      this.exposeDraft(row.draft_data, true),
      row.published_data === null ? Promise.resolve(null) : this.exposeDraft(row.published_data, true),
    ])
    return rowResponse(row, draft, published)
  }

  private async removePhotos(records: StoredTrainerProfilePhoto[]) {
    if (!this.media) return
    await Promise.allSettled(records.flatMap((photo) => [
      this.media!.remove('trainer-profile-media', photo.path),
      this.media!.remove('trainer-profile-media', photo.thumbnailPath),
    ]))
  }

  async getOwn(session: YandexActorSessionInput) {
    const row = await this.withSession(session, async (client) => {
      await ensureTrainer(client)
      const rows = await client.query<TrainerProfileRow>('select * from public.trainer_professional_profiles where trainer_id = auth.uid()')
      return rows[0] ?? null
    })
    return row === null ? null : this.exposeRow(row)
  }

  async saveDraft(session: YandexActorSessionInput, draft: TrainerProfileDraft) {
    const row = await this.withSession(session, async (client) => {
      await ensureTrainer(client)
      const current = await client.query<TrainerProfileRow>(
        'select * from public.trainer_professional_profiles where trainer_id = auth.uid() for update',
      )
      const photos = storedPhotos(current[0]?.draft_data ?? null)
      const nextDraft = storedDraft({ ...draft, avatarDataUrl: photos.length > 0 ? null : draft.avatarDataUrl }, photos)
      const rows = await client.query<TrainerProfileRow>(`
        insert into public.trainer_professional_profiles (trainer_id, draft_data)
        values (auth.uid(), $1::jsonb)
        on conflict (trainer_id) do update set draft_data = excluded.draft_data,
          version = public.trainer_professional_profiles.version + 1
        returning *
      `, [JSON.stringify(nextDraft)])
      return rows[0]!
    })
    return this.exposeRow(row)
  }

  async uploadPhoto(
    session: YandexActorSessionInput,
    draft: TrainerProfileDraft,
    upload: TrainerPhotoUpload,
    replaceLegacy: boolean,
  ) {
    if (!this.media) throw new TrainerProfileError('media_unavailable')
    const actor = await this.withSession(session, async (client) => {
      await ensureTrainer(client)
      const actorRows = await client.query<{ actor_id: string }>('select auth.uid()::text actor_id')
      const rows = await client.query<TrainerProfileRow>(
        'select * from public.trainer_professional_profiles where trainer_id = auth.uid()',
      )
      if (storedPhotos(rows[0]?.draft_data ?? null).length >= 3) throw new TrainerProfileError('limit_reached')
      return actorRows[0]?.actor_id
    })
    if (!actor) throw new TrainerProfileError('forbidden')
    const id = randomUUID()
    const path = `${actor}/${id}/full.jpg`
    const thumbnailPath = `${actor}/${id}/thumbnail.jpg`
    let row: TrainerProfileRow
    try {
      await this.media.write('trainer-profile-media', path, upload.image.bytes, upload.image.mimeType, false)
      await this.media.write('trainer-profile-media', thumbnailPath, upload.thumbnail.bytes, upload.thumbnail.mimeType, false)
      row = await this.withSession(session, async (client) => {
        await ensureTrainer(client)
        const current = await client.query<TrainerProfileRow>(
          'select * from public.trainer_professional_profiles where trainer_id = auth.uid() for update',
        )
        const photos = storedPhotos(current[0]?.draft_data ?? null)
        if (photos.length >= 3) throw new TrainerProfileError('limit_reached')
        const photo: StoredTrainerProfilePhoto = {
          id,
          path,
          thumbnailPath,
          mimeType: 'image/jpeg',
          width: upload.image.width,
          height: upload.image.height,
          sizeBytes: upload.image.sizeBytes,
          thumbnailWidth: upload.thumbnail.width,
          thumbnailHeight: upload.thumbnail.height,
          thumbnailSizeBytes: upload.thumbnail.sizeBytes,
        }
        const nextDraft = storedDraft({
          ...draft,
          avatarDataUrl: replaceLegacy || photos.length > 0 ? null : draft.avatarDataUrl,
        }, [...photos, photo])
        const rows = await client.query<TrainerProfileRow>(`
          insert into public.trainer_professional_profiles (trainer_id, draft_data)
          values (auth.uid(), $1::jsonb)
          on conflict (trainer_id) do update set draft_data = excluded.draft_data,
            version = public.trainer_professional_profiles.version + 1
          returning *
        `, [JSON.stringify(nextDraft)])
        return rows[0]!
      })
    } catch (error) {
      await this.removePhotos([{
        id, path, thumbnailPath, mimeType: 'image/jpeg',
        width: upload.image.width, height: upload.image.height, sizeBytes: upload.image.sizeBytes,
        thumbnailWidth: upload.thumbnail.width, thumbnailHeight: upload.thumbnail.height,
        thumbnailSizeBytes: upload.thumbnail.sizeBytes,
      }])
      throw error
    }
    // Signing is intentionally outside the rollback block: once PostgreSQL has
    // committed the metadata, a transient signing failure must not delete files
    // still referenced by the saved profile.
    return this.exposeRow(row)
  }

  async reorderPhotos(session: YandexActorSessionInput, photoIds: string[]) {
    const row = await this.withSession(session, async (client) => {
      const current = await client.query<TrainerProfileRow>(
        'select * from public.trainer_professional_profiles where trainer_id = auth.uid() for update',
      )
      const profile = current[0]
      if (!profile) throw new TrainerProfileError('not_found')
      const photos = storedPhotos(profile.draft_data)
      if (photoIds.length !== photos.length || new Set(photoIds).size !== photos.length
        || photos.some((photo) => !photoIds.includes(photo.id))) throw new TrainerProfileError('invalid')
      const byId = new Map(photos.map((photo) => [photo.id, photo]))
      const ordered = photoIds.map((id) => byId.get(id)!)
      const rows = await client.query<TrainerProfileRow>(`
        update public.trainer_professional_profiles set draft_data = $1::jsonb,
          version = version + 1 where trainer_id = auth.uid() returning *
      `, [JSON.stringify({ ...profile.draft_data, photos: ordered })])
      return rows[0]!
    })
    return this.exposeRow(row)
  }

  async deletePhoto(session: YandexActorSessionInput, photoId: string) {
    const result = await this.withSession(session, async (client) => {
      const current = await client.query<TrainerProfileRow>(
        'select * from public.trainer_professional_profiles where trainer_id = auth.uid() for update',
      )
      const profile = current[0]
      if (!profile) throw new TrainerProfileError('not_found')
      const photos = storedPhotos(profile.draft_data)
      const deleted = photos.find((photo) => photo.id === photoId)
      if (!deleted) throw new TrainerProfileError('not_found')
      const rows = await client.query<TrainerProfileRow>(`
        update public.trainer_professional_profiles set draft_data = $1::jsonb,
          version = version + 1 where trainer_id = auth.uid() returning *
      `, [JSON.stringify({ ...profile.draft_data, photos: photos.filter((photo) => photo.id !== photoId) })])
      const publishedPaths = new Set(storedPhotos(profile.published_data).flatMap((photo) => [photo.path, photo.thumbnailPath]))
      const removable = publishedPaths.has(deleted.path) || publishedPaths.has(deleted.thumbnailPath) ? [] : [deleted]
      return { row: rows[0]!, removable }
    })
    // A published snapshot owns its referenced objects until it is replaced or
    // unpublished; an unpublished draft can release deleted photos immediately.
    await this.removePhotos(result.removable)
    return this.exposeRow(result.row)
  }

  async publish(session: YandexActorSessionInput) {
    const result = await this.withSession(session, async (client) => {
      const current = await client.query<TrainerProfileRow>('select * from public.trainer_professional_profiles where trainer_id = auth.uid() for update')
      const row = current[0]
      if (row === undefined) throw new TrainerProfileError('not_found')
      if (row.draft_data.displayName.trim().length < 2) throw new TrainerProfileError('invalid')
      const activePaths = new Set(storedPhotos(row.draft_data).flatMap((photo) => [photo.path, photo.thumbnailPath]))
      const orphaned = storedPhotos(row.published_data).filter((photo) =>
        !activePaths.has(photo.path) && !activePaths.has(photo.thumbnailPath))
      const rows = await client.query<TrainerProfileRow>(`
        update public.trainer_professional_profiles set published_data = draft_data,
          listed_in_catalog = case when published_data is null then true else listed_in_catalog end,
          published_at = now(), version = version + 1
        where trainer_id = auth.uid() returning *
      `)
      return { row: rows[0]!, orphaned }
    })
    await this.removePhotos(result.orphaned)
    return this.exposeRow(result.row)
  }

  async unpublish(session: YandexActorSessionInput) {
    const result = await this.withSession(session, async (client) => {
      const current = await client.query<TrainerProfileRow>(
        'select * from public.trainer_professional_profiles where trainer_id = auth.uid() for update',
      )
      const profile = current[0]
      if (!profile) throw new TrainerProfileError('not_found')
      const activePaths = new Set(storedPhotos(profile.draft_data).flatMap((photo) => [photo.path, photo.thumbnailPath]))
      const orphaned = storedPhotos(profile.published_data).filter((photo) =>
        !activePaths.has(photo.path) && !activePaths.has(photo.thumbnailPath))
      const rows = await client.query<TrainerProfileRow>(`
        update public.trainer_professional_profiles set published_data = null,
          published_at = null, listed_in_catalog = false, version = version + 1
        where trainer_id = auth.uid() returning *
      `)
      if (rows[0] === undefined) throw new TrainerProfileError('not_found')
      return { row: rows[0], orphaned }
    })
    await this.removePhotos(result.orphaned)
    return this.exposeRow(result.row)
  }

  async setCatalogListing(session: YandexActorSessionInput, listed: boolean) {
    const row = await this.withSession(session, async (client) => {
      const rows = await client.query<TrainerProfileRow>(`
        update public.trainer_professional_profiles
        set listed_in_catalog = $1, version = version + 1
        where trainer_id = auth.uid()
          and (not $1 or published_data is not null)
        returning *
      `, [listed])
      if (rows[0] === undefined) throw new TrainerProfileError('invalid')
      return rows[0]
    })
    return this.exposeRow(row)
  }

  async getPublic(publicId: string) {
    const connection = await this.pool.connect()
    try {
      const rows = await connection.query<PublicTrainerProfileRow>(`
        select public_id, published_data, listed_in_catalog, published_at,
          updated_at, version, is_brand_trainer
        from public.trainer_professional_profiles
        where public_id = $1 and published_data is not null
      `, [publicId])
      if (rows[0] === undefined) return null
      return publicResponse(rows[0], await this.exposeDraft(rows[0].published_data, true))
    } finally {
      connection.release()
    }
  }

  async listPublic(filters: TrainerCatalogFilters, page: TrainerCatalogPageOptions) {
    const connection = await this.pool.connect()
    const clauses = ['published_data is not null', 'listed_in_catalog = true']
    const values: unknown[] = []
    const add = (value: unknown) => {
      values.push(value)
      return `$${values.length}`
    }
    if (filters.query) clauses.push(`published_data->>'displayName' ilike '%' || ${add(filters.query)} || '%'`)
    if (filters.specialties.length > 0) clauses.push(`exists (
      select 1 from jsonb_array_elements_text(coalesce(published_data->'specialties', '[]'::jsonb)) item
      where item = any(${add(filters.specialties)}::text[])
    )`)
    if (filters.city) clauses.push(`published_data->>'city' ilike '%' || ${add(filters.city)} || '%'`)
    if (filters.metroStationIds.length > 0) clauses.push(`exists (
      select 1 from jsonb_array_elements_text(case
        when jsonb_typeof(published_data->'metroStationIds') = 'array' then published_data->'metroStationIds'
        else '[]'::jsonb end) station_id
      where station_id = any(${add(filters.metroStationIds)}::text[])
    )`)
    if (filters.mode) clauses.push(`published_data->'trainingModes' ? ${add(filters.mode)}`)
    if (filters.acceptingClients !== null) {
      clauses.push(`(published_data->>'acceptingClients')::boolean = ${add(filters.acceptingClients)}`)
    }
    if (filters.brandTrainerOnly) clauses.push('is_brand_trainer = true')
    try {
      const countRows = await connection.query<{ total: string }>(`
        select count(*)::text as total from public.trainer_professional_profiles
        where ${clauses.join(' and ')}
      `, values)
      const offsetParam = add(page.offset)
      const limitParam = add(Math.min(page.limit, MAX_TRAINER_CATALOG_PAGE_SIZE))
      const rows = await connection.query<TrainerCatalogRow>(`
        select public_id, published_data, is_brand_trainer
        from public.trainer_professional_profiles
        where ${clauses.join(' and ')}
        order by ((published_data->>'acceptingClients')::boolean) desc,
          is_brand_trainer desc,
          published_at desc, lower(published_data->>'displayName'), public_id
        offset ${offsetParam} limit ${limitParam}
      `, values)
      const totalCount = Number(countRows[0]?.total ?? 0)
      const next = page.offset + rows.length
      const items = await Promise.all(rows.map(async (row) =>
        catalogResponse(row, await this.exposeDraft(row.published_data, false))))
      return { items, totalCount, nextOffset: next < totalCount ? next : null }
    } finally {
      connection.release()
    }
  }
}
