import { describe, expect, it, vi } from 'vitest'
import { configuredStaffVerifier, DatabaseYandexEmployeeObserver, StaffEmployeeClient } from './staff-employee.js'
import type { DatabaseConnection, DatabasePool } from './db/types.js'

const LOGIN = 'synthetic.person'
const person = { id: 123, yandex: { login_lower: LOGIN }, is_deleted: false,
  official: { affiliation: 'yandex', is_dismissed: false, is_robot: false, is_agent: false } }
const response = (result: unknown[], extra = {}) => new Response(JSON.stringify({ result, has_more: false, ...extra }))

describe('Staff linked external identity', () => {
  it('checks the exact verified external login against active Yandex people in v4', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([person]))
    expect(await new StaffEmployeeClient('synthetic-service-token', fetcher).verifyLogin(' Synthetic.Person ')).toBe(true)
    const input = fetcher.mock.calls[0]?.[0]
    if (typeof input !== 'string') throw new Error('expected_string_url')
    const url = new URL(input)
    expect(url.origin + url.pathname).toBe('https://staff-api.yandex-team.ru/v4/persons')
    expect(url.searchParams.get('_query')).toContain('yandex.login_lower=="synthetic.person"')
    expect(url.searchParams.get('_query')).toContain('official.affiliation=="yandex"')
    expect(url.searchParams.get('_query')).toContain('official.is_dismissed==false')
    expect(url.searchParams.get('_limit')).toBe('2')
    expect(url.href).not.toContain('synthetic-service-token')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', headers: { authorization: 'OAuth synthetic-service-token' } })
  })
  it('treats a successful complete empty search as non-employee', async () => {
    expect(await new StaffEmployeeClient('token', vi.fn().mockResolvedValue(response([]))).verifyLogin(LOGIN)).toBe(false)
  })
  it.each([
    { ...person, is_deleted: true },
    { ...person, official: { ...person.official, is_agent: true } },
    { ...person, official: { ...person.official, is_dismissed: true } },
    { ...person, official: { ...person.official, is_robot: true } },
    { ...person, official: { ...person.official, affiliation: 'external' } },
    { ...person, yandex: { login_lower: 'somebody.else' } },
    { id: 123, yandex: person.yandex, is_deleted: false },
  ])('never accepts missing/contradictory employment evidence %#', async (row) => {
    expect(await new StaffEmployeeClient('token', vi.fn().mockResolvedValue(response([row]))).verifyLogin(LOGIN)).toBeUndefined()
  })
  it.each([response([person, person]), response([person], { has_more: true }), new Response('<html>login</html>'),
    new Response('{"result":[]}'), new Response('private details', { status: 403 }), new Response('private details', { status: 503 })])(
    'keeps ambiguous, unauthorized and malformed results unknown', async (upstream) => {
      expect(await new StaffEmployeeClient('token', vi.fn().mockResolvedValue(upstream)).verifyLogin(LOGIN)).toBeUndefined()
    })
  it('does not expose network exceptions, and rejects query injection without a request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private credential details'))
    const client = new StaffEmployeeClient('token', fetcher)
    expect(await client.verifyLogin('a" or true')).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
    expect(await client.verifyLogin(LOGIN)).toBeUndefined()
  })
  it('is default-off and requires a dedicated configured credential', () => {
    expect(configuredStaffVerifier(undefined, 'token')).toBeUndefined()
    expect(configuredStaffVerifier('false', 'token')).toBeUndefined()
    expect(configuredStaffVerifier('true', ' ')).toBeUndefined()
    expect(configuredStaffVerifier('true', 'synthetic-token')).toBeInstanceOf(StaffEmployeeClient)
  })
})

describe('recording Staff verification', () => {
  const HASH = 'a'.repeat(64)
  function fixture(result: boolean | undefined) {
    const query = vi.fn().mockResolvedValue([])
    const release = vi.fn()
    const connection: DatabaseConnection = { query: query as DatabaseConnection['query'], release }
    const connect = vi.fn().mockResolvedValue(connection)
    const pool: DatabasePool = { connect, end: async () => {} }
    return { query, release, connect, observer: new DatabaseYandexEmployeeObserver(pool,
      { verifyLogin: () => Promise.resolve(result) }, () => new Date('2026-10-27T08:00:00Z')) }
  }
  it.each([true, false])('persists only a definite %s decision, hash and observation time', async (result) => {
    const f = fixture(result)
    await f.observer.observe(HASH, LOGIN)
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining('record_yandex_employee_verification'),
      [HASH, result, '2026-10-27T08:00:00.000Z'])
    expect(JSON.stringify(f.query.mock.calls)).not.toContain(LOGIN)
    expect(f.release).toHaveBeenCalledOnce()
  })
  it('does not overwrite a previous result when Staff is unavailable', async () => {
    const f = fixture(undefined)
    await f.observer.observe(HASH, LOGIN)
    expect(f.connect).not.toHaveBeenCalled()
  })
  it('releases the connection on a database failure', async () => {
    const f = fixture(true)
    f.query.mockRejectedValueOnce(new Error('database failure'))
    await expect(f.observer.observe(HASH, LOGIN)).rejects.toThrow('database failure')
    expect(f.release).toHaveBeenCalledOnce()
  })
})
