import { afterEach, expect, it, vi } from 'vitest'

const background = vi.hoisted(() => ({ constructed: vi.fn(), end: vi.fn(), run: vi.fn() }))
vi.mock('./db/pg-pool.js', () => ({ PgDatabasePool: class {
  constructor(config: unknown) { background.constructed(config) }
  end = background.end
} }))
vi.mock('./background-dispatcher.js', () => ({ BackgroundDispatcher: class {
  run = background.run
} }))
import { runCloudruBackground } from './cloudru-background-worker.js'

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetAllMocks() })

it('bounds queries without sending unsupported statement_timeout in the database startup packet', async () => {
  for (const [name, value] of Object.entries({ DATABASE_HOST: '10.70.10.67', DATABASE_PORT: '5432',
    DATABASE_NAME: 'fit', DATABASE_USER: 'fit_api', DATABASE_PASSWORD: 'synthetic-only',
    DATABASE_SSL_MODE: 'require', FIT_MEDIA_STORAGE_PROVIDER: 'cloudru',
    VAPID_PUBLIC_KEY: 'synthetic-public', VAPID_PRIVATE_KEY: 'synthetic-private',
    VAPID_SUBJECT: 'https://example.test' })) vi.stubEnv(name, value)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  background.run.mockResolvedValue({ sessionCleanup: { status: 'cleaned', deleted: 0 } })
  await runCloudruBackground()
  expect(background.constructed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    user: 'fit_api', max: 1, query_timeout: 10_000,
  }))
  expect(background.constructed.mock.calls[0]?.[0]).not.toHaveProperty('statement_timeout')
  expect(background.constructed.mock.calls[0]?.[0]).not.toHaveProperty('options')
  expect(background.end).toHaveBeenCalledOnce()
})
