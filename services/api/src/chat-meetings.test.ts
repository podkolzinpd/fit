import { createHmac, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.js'
import { ChatCommandError } from './pilot-chat.js'
import { DatabaseChatMeetings, meetingCredentials, readJitsiConfig, type ChatMeetings } from './chat-meetings.js'
import type { DatabasePool } from './db/types.js'

const config = { origin: 'https://video.example.test', domain: 'meet.jitsi', muc: 'muc.meet.jitsi', appId: 'fit', secret: 'test-only-secret-'.repeat(3) }
describe('video meeting credentials and feature configuration', () => {
  it('binds a short-lived credential to one room and a pseudonymous participant', () => {
    const actor = randomUUID(), meeting = randomUUID(), now = 1_800_000_000_000
    const credentials = meetingCredentials(config, meeting, actor, now)
    const [header, payload, signature] = credentials.token.split('.')
    const claims: Record<string, unknown> = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as Record<string, unknown>
    expect(claims).toMatchObject({ aud: 'jitsi', sub: 'meet.jitsi', room: `fit-${meeting}`, exp: now / 1000 + 300 })
    expect(signature).toBe(createHmac('sha256', config.secret).update(`${header}.${payload}`).digest('base64url'))
    expect(JSON.stringify(claims)).not.toContain(actor)
    expect(JSON.stringify(credentials)).not.toContain(config.secret)
  })
  it('defaults off and refuses partial, non-HTTPS or credential-bearing configuration', () => {
    expect(readJitsiConfig({})).toBeUndefined()
    expect(() => readJitsiConfig({ JITSI_ENABLED: 'true' })).toThrow('Incomplete')
    const env = { JITSI_ENABLED:'true', JITSI_ORIGIN:config.origin, JITSI_XMPP_DOMAIN:config.domain, JITSI_MUC_DOMAIN:config.muc, JITSI_APP_ID:config.appId, JITSI_JWT_SECRET:config.secret }
    expect(readJitsiConfig(env)).toEqual(config)
    for (const origin of ['http://video.example.test', 'https://user:pass@video.example.test', 'https://video.example.test/path', 'https://video.example.test?jwt=hidden']) {
      expect(() => readJitsiConfig({ ...env, JITSI_ORIGIN:origin })).toThrow()
    }
    const connect=vi.fn()
    const pool = { connect, end:vi.fn() } as unknown as DatabasePool
    expect(() => new DatabaseChatMeetings(pool,config).command('legacy-read-only',randomUUID(),'prepare')).toThrow(ChatCommandError)
    expect(connect).not.toHaveBeenCalled()
  })
})
describe('video meeting HTTP boundary', () => {
  it('requires app auth, validates commands and keeps credentials out of caches', async () => {
    const conversation = randomUUID(), tab = randomUUID(), meeting = randomUUID()
    const command = vi.fn<ChatMeetings['command']>().mockResolvedValue({ available:true, meeting:{ id:meeting,participantCount:0 }, credentials:meetingCredentials(config,meeting,randomUUID()) })
    const app = buildApp({ logger:false, chatMeetings:{ command } })
    try {
      const url = `/v1/chat/conversations/${conversation}/meeting`
      expect((await app.inject({ method:'POST',url,payload:{ action:'prepare',tabId:tab } })).statusCode).toBe(401)
      expect((await app.inject({ method:'POST',url,headers:{ 'x-fit-session':'test-session' },payload:{ action:'joined',tabId:tab } })).statusCode).toBe(422)
      expect(command).not.toHaveBeenCalled()
      const response = await app.inject({ method:'POST',url,headers:{ 'x-fit-session':'test-session' },payload:{ action:'prepare',tabId:tab } })
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(command).toHaveBeenCalledWith({ accessMode:'read_write',token:'test-session' },conversation,'prepare',undefined,tab)
      command.mockRejectedValueOnce(new ChatCommandError('forbidden'))
      expect((await app.inject({ method:'POST',url,headers:{ 'x-fit-session':'test-session' },payload:{ action:'joined',tabId:tab,meetingId:meeting } })).statusCode).toBe(403)
    } finally { await app.close() }
  })
})
