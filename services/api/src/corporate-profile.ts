import type { FastifyInstance } from 'fastify'
import { readYandexActorSession, withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'
import { YandexAppSessionInvalidError } from './db/yandex-app-transaction.js'
import type { DatabasePool } from './db/types.js'
import { DatabasePilotTrainerProfiles, readTrainerProfileDraft, TrainerProfileError, type ProfileManagement, type ProfileWriteContext } from './trainer-profile.js'
import { readTrainerPhotoUpload } from './trainer-profile-media.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const record = (value: unknown): Record<string, unknown> | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const version = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0

// Owner metadata never carries a target. Missing metadata stays compatible while
// the independent pilot is off; active pilot writes require CAS on the server.
export function readProfileWriteContext(value: unknown): ProfileWriteContext | null {
  const v = record(value)
  if (!v || [v.version, v.managementVersion, v.commandId].every(x => x === undefined)) return {}
  if (!version(v.version) || !version(v.managementVersion) || typeof v.commandId !== 'string' || !uuid.test(v.commandId)) return null
  return { version: v.version, managementVersion: v.managementVersion, commandId: v.commandId }
}

export class CorporateProfilesStore {
  constructor(private readonly pool: DatabasePool, readonly profiles: DatabasePilotTrainerProfiles) {}
  setManagement(session: YandexActorSessionInput, target: string, managed: boolean, version: number, commandId: string) {
    return withYandexActorSession(this.pool, session, async client => {
      const rows = await client.query<{ management: ProfileManagement }>(
        'select app_private.set_corporate_profile_management($1,$2,$3,$4) management', [target, managed, version, commandId])
      return rows[0]!.management
    })
  }
  history(session: YandexActorSessionInput, target: string, offset: number) {
    return withYandexActorSession(this.pool, session, async client => {
      const rows = await client.query<{ history: unknown[] }>(
        'select app_private.corporate_profile_history($1,$2) history', [target, offset])
      return rows[0]!.history
    })
  }
}

export function registerCorporateProfileRoutes(app: FastifyInstance, store?: CorporateProfilesStore) {
  app.get('/v1/trainer-profile/access', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const session = readYandexActorSession(request.headers)
    if (!session) return reply.code(401).send({ error: 'unauthorized' })
    if (!store) return reply.code(503).send({ error: 'service_unavailable' })
    try { return await store.profiles.management(session) } catch (error) {
      if (error instanceof YandexAppSessionInvalidError) return reply.code(401).send({ error: 'unauthorized' })
      return reply.code(503).send({ error: 'service_unavailable' })
    }
  })
  for (const action of ['read', 'history', 'management', 'command'] as const) {
    app.route({
      method: action === 'read' || action === 'history' ? 'GET' : 'POST',
      url: `/v1/admin/trainers/:trainerId/profile${action === 'read' ? '' : `/${action}`}`,
      bodyLimit: 3 * 1024 * 1024,
      handler: async (request, reply) => {
        reply.header('cache-control', 'no-store')
        const session = readYandexActorSession(request.headers)
        if (!session) return reply.code(401).send({ error: 'unauthorized' })
        if (session.accessMode !== 'read_write') return reply.code(403).send({ error: 'corporate_profile_forbidden' })
        if (!store) return reply.code(503).send({ error: 'service_unavailable' })
        try {
          const { trainerId } = request.params as { trainerId?: unknown }
          if (typeof trainerId !== 'string' || !uuid.test(trainerId)) return reply.code(422).send({ error: 'corporate_profile_invalid' })
          // Check target, membership and capability before validating profile content.
          const current = await store.profiles.getAdmin(session, trainerId)
          if (action === 'read') return current
          if (action === 'history') {
            const { offset } = request.query as { offset?: string }
            const start = offset === undefined ? 0 : Number(offset)
            if (!version(start)) return reply.code(422).send({ error: 'corporate_profile_invalid' })
            return { entries: await store.history(session, trainerId, start) }
          }
          const body = record(request.body)
          if (action === 'management') {
            if (!body || typeof body.managed !== 'boolean' || !version(body.version) || typeof body.commandId !== 'string' || !uuid.test(body.commandId)) {
              return reply.code(422).send({ error: 'corporate_profile_invalid' })
            }
            return await store.setManagement(session, trainerId, body.managed, body.version, body.commandId)
          }
          const metadata = readProfileWriteContext(body)
          if (!body || !metadata || !metadata.commandId) return reply.code(422).send({ error: 'corporate_profile_invalid' })
          const context = { ...metadata, adminTarget: trainerId }
          const profiles = store.profiles
          const invalid = () => reply.code(422).send({ error: 'corporate_profile_invalid' })
          if (body.action === 'save' || body.action === 'upload') {
            const draft = readTrainerProfileDraft(body.draft)
            if (!draft) return invalid()
            if (body.action === 'save') return await profiles.saveDraft(session, draft, context)
            const photo = readTrainerPhotoUpload(body.photo)
            if (!photo || (body.replaceLegacy !== undefined && typeof body.replaceLegacy !== 'boolean')) return invalid()
            return await profiles.uploadPhoto(session, draft, photo, body.replaceLegacy === true, context)
          }
          if (body.action === 'reorder') {
            const ids = body.photoIds
            if (!Array.isArray(ids) || ids.length > 3 || !ids.every(id => typeof id === 'string' && uuid.test(id))) return invalid()
            return await profiles.reorderPhotos(session, ids.map(id => String(id)), context)
          }
          if (body.action === 'delete') {
            if (typeof body.photoId !== 'string' || !uuid.test(body.photoId)) return invalid()
            return await profiles.deletePhoto(session, body.photoId, context)
          }
          if (body.action === 'publish') return await profiles.publish(session, context)
          if (body.action === 'unpublish') return await profiles.unpublish(session, context)
          if (body.action === 'catalog' && typeof body.listed === 'boolean') return await profiles.setCatalogListing(session, body.listed, context)
          return invalid()
        } catch (error) {
          if (error instanceof YandexAppSessionInvalidError) return reply.code(401).send({ error: 'unauthorized' })
          const failure = record(error)
          if (typeof failure?.code === 'string' && ['PT403','PT409','PT422'].includes(failure.code)) {
            return reply.code(Number(failure.code.slice(2))).send({ error: failure.code === 'PT403' ? 'corporate_profile_forbidden' : failure.code === 'PT409' ? 'corporate_profile_conflict' : 'corporate_profile_invalid' })
          }
          if (error instanceof TrainerProfileError) {
            const status = error.failure === 'not_found' ? 404 : error.failure === 'forbidden' || error.failure === 'managed' ? 403 : error.failure === 'conflict' || error.failure === 'refresh_required' ? 409 : error.failure === 'media_unavailable' ? 503 : 422
            return reply.code(status).send({ error: `trainer_profile_${error.failure}` })
          }
          request.log.warn({ event: 'corporate_profile_request_failed' }, 'Corporate profile request failed')
          return reply.code(503).send({ error: 'service_unavailable' })
        }
      },
    })
  }
}
