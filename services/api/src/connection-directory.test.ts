import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { emailHash, readDirectoryCommand, registerConnectionDirectory } from './connection-directory.js'
import { YandexIdentityClient } from './auth/yandex-identity.js'

describe('connection discovery boundary', () => {
  it('hashes exact normalized mailbox without guessing aliases or domains', () => {
    expect(emailHash(' Person@EXAMPLE.TEST ')).toBe(emailHash('person@example.test'))
    expect(emailHash('person.name@yandex.ru')).not.toBe(emailHash('person-name@yandex.ru'))
    expect(emailHash('person@yandex.ru')).not.toBe(emailHash('person@ya.ru'))
    expect(readDirectoryCommand({ action: 'resolve', kind: 'email', value: 'bad' })).toBeUndefined()
    expect(readDirectoryCommand({ action: 'resolve', kind: 'email', value: 'person@example.test' })?.data.value).toBe(emailHash('person@example.test'))
    expect(readDirectoryCommand({ action: 'accept', requestId: 'bad', expectedRelationshipId: null })).toBeUndefined()
  })
  it('validates private registration invitations separately from personal locators', () => {
    const code = 'A'.repeat(32)
    expect(readDirectoryCommand({ action: 'create_invitation' })).toEqual({ action: 'create_invitation', data: {} })
    expect(readDirectoryCommand({ action: 'resolve', kind: 'code', value: code })?.data.value).toBe(code)
    expect(readDirectoryCommand({ action: 'revoke_invitation', code })?.data.code).toBe(code)
    expect(readDirectoryCommand({ action: 'revoke_invitation', code: 'A'.repeat(16) })).toBeUndefined()
    const draft = { action: 'send', peerId: '10000000-0000-4000-8000-000000000001', invitationCode: code, expectedRelationshipId: null, expectedRevision: null }
    expect(readDirectoryCommand(draft)?.data.invitationCode).toBe(code)
    expect(readDirectoryCommand({ ...draft, invitationCode: 'bad' })).toBeUndefined()
  })
  it('does not invoke provider-email observation before validating OAuth application', async () => {
    const observe = vi.fn().mockResolvedValue(undefined)
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'test', psuid: 'test', login: 'test', client_id: 'wrong', emails: ['person@example.test'] })))
    const provider = new YandexIdentityClient({ expectedClientId: 'fit', connectionEmailObserver: { observe }, fetchImplementation })
    await expect(provider.verifyAccessToken('synthetic')).rejects.toThrow()
    expect(observe).not.toHaveBeenCalled()
    fetchImplementation.mockResolvedValue(new Response(JSON.stringify({ id: 'test', psuid: 'test', login: 'test', client_id: 'fit', emails: ['person@example.test'], default_email: 'unrelated@example.test' })))
    await provider.verifyAccessToken('synthetic')
    expect(observe).toHaveBeenCalledWith(expect.any(String), ['person@example.test'])
  })
  it('requires a single write session, bounds inputs, and never forwards raw errors', async () => {
    const app = Fastify()
    const execute = vi.fn().mockRejectedValue(new Error('synthetic-secret'))
    registerConnectionDirectory(app, { execute })
    const payload = { action: 'self' }
    expect((await app.inject({ method: 'POST', url: '/v1/connection-directory', payload })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/v1/connection-directory', headers: { 'x-fit-pilot-session': 's' }, payload })).statusCode).toBe(403)
    const failed = await app.inject({ method: 'POST', url: '/v1/connection-directory', headers: { 'x-fit-session': 's' }, payload })
    expect(failed.statusCode).toBe(503)
    expect(failed.body).not.toContain('synthetic-secret')
    execute.mockRejectedValueOnce(new Error('connection_changed'))
    expect((await app.inject({ method: 'POST', url: '/v1/connection-directory', headers: { 'x-fit-session': 's' }, payload })).statusCode).toBe(409)
    execute.mockRejectedValueOnce(new Error('connection_invalid'))
    const invalid = await app.inject({ method: 'POST', url: '/v1/connection-directory', headers: { 'x-fit-session': 's' }, payload })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toEqual({ error: 'connection_invalid' })
    await app.close()
  })
})
