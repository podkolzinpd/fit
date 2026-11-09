import type { FastifyInstance } from 'fastify'
import type { DatabasePool } from './db/types.js'
import { YandexAppSessionDeniedError, YandexAppSessionInvalidError } from './db/yandex-app-transaction.js'
import { PilotSessionInvalidError } from './db/yandex-pilot-transaction.js'
import { readYandexActorSession, withYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'
import { readTrainerDisplayNames } from './trainer-display-name.js'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
interface Offer { source: 'link' | 'code' | 'chat'; locator: string }
interface Confirmation extends Offer { shareHistory?: boolean; shareSoloHistory?: boolean; expectedRelationshipId: string | null; offerVersion: string; operationId: string }
interface Preview {
  clientId: string; currentRelationshipId: string | null
  currentTrainer: { id: string; name: string } | null
  trainer: { id: string; name: string }; offerVersion: string
}
function readOffer(body: unknown): Offer | null {
  if (typeof body !== 'object' || body === null) return null
  const v = body as Record<string, unknown>
  if (typeof v.locator !== 'string') return null
  if (v.source === 'link' && /^[A-F0-9]{12}\.[0-9a-f]{64}$/.test(v.locator)) return { source: v.source, locator: v.locator }
  if (v.source === 'code' && /^[A-F0-9]{12}$/.test(v.locator)) return { source: v.source, locator: v.locator }
  if (v.source === 'chat' && uuid.test(v.locator)) return { source: v.source, locator: v.locator }
  return null
}
function readConfirmation(body: unknown): Confirmation | null {
  const offer = readOffer(body)
  if (!offer) return null
  const v = body as Record<string, unknown>
  if (!(v.expectedRelationshipId === null || typeof v.expectedRelationshipId === 'string' && uuid.test(v.expectedRelationshipId))
    || typeof v.offerVersion !== 'string' || !v.offerVersion || v.offerVersion.length > 100
    || typeof v.operationId !== 'string' || !uuid.test(v.operationId)) return null
  if (v.shareHistory !== undefined && typeof v.shareHistory !== 'boolean') return null
  if (v.shareSoloHistory !== undefined && typeof v.shareSoloHistory !== 'boolean') return null
  return { ...offer, ...(v.shareSoloHistory === undefined ? {} : { shareSoloHistory: v.shareSoloHistory }), ...(v.shareHistory === undefined ? {} : { shareHistory: v.shareHistory }), expectedRelationshipId: v.expectedRelationshipId, offerVersion: v.offerVersion, operationId: v.operationId }
}
export class TrainerConnectionConfirmationStore {
  constructor(private readonly pool: DatabasePool) {}
  preview(session: YandexActorSession, offer: Offer): Promise<Preview> {
    return withYandexActorSession(this.pool, session, async client => {
      const row = (await client.query<{ preview: Preview }>('select app_private.preview_trainer_connection($1,$2) preview', [offer.source, offer.locator]))[0]!
      const preview = row.preview
      const trainers = [preview.trainer, ...(preview.currentTrainer ? [preview.currentTrainer] : [])]
      const names = await readTrainerDisplayNames(client, trainers.map(t => ({ trainerId: t.id, accountName: t.name })))
      return { ...preview, trainer: { ...preview.trainer, name: names.get(preview.trainer.id)! },
        currentTrainer: preview.currentTrainer ? { ...preview.currentTrainer, name: names.get(preview.currentTrainer.id)! } : null }
    })
  }
  confirm(session: YandexActorSession, draft: Confirmation): Promise<string> {
    return withYandexActorSession(this.pool, session, async client =>
      (await client.query<{ client_id: string }>('select app_private.confirm_trainer_connection($1,$2,$3,$4,$5,$6,$7) client_id',
        [draft.source, draft.locator, draft.expectedRelationshipId, draft.offerVersion, draft.operationId, draft.shareHistory ?? false, draft.shareSoloHistory ?? false]))[0]!.client_id)
  }
}
export type TrainerConnectionConfirmationService = Pick<TrainerConnectionConfirmationStore, 'preview' | 'confirm'>
export function registerTrainerConnectionConfirmationRoutes(app: FastifyInstance, store?: TrainerConnectionConfirmationService) {
  for (const action of ['preview', 'confirm'] as const) {
    app.post(`/v1/trainer-connections/${action}`, { bodyLimit: 4096 }, async (request, reply) => {
      reply.header('cache-control', 'no-store')
      const session = readYandexActorSession(request.headers)
      if (!session) return reply.code(401).send({ error: 'unauthorized' })
      if (session.accessMode !== 'read_write') return reply.code(403).send({ error: 'read_write_session_required' })
      const offer = readOffer(request.body)
      const draft = readConfirmation(request.body)
      if (!offer || action === 'confirm' && !draft) return reply.code(400).send({ error: 'invalid_request' })
      if (!store) return reply.code(503).send({ error: 'service_unavailable' })
      try {
        if (action === 'preview') return reply.send({ preview: await store.preview(session, offer) })
        return reply.send({ clientId: await store.confirm(session, draft!) })
      } catch (error) {
        if (error instanceof YandexAppSessionInvalidError || error instanceof PilotSessionInvalidError) return reply.code(401).send({ error: 'unauthorized' })
        if (error instanceof YandexAppSessionDeniedError) return reply.code(403).send({ error: 'connection_forbidden' })
        const message = error instanceof Error ? error.message : ''
        if (message === 'connection_forbidden') return reply.code(403).send({ error: message })
        if (message === 'connection_changed' || message === 'connection_offer_unavailable') return reply.code(409).send({ error: message })
        if (/^client_merge_.*_conflict$/.test(message)) return reply.code(409).send({ error: 'client_merge_conflict' })
        // Never log request bodies, invitation secrets, or raw database errors.
        request.log.warn({ event: 'trainer_connection_confirmation_failed' }, 'Trainer connection confirmation failed')
        return reply.code(503).send({ error: 'service_unavailable' })
      }
    })
  }
}
