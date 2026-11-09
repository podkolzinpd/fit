import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

export { expect }
export type { Page, BrowserContext, Locator, CDPSession, TestInfo } from '@playwright/test'

let fixtureOrigin: string | undefined
const attachedContexts = new WeakSet<BrowserContext>()

async function fixtureRequest(path: string, body: object): Promise<Response> {
  if (fixtureOrigin === undefined) throw new Error('Native fixture must run through the native test fixture')
  const response = await fetch(`${fixtureOrigin}/__fixtures/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Native fixture ${path} failed (${response.status}): ${await response.text()}`)
  return response
}

async function attachNativeApi(context: BrowserContext): Promise<void> {
  if (attachedContexts.has(context)) return
  attachedContexts.add(context)
  await context.route(/^http:\/\/127\.0\.0\.1:4100\//, async route => {
    if (fixtureOrigin === undefined) throw new Error('Native fixture is unavailable')
    const url = new URL(route.request().url())
    await route.continue({ url: `${fixtureOrigin}${url.pathname}${url.search}` })
  })
}

export const test = base.extend<{ nativeIsolation: void }, { nativeApi: string }>({
  nativeApi: [async ({ playwright }, provide, workerInfo) => {
    void playwright
    const child = spawn(process.execPath, [fileURLToPath(new URL('native-api-harness.mjs', import.meta.url))], {
      env: { ...process.env, FIT_E2E_FRONTEND_URL: String(workerInfo.project.use.baseURL) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-3000) })
    let startupTimeout: ReturnType<typeof setTimeout> | undefined
    const ready = new Promise<string>((resolve, reject) => {
      startupTimeout = setTimeout(() => reject(new Error('Native fixture startup timed out')), 110_000)
      let output = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        output += chunk
        const line = output.split('\n').find(value => value.startsWith('{"event":"native_fixture_ready"'))
        if (line !== undefined) {
          const value: unknown = JSON.parse(line)
          if (typeof value === 'object' && value !== null && 'origin' in value && typeof value.origin === 'string') resolve(value.origin)
        }
      })
      child.once('error', reject)
      child.once('exit', code => reject(new Error(`Native fixture exited (${code}): ${stderr}`)))
    })
    try {
      fixtureOrigin = await ready
      clearTimeout(startupTimeout)
      await provide(fixtureOrigin)
    } finally {
      clearTimeout(startupTimeout)
      fixtureOrigin = undefined
      if (child.exitCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGTERM')
        await exited
      }
    }
  }, { scope: 'worker', timeout: 120_000 }],
  nativeIsolation: [async ({ nativeApi, context }, use) => {
    fixtureOrigin = nativeApi
    await fixtureRequest('reset', {})
    await use()
    await Promise.all(context.pages().map(page => page.unrouteAll({ behavior: 'wait' })))
    await context.unrouteAll({ behavior: 'wait' })
    await context.close()
  }, { auto: true }],
})

export async function nativeSignIn(page: Page, key = 'trainer', role: 'trainer' | 'client' = key.includes('client') ? 'client' : 'trainer', firstName?: string): Promise<void> {
  await attachNativeApi(page.context())
  const fixtureKey = key === 'trainer@fit.local' ? 'trainer' : key === 'client@fit.local' ? 'client' : key
  const value: unknown = await (await fixtureRequest('session', { key: fixtureKey, role, firstName })).json()
  if (typeof value !== 'object' || value === null || !('token' in value) || typeof value.token !== 'string' || !('expiresAt' in value) || typeof value.expiresAt !== 'string') throw new Error('Invalid native fixture session')
  const session = { token: value.token, expiresAt: value.expiresAt }
  // Reuse the current app origin for storage. Routing disables browser caching,
  // so loading /auth twice repeats the whole Vite module graph.
  // A fresh page only needs a committed app document before storage is available.
  const appOrigin = new URL(String(test.info().project.use.baseURL)).origin
  if (new URL(page.url()).origin !== appOrigin) {
    await page.goto('/auth', { waitUntil: 'commit' })
  }
  await page.evaluate(session => localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify(session)), session)
  await page.goto('/auth')
}

export async function nativeRegister(page: Page, values: { key: string; firstName: string; role?: 'trainer' | 'client' }): Promise<void> {
  await nativeSignIn(page, values.key, values.role ?? 'trainer', values.firstName)
}

/** Real actor-scoped API calls for fixture setup and persistence assertions. */
export async function nativeRequest(page: Page, path: string, options: { method?: string; body?: object } = {}): Promise<Response> {
  if (fixtureOrigin === undefined || !path.startsWith('/v1/')) throw new Error('Invalid native fixture request')
  const token = await page.evaluate(() => {
    const value: unknown = JSON.parse(localStorage.getItem('fit.yandexAppSession.v1') ?? 'null')
    if (typeof value !== 'object' || value === null || !('token' in value) || typeof value.token !== 'string') throw new Error('Missing native fixture session')
    return value.token
  })
  return fetch(`${fixtureOrigin}${path}`, { method: options.method ?? 'GET', headers: { 'x-fit-session': token, 'content-type': 'application/json' }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) })
}

