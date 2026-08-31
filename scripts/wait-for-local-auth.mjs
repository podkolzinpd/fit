import process from 'node:process'
import { pathToFileURL } from 'node:url'

const DEFAULT_EMAIL = 'trainer@fit.local'
const DEFAULT_PASSWORD = 'FitLocal123!'
const DEFAULT_ATTEMPTS = 30
const DEFAULT_INTERVAL_MS = 1_000
const DEFAULT_TIMEOUT_MS = 5_000

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function authEndpoint(supabaseUrl) {
  if (supabaseUrl === undefined || supabaseUrl.trim() === '') {
    throw new Error('VITE_SUPABASE_URL is required')
  }
  return new URL('/auth/v1/token?grant_type=password', supabaseUrl).toString()
}

export function readConfig(env = process.env) {
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (publishableKey === undefined || publishableKey.trim() === '') {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is required')
  }

  return {
    endpoint: authEndpoint(env.VITE_SUPABASE_URL),
    publishableKey,
    email: env.LOCAL_AUTH_READY_EMAIL ?? DEFAULT_EMAIL,
    password: env.LOCAL_AUTH_READY_PASSWORD ?? DEFAULT_PASSWORD,
    attempts: positiveInteger(env.LOCAL_AUTH_READY_ATTEMPTS, DEFAULT_ATTEMPTS, 'LOCAL_AUTH_READY_ATTEMPTS'),
    intervalMs: positiveInteger(
      env.LOCAL_AUTH_READY_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
      'LOCAL_AUTH_READY_INTERVAL_MS',
    ),
    timeoutMs: positiveInteger(env.LOCAL_AUTH_READY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 'LOCAL_AUTH_READY_TIMEOUT_MS'),
  }
}

function compactErrorBody(text) {
  if (text.trim() === '') return ''

  try {
    const body = JSON.parse(text)
    const message = body.message ?? body.error_description ?? body.error
    if (typeof message === 'string' && message.trim() !== '') return message.trim()
  } catch {
    // Fall back to a short text excerpt below.
  }

  return text.replace(/\s+/g, ' ').trim().slice(0, 200)
}

async function requestSeededLogin(config, fetchImpl) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: config.email, password: config.password }),
      signal: controller.signal,
    })
    const responseText = await response.text()

    if (response.ok) {
      try {
        const body = JSON.parse(responseText)
        if (typeof body.access_token === 'string' && body.access_token.length > 0) {
          return { ready: true }
        }
      } catch {
        // Keep retrying a malformed success response; it is not a usable session.
      }
      return {
        ready: false,
        retryable: true,
        detail: 'auth returned success without an access token',
      }
    }

    const detail = compactErrorBody(responseText)
    return {
      ready: false,
      retryable: response.status >= 500 || response.status === 429,
      detail: `HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      ready: false,
      retryable: true,
      detail,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function waitForLocalAuth(config, options = {}) {
  const fetchImpl = options.fetch ?? fetch
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  let lastDetail = 'no response'

  for (let attempt = 1; attempt <= config.attempts; attempt += 1) {
    const result = await requestSeededLogin(config, fetchImpl)
    if (result.ready) return

    lastDetail = result.detail
    if (!result.retryable) {
      throw new Error(`Local Supabase Auth rejected the seeded test login: ${lastDetail}`)
    }

    if (attempt < config.attempts) await sleep(config.intervalMs)
  }

  throw new Error(
    `Local Supabase Auth did not accept the seeded test login after ${config.attempts} attempts. Last response: ${lastDetail}`,
  )
}

async function main() {
  const config = readConfig()
  await waitForLocalAuth(config)
  console.log('[local-auth] Supabase Auth accepted the seeded test login.')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[local-auth] ${message}`)
    process.exitCode = 1
  })
}
