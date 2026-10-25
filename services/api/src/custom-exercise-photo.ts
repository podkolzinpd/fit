import { createHash } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import type { ChatImageUpload } from './chat-media.js'
import { storedCustomExercisePhoto, type CustomExercisePhoto, type CustomExercisePhotoColumns } from './custom-exercise-media.js'
import type { DatabasePool } from './db/types.js'
import type { CustomExerciseDraft, InputKind, MuscleGroup } from './domain-request.js'
import type { MediaObjectStorage } from './object-storage-media.js'
import type { PilotCustomExercise } from './training-data.js'
import { withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'

export class CustomExercisePhotoError extends Error {
  constructor(readonly failure: 'forbidden' | 'not_found' | 'conflict' | 'unavailable') {
    super(`Custom exercise photo: ${failure}`)
    this.name = 'CustomExercisePhotoError'
  }
}
type PhotoExercise = PilotCustomExercise & { createdBy: string; image: CustomExercisePhoto }
export interface PilotCustomExercisePhotos {
  create(session: YandexActorSessionInput, id: string, draft: CustomExerciseDraft, image: ChatImageUpload): Promise<PhotoExercise>
  sign(session: YandexActorSessionInput, id: string): Promise<{ url: string }>
}
interface ExerciseRow extends QueryResultRow, CustomExercisePhotoColumns {
  id: string; created_by: string; name: string; muscle_group: MuscleGroup; input_kind: InputKind
  primary_muscle_detail: string | null; equipment: string | null; description: string | null
  archived_at: Date | null; version: string
}
const columns = `id, created_by, name, muscle_group, input_kind, primary_muscle_detail, equipment, description,
  archived_at, version, image_path, image_mime_type, image_width, image_height, image_size_bytes, image_sha256`
function expose(row: ExerciseRow): PhotoExercise {
  const image = storedCustomExercisePhoto(row)
  if (!image) throw new CustomExercisePhotoError('not_found')
  const version = Number(row.version)
  if (!Number.isSafeInteger(version) || version < 1) throw new CustomExercisePhotoError('unavailable')
  return { id: row.id, createdBy: row.created_by, name: row.name, muscleGroup: row.muscle_group, inputKind: row.input_kind,
    primaryMuscleDetail: row.primary_muscle_detail, equipment: row.equipment, description: row.description,
    archivedAt: row.archived_at?.toISOString() ?? null, version,
    image }
}
function matches(row: ExerciseRow, draft: CustomExerciseDraft, photo: CustomExercisePhoto) {
  return row.archived_at === null && row.name === draft.name.trim() && row.muscle_group === draft.muscleGroup
    && row.input_kind === draft.inputKind && row.primary_muscle_detail === (draft.primaryMuscleDetail?.trim() || null)
    && row.equipment === (draft.equipment?.trim() || null) && row.description === (draft.description?.trim() || null)
    && row.image_path === photo.path && row.image_mime_type === photo.mimeType && row.image_width === photo.width
    && row.image_height === photo.height && row.image_size_bytes === photo.sizeBytes && row.image_sha256 === photo.sha256
}

export class DatabasePilotCustomExercisePhotos implements PilotCustomExercisePhotos {
  constructor(private readonly pool: DatabasePool, private readonly media: MediaObjectStorage) {}

  async create(session: YandexActorSessionInput, requestedId: string, draft: CustomExerciseDraft, image: ChatImageUpload) {
    const id = requestedId.toLowerCase()
    // Establish a real, active actor before accepting any object upload.
    const context = await withYandexActorSession(this.pool, session, async client => {
      const actors = await client.query<{ id: string }>(`select profile.id from public.profiles profile
        where profile.id = auth.uid() and (profile.account_role = 'trainer'
          or (profile.account_role = 'client' and exists (select 1 from public.clients client
            where client.auth_user_id = profile.id and client.archived_at is null and client.merged_into_client_id is null)))`)
      if (!actors[0]) throw new CustomExercisePhotoError('forbidden')
      const rows = await client.query<ExerciseRow>(`select ${columns} from public.custom_exercises where id = $1`, [id])
      return { actorId: actors[0].id, existing: rows[0] }
    })
    const sha256 = createHash('sha256').update(image.bytes).digest('hex')
    const photo: CustomExercisePhoto = { path: `${context.actorId}/${id}/${sha256}.jpg`,
      mimeType: image.mimeType, width: image.width, height: image.height, sizeBytes: image.sizeBytes,
      sha256 }
    if (context.existing) {
      if (context.existing.created_by !== context.actorId) throw new CustomExercisePhotoError('forbidden')
      if (!matches(context.existing, draft, photo)) throw new CustomExercisePhotoError('conflict')
      return expose(context.existing)
    }
    try { await this.media.write('custom-exercise-media', photo.path, image.bytes, image.mimeType, false) }
    catch { throw new CustomExercisePhotoError('unavailable') }
    // Never delete here: an interrupted COMMIT may already reference this object.
    // Stable UUID/path and the SQL lock reconcile both concurrent and lost replies.
    return withYandexActorSession(this.pool, session, async client => {
      try {
        const rows = await client.query<ExerciseRow>(`select ${columns} from public.create_custom_exercise_with_photo($1, $2::jsonb, $3::jsonb)`, [id, JSON.stringify(draft), JSON.stringify(photo)])
        if (!rows[0]) throw new CustomExercisePhotoError('unavailable')
        return expose(rows[0])
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (message === 'custom_exercise_forbidden') throw new CustomExercisePhotoError('forbidden')
        if (message === 'custom_exercise_conflict') throw new CustomExercisePhotoError('conflict')
        throw error
      }
    })
  }

  async sign(session: YandexActorSessionInput, id: string) {
    const row = await withYandexActorSession(this.pool, session, async client => {
      const rows = await client.query<ExerciseRow>(`select ${columns} from public.custom_exercises where id = $1`, [id])
      if (!rows[0]) throw new CustomExercisePhotoError('not_found')
      return expose(rows[0])
    }, 'read-only-snapshot')
    try {
      const stored = await this.media.stat('custom-exercise-media', row.image.path)
      if (!stored) throw new CustomExercisePhotoError('not_found')
      if (stored.sizeBytes !== row.image.sizeBytes || stored.sha256 !== row.image.sha256) throw new CustomExercisePhotoError('unavailable')
      return { url: await this.media.sign('custom-exercise-media', row.image.path) }
    } catch (error) {
      if (error instanceof CustomExercisePhotoError) throw error
      throw new CustomExercisePhotoError('unavailable')
    }
  }
}