export async function nativeRouteFetch(route: import('@playwright/test').Route) {
  if (fixtureOrigin === undefined) throw new Error('Native fixture is unavailable')
  const url = new URL(route.request().url())
  return route.fetch({ url: `${fixtureOrigin}${url.pathname}${url.search}` })
}

export async function closeNativeContext(context: BrowserContext): Promise<void> {
  await Promise.all(context.pages().map(page => page.unrouteAll({ behavior: 'wait' })))
  await context.unrouteAll({ behavior: 'wait' })
  await context.close()
}

/** Seeds a registered athlete through the actual invitation/consent API; never creates a manual card. */
export async function nativeCreateConnectedAthlete(trainerPage: Page, values: {
  name: string; key?: string; profile?: { gender: 'male' | 'female'; ageYears: number; heightCm: number; initialWeightKg?: number; goal?: string }
}): Promise<{
  clientId: string; athleteKey: string; athleteProfileId: string; fullName: string
}> {
  const athleteKey = values.key ?? `connected-athlete-${randomUUID()}@example.test`
  const identity = await (await fixtureRequest('session', { key: athleteKey, role: 'client', firstName: values.name })).json() as { token?: string; profileId?: string }
  if (!identity.token || !identity.profileId || !fixtureOrigin) throw new Error('Invalid registered athlete fixture identity')
  const athleteRequest = (path: string, body?: object) => fetch(`${fixtureOrigin}${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'x-fit-session': identity.token!, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (values.profile) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date())
    const created = await athleteRequest('/v1/clients', {
      fullName: values.name, gender: values.profile.gender, ageYears: values.profile.ageYears,
      ageUpdatedAt: today, heightCm: values.profile.heightCm, goal: values.profile.goal ?? null, note: null,
      initialWeightKg: values.profile.initialWeightKg ?? null,
      initialWeightRecordedOn: values.profile.initialWeightKg === undefined ? null : today,
    })
    if (!created.ok) throw new Error(`Registered athlete profile setup failed (${created.status}): ${await created.text()}`)
  }
  const issued = await nativeRequest(trainerPage, '/v1/connection-directory', { method: 'POST', body: { action: 'create_invitation' } })
  if (!issued.ok) throw new Error(`Trainer invitation failed (${issued.status}): ${await issued.text()}`)
  const { result: invitation } = await issued.json() as { result: { code: string } }
  const resolved = await athleteRequest('/v1/connection-directory', { action: 'resolve', kind: 'code', value: invitation.code })
  if (!resolved.ok) throw new Error(`Athlete invitation preview failed (${resolved.status}): ${await resolved.text()}`)
  const { result: person } = await resolved.json() as { result: { id: string; invitationCode: string; expectedRelationshipId: string | null; expectedRevision: string | null } | null }
  if (!person) throw new Error('Registered athlete could not resolve trainer invitation')
  const accepted = await athleteRequest('/v1/connection-directory', { action: 'send', peerId: person.id, invitationCode: person.invitationCode,
    expectedRelationshipId: person.expectedRelationshipId, expectedRevision: person.expectedRevision })
  if (!accepted.ok) throw new Error(`Athlete connection failed (${accepted.status}): ${await accepted.text()}`)
  const { result } = await accepted.json() as { result: { status: string } }
  if (result.status !== 'accepted') throw new Error(`Athlete connection remained ${result.status}`)
  const own = await athleteRequest('/v1/clients')
  if (!own.ok) throw new Error(`Athlete card lookup failed (${own.status})`)
  const { clients } = await own.json() as { clients: { id: string; fullName: string; hasAccount: boolean; canCreateWorkout: boolean }[] }
  if (clients.length !== 1 || !clients[0]!.hasAccount) throw new Error('Registered athlete has no unique linked card')
  const card = clients[0]!
  const roster = await nativeRequest(trainerPage, '/v1/clients')
  if (!roster.ok) throw new Error(`Trainer roster lookup failed (${roster.status})`)
  const trainerClients = await roster.json() as { clients: { id: string; hasAccount: boolean; canCreateWorkout: boolean }[] }
  if (!trainerClients.clients.some(client => client.id === card.id && client.hasAccount && client.canCreateWorkout)) throw new Error('Confirmed athlete is not available to the trainer')
  return { clientId: card.id, athleteKey, athleteProfileId: identity.profileId, fullName: card.fullName }
}

/** Style gates only; data, authentication and mutations still use the real local API. */
export async function nativeEnableLime(page: Page, role: 'trainer' | 'client'): Promise<void> {
  await page.route('**/v1/auth/yandex/session', async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const response = await nativeRouteFetch(route)
    const payload = await response.json() as { profile?: { experiments?: Record<string, boolean> } }
    if (!payload.profile) return route.fulfill({ response })
    await route.fulfill({ response, json: { ...payload, profile: { ...payload.profile,
      experiments: { ...payload.profile.experiments, ...(role === 'trainer'
        ? { trainerScheduleV2: true, fitLime: true } : { clientLime: true }) },
    } } })
  })
}
