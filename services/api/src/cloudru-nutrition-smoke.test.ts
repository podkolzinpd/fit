import { afterEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), constructed: vi.fn() }))
vi.mock('pg', () => ({ Pool: class {
  constructor(config: unknown) { database.constructed(config) }
  query = database.query
  end = database.end
} }))
import { smokeCloudruNutrition } from './cloudru-nutrition-smoke.js'

function environment() {
  const values = { DATABASE_HOST: '10.70.10.67', DATABASE_PORT: '5432', DATABASE_NAME: 'fit',
    DATABASE_USER: 'fit_api', DATABASE_PASSWORD: 'synthetic-local-only', DATABASE_SSL_MODE: 'require',
    FIT_MEDIA_STORAGE_PROVIDER: 'cloudru', NUTRITION_ENABLED: 'true',
    NUTRITION_LOGIN_COHORT: JSON.stringify({ clients: [1, 2, 3, 4].map(x => String(x).repeat(64)),
      trainers: [5, 6].map(x => String(x).repeat(64)) }) }
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value)
}
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

describe('Cloud.ru nutrition release smoke', () => {
  it('verifies four/two runtime configuration and migrated capability using only a read query', async () => {
    environment()
    database.query.mockResolvedValue({ rows: [{ definition: 'case when role = client then 4 else 2 end', allowed: true }] })
    await smokeCloudruNutrition()
    expect(database.constructed).toHaveBeenCalledWith(expect.objectContaining({ user: 'fit_api', max: 1, statement_timeout: 5_000 }))
    expect(database.query).toHaveBeenCalledTimes(1)
    expect(database.query.mock.calls[0]?.[0]).toMatch(/^select/u)
    expect(database.end).toHaveBeenCalledOnce()
  })
  it('rejects the previous admission ceiling, missing execute grants and database failure, always closing the connection', async () => {
    environment()
    for (const row of [{ definition: 'then 3 else 2 end', allowed: true }, { definition: 'then 4 else 2 end', allowed: false }]) {
      database.query.mockResolvedValueOnce({ rows: [row] })
      await expect(smokeCloudruNutrition()).rejects.toThrow()
    }
    database.query.mockRejectedValueOnce(new Error('synthetic connection failure'))
    await expect(smokeCloudruNutrition()).rejects.toThrow()
    expect(database.end).toHaveBeenCalledTimes(3)
  })
  it('fails before connecting for an owner role, disabled feature or malformed cohort', async () => {
    environment()
    for (const [key, value] of [['DATABASE_USER', 'fit_owner'], ['NUTRITION_ENABLED', 'false'], ['NUTRITION_LOGIN_COHORT', '{}']] as const) {
      environment()
      vi.stubEnv(key, value)
      await expect(smokeCloudruNutrition()).rejects.toThrow()
    }
    expect(database.constructed).not.toHaveBeenCalled()
  })
})
