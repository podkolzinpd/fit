import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { DatabasePool } from './db/types.js'
import { readYandexActorSession, withYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'
import { YandexAppSessionDeniedError, YandexAppSessionInvalidError } from './db/yandex-app-transaction.js'
import { PilotSessionInvalidError } from './db/yandex-pilot-transaction.js'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const actions = ['self', 'rotate', 'list', 'status', 'resolve', 'preview', 'send', 'accept', 'decline', 'cancel'] as const
type Action = typeof actions[number]
interface Command { action: Action; data: Record<string, unknown> }
export function emailHash(value: string): string | undefined {
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined
  return createHash('sha256').update(email, 'utf8').digest('hex')
}
export function readDirectoryCommand(body: unknown): Command | undefined {
  if (!body || typeof body !== 'object') return undefined
  const v = body as Record<string, unknown>
  if (!actions.includes(v.action as Action)) return undefined
  const action = v.action as Action
  if (['self', 'rotate', 'list'].includes(action)) return { action, data: {} }
  if (action === 'resolve') {
    if (typeof v.value !== 'string') return undefined
    const value = v.kind === 'email' ? emailHash(v.value) : v.kind === 'code' && /^[A-F0-9]{16}$/.test(v.value.trim().toUpperCase()) ? v.value.trim().toUpperCase() : undefined
    return value ? { action, data: { kind: v.kind, value } } : undefined
  }
  const key = ['preview', 'send'].includes(action) ? 'peerId' : 'requestId'
  if (typeof v[key] !== 'string' || !uuid.test(v[key])) return undefined
  const data: Record<string, unknown> = { [key]: v[key] }
  if (action === 'send' || action === 'accept') {
    if (!(v.expectedRelationshipId === null || typeof v.expectedRelationshipId === 'string' && uuid.test(v.expectedRelationshipId))) return undefined
    if (!(v.expectedRevision === null || typeof v.expectedRevision === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v.expectedRevision) && Number.isFinite(Date.parse(v.expectedRevision)))) return undefined
    data.expectedRelationshipId = v.expectedRelationshipId
    data.expectedRevision = v.expectedRevision
  }
  return { action, data }
}
export class ConnectionDirectoryStore {
  constructor(private readonly pool: DatabasePool) {}
  async execute(session: YandexActorSession, command: Command): Promise<unknown> {
    return withYandexActorSession(this.pool, session, async db =>
      (await db.query<{ result: unknown }>('select app_private.connection_directory($1,$2::jsonb) result', [command.action, JSON.stringify(command.data)]))[0]!.result)
  }
}
export class ConnectionEmailObserver {
  constructor(private readonly pool: DatabasePool) {}
  async observe(subjectHash: string, emails: string[]): Promise<void> {
    const hashes = [...new Set(emails.map(emailHash).filter((x): x is string => !!x))].slice(0, 10)
    const db = await this.pool.connect()
    try { await db.query('select app_private.observe_connection_emails($1,$2)', [subjectHash, hashes]) }
    finally { db.release() }
  }
}
export function registerConnectionDirectory(app: FastifyInstance, store?: Pick<ConnectionDirectoryStore, 'execute'>) {
  app.post('/v1/connection-directory', { bodyLimit: 2048 }, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const session = readYandexActorSession(request.headers)
    if (!session) return reply.code(401).send({ error: 'unauthorized' })
    if (session.accessMode !== 'read_write') return reply.code(403).send({ error: 'read_write_session_required' })
    const command = readDirectoryCommand(request.body)
    if (!command) return reply.code(400).send({ error: 'invalid_request' })
    if (!store) return reply.code(503).send({ error: 'service_unavailable' })
    try { return reply.send({ result: await store.execute(session, command) }) }
    catch (error) {
      if (error instanceof YandexAppSessionInvalidError || error instanceof PilotSessionInvalidError) return reply.code(401).send({ error: 'unauthorized' })
      if (error instanceof YandexAppSessionDeniedError) return reply.code(403).send({ error: 'connection_forbidden' })
      const message = error instanceof Error ? error.message : ''
      if (message === 'connection_forbidden') return reply.code(403).send({ error: message })
      if (message === 'connection_rate_limited') return reply.code(429).send({ error: message })
      if (['connection_changed', 'connection_offer_unavailable', 'connection_card_missing'].includes(message)) return reply.code(409).send({ error: message })
      request.log.warn({ event: 'connection_directory_failed', action: command.action }, 'Connection directory failed')
      return reply.code(503).send({ error: 'service_unavailable' })
    }
  })
}
