import { createHmac } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import { withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'
import { ChatCommandError } from './pilot-chat.js'

export type MeetingState = { mediaOrigin?: string; available: boolean; meeting: { id: string; participantCount: number } | null }
export type MeetingAction = 'read' | 'prepare' | 'joined' | 'heartbeat' | 'leave'
export type MeetingCredentials = { origin: string; domain: string; muc: string; room: string; token: string; expiresAt: string }
export type MeetingResult = MeetingState & { credentials?: MeetingCredentials }
export interface ChatMeetings {
  command(session: YandexActorSessionInput, conversationId: string, action: MeetingAction, meetingId?: string, tabId?: string): Promise<MeetingResult>
}
export type JitsiConfig = { origin: string; domain: string; muc: string; appId: string; secret: string }
export function readJitsiConfig(env: NodeJS.ProcessEnv): JitsiConfig | undefined {
  if (env.JITSI_ENABLED !== 'true') return undefined
  const { JITSI_ORIGIN: origin, JITSI_XMPP_DOMAIN: domain, JITSI_MUC_DOMAIN: muc, JITSI_APP_ID: appId, JITSI_JWT_SECRET: secret } = env
  if (!origin || !domain || !muc || !appId || !secret || secret.length < 32) throw new Error('Incomplete video meeting configuration')
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !/^[a-z0-9.-]+$/i.test(domain) || !/^[a-z0-9.-]+$/i.test(muc)) throw new Error('Invalid video meeting origin or XMPP domain')
  return { origin: url.origin, domain, muc, appId, secret }
}
export function meetingCredentials(config: JitsiConfig, meetingId: string, actorId: string, now = Date.now()): MeetingCredentials {
  const issued = Math.floor(now / 1000)
  const room = `fit-${meetingId}`
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const payload = encode({ iss: config.appId, aud: 'jitsi', sub: config.domain, room, iat: issued, nbf: issued - 5, exp: issued + 300,
    context: { user: { id: createHmac('sha256', config.secret).update(actorId).digest('hex'), name: 'Участник Fit' } } })
  const signature = createHmac('sha256', config.secret).update(`${header}.${payload}`).digest('base64url')
  return { origin: config.origin, domain: config.domain, muc: config.muc, room, token: `${header}.${payload}.${signature}`, expiresAt: new Date((issued + 300) * 1000).toISOString() }
}
export class DatabaseChatMeetings implements ChatMeetings {
  constructor(private readonly pool: DatabasePool, private readonly config: JitsiConfig | undefined) {}
  command(session: YandexActorSessionInput, conversationId: string, action: MeetingAction, meetingId?: string, tabId?: string): Promise<MeetingResult> {
    if (!this.config) return Promise.resolve({ available: false, meeting: null })
    if (typeof session === 'string' || session.accessMode !== 'read_write') throw new ChatCommandError('forbidden')
    const config = this.config
    return withYandexActorSession(this.pool, session, async (client) => {
      try {
        const rows = await client.query<QueryResultRow & { state: MeetingState; actor_id: string }>(
          'select public.chat_meeting_command($1,$2,$3,$4) as state, auth.uid() as actor_id',
          [conversationId, action, meetingId ?? null, tabId ?? null])
        const row = rows[0]
        if (!row) throw new Error('Video meeting command returned no result')
        return { ...row.state, mediaOrigin: config.origin, ...(action === 'prepare' && row.state.meeting
          ? { credentials: meetingCredentials(config, row.state.meeting.id, row.actor_id) } : {}) }
      } catch (error) {
        if (error instanceof Error && error.message === 'chat_blocked') throw new ChatCommandError('blocked')
        if (error instanceof Error && error.message === 'chat_rate_limited') throw new ChatCommandError('rate_limited')
        if (error instanceof Error && error.message === 'chat_forbidden') throw new ChatCommandError('forbidden')
        if (error instanceof Error && error.message === 'chat_message_conflict') throw new ChatCommandError('conflict')
        if (error instanceof Error && error.message === 'chat_message_invalid') throw new ChatCommandError('invalid')
        throw error
      }
    })
  }
}

export type MeetingNotice = { id: string; active: boolean }
export async function readMeetingNotices(client: DatabaseClient, ids: string[]): Promise<Map<string, MeetingNotice>> {
  if (!ids.length) return new Map()
  const rows = await client.query<QueryResultRow & { message_id: string; meeting_id: string; active: boolean }>(`
    select n.message_id,n.meeting_id,m.ended_at is null and exists(
      select 1 from public.chat_meeting_sessions s where s.meeting_id=m.id and s.expires_at>now()
    ) as active from public.chat_meeting_notices n join public.chat_meetings m on m.id=n.meeting_id
    where n.message_id=any($1::uuid[])`, [ids])
  return new Map(rows.map((row) => [row.message_id, { id: row.meeting_id, active: row.active }]))
}
