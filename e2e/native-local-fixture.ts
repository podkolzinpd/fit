import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
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

export const test = base.extend<{ nativeIsolation: void; nativeApi: string }>({
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
  }, { timeout: 120_000 }],
  nativeIsolation: [async ({ nativeApi, context }, use) => {
    fixtureOrigin = nativeApi
    await fixtureRequest('reset', {})
    await use()
    await Promise.all(context.pages().map(page => page.unrouteAll({ behavior: 'wait' })))
    await context.unrouteAll({ behavior: 'wait' })
  }, { auto: true }],
})

export async function nativeSignIn(page: Page, key = 'trainer', role: 'trainer' | 'client' = key.includes('client') ? 'client' : 'trainer', firstName?: string): Promise<void> {
  await attachNativeApi(page.context())
  const fixtureKey = key === 'trainer@fit.local' ? 'trainer' : key === 'client@fit.local' ? 'client' : key
  const value: unknown = await (await fixtureRequest('session', { key: fixtureKey, role, firstName })).json()
  if (typeof value !== 'object' || value === null || !('token' in value) || typeof value.token !== 'string' || !('expiresAt' in value) || typeof value.expiresAt !== 'string') throw new Error('Invalid native fixture session')
  const session = { token: value.token, expiresAt: value.expiresAt }
  // Replace previous fixture init scripts when one browser switches accounts.
  await page.goto('/auth')
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
