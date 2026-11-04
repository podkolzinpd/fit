import { createHash } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import type { DatabasePool } from './db/types.js'
import type { MediaObjectStorage } from './object-storage-media.js'
import { readChatImageUpload, type ChatImageUpload } from './chat-media.js'
import { withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'

export class ClientProfilePhotoError extends Error {
  constructor(readonly failure: 'forbidden' | 'conflict' | 'unavailable') { super(failure) }
}
export function readClientPhotoUpload(value: unknown) {
  const image = readChatImageUpload(value)
  return image && image.sizeBytes <= 160_000 && image.width <= 960 && image.height <= 960
    && image.bytes[0] === 0xff && image.bytes[1] === 0xd8 && image.bytes[2] === 0xff ? image : undefined
}
interface StoredPhoto { path: string; sha256: string; sizeBytes: number; version: number }
interface PhotoRow extends QueryResultRow { profile_photo: StoredPhoto | null }
export interface ClientProfilePhoto { url: string | null; version: number }
export interface PilotClientPhotos {
  read(session: YandexActorSessionInput, id: string): Promise<ClientProfilePhoto>
  upload(session: YandexActorSessionInput, id: string, version: number, image: ChatImageUpload): Promise<ClientProfilePhoto>
}
export class DatabasePilotClientPhotos implements PilotClientPhotos {
  constructor(private readonly pool: DatabasePool, private readonly media: MediaObjectStorage) {}
  private async current(session: YandexActorSessionInput, id: string, write = false) {
    return withYandexActorSession(this.pool, session, async client => {
      // Migration149's granted can_access_client wrapper checks ownership OR an
      // active trainer connection. The internal connection helper is not granted
      // to fit_api; a non-owner trainer must pass the granted wrapper instead.
      const rows = await client.query<PhotoRow>(`select profile_photo from public.clients where id=$1
        and merged_into_client_id is null
        and ($2::boolean=false or (archived_at is null
          and public.can_access_client(id)
          and exists(select 1 from public.profiles where id=auth.uid()
            and ((account_role='client' and clients.auth_user_id=auth.uid())
              or (account_role='trainer' and clients.auth_user_id is distinct from auth.uid()
                and public.can_access_client(clients.id))))))`, [id, write])
      if (!rows[0]) throw new ClientProfilePhotoError('forbidden')
      return rows[0].profile_photo
    }, 'read-only-snapshot')
  }
  private async expose(photo: StoredPhoto | null): Promise<ClientProfilePhoto> {
    if (!photo) return { url: null, version: 0 }
    const stored = await this.media.stat('client-profile-media', photo.path)
    if (!stored || stored.sizeBytes !== photo.sizeBytes || stored.sha256 !== photo.sha256) throw new ClientProfilePhotoError('unavailable')
    return { url: await this.media.sign('client-profile-media', photo.path), version: photo.version }
  }
  async read(session: YandexActorSessionInput, id: string) { return this.expose(await this.current(session, id)) }
  async upload(session: YandexActorSessionInput, id: string, version: number, image: ChatImageUpload) {
    const previous = await this.current(session, id, true)
    const sha256 = createHash('sha256').update(image.bytes).digest('hex')
    if (previous?.sha256 === sha256) return this.expose(previous)
    if ((previous?.version ?? 0) !== version) throw new ClientProfilePhotoError('conflict')
    const photo = { path: `${id}/${sha256}.jpg`, sha256, sizeBytes: image.sizeBytes }
    await this.media.write('client-profile-media', photo.path, image.bytes, image.mimeType, false)
    // A lost COMMIT reply may already reference the file: never delete it here.
    const saved = await withYandexActorSession(this.pool, session, async client => {
      try {
        const rows = await client.query<PhotoRow>('select public.save_client_profile_photo($1,$2::jsonb,$3) as profile_photo', [id, JSON.stringify(photo), version])
        if (!rows[0]?.profile_photo) throw new ClientProfilePhotoError('unavailable')
        return rows[0].profile_photo
      } catch (error) {
        if (error instanceof Error && error.message === 'client_conflict') throw new ClientProfilePhotoError('conflict')
        if (error instanceof Error && error.message === 'client_forbidden') throw new ClientProfilePhotoError('forbidden')
        throw error
      }
    })
    return this.expose(saved)
  }
}
