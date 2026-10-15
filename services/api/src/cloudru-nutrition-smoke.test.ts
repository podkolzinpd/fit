import { afterEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), constructed: vi.fn() }))
vi.mock('pg', () => ({ Pool: class {
  constructor(config: unknown) { database.constructed(config) }
  query = database.query
  end = database.end
} }))
import { nutritionSmokeFailureReason, smokeCloudruNutrition } from './cloudru-nutrition-smoke.js'

function environment() {
  const values = { DATABASE_HOST: '10.70.10.67', DATABASE_PORT: '5432', DATABASE_NAME: 'fit',
    DATABASE_USER: 'fit_api', DATABASE_PASSWORD: 'synthetic-local-only', DATABASE_SSL_MODE: 'require',
    FIT_MEDIA_STORAGE_PROVIDER: 'cloudru', NUTRITION_ENABLED: 'true',
    NUTRITION_LOGIN_COHORT: JSON.stringify({ clients: [1, 2, 3, 4].map(x => String(x).repeat(64)),
      trainers: [5, 6].map(x => String(x).repeat(64)) }) }
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value)
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })

describe('Cloud.ru nutrition release smoke', () => {
  it('verifies four/two runtime configuration and migrated capability using only read queries', async () => {
    environment()
    database.query.mockResolvedValue({ rows: [{ definition: 'case when role = client then 4 else 2 end', allowed: true }] })
    await smokeCloudruNutrition()
    expect(database.constructed).toHaveBeenCalledWith(expect.objectContaining({ user: 'fit_api', max: 1, statement_timeout: 5_000 }))
    expect(database.query).toHaveBeenCalledTimes(2)
    for (const [sql] of database.query.mock.calls) expect(sql).toMatch(/^select/u)
    expect(database.end).toHaveBeenCalledOnce()
  })
  it('accepts only the same four/two admission capability regardless of SQL keyword case or whitespace', async () => {
    environment()
    database.query.mockResolvedValue({ rows: [{ definition: 'THEN\n  4 ELSE\t2 END', allowed: true }] })
    await smokeCloudruNutrition()
    database.query.mockResolvedValue({ rows: [{ definition: 'THEN 5 ELSE 2 END', allowed: true }] })
    await expect(smokeCloudruNutrition()).rejects.toThrow('cloudru_nutrition_cap_four_missing')
  })
  it('distinguishes a missing execute grant from the wrong admission ceiling without exposing DB content', async () => {
    environment()
    database.query.mockResolvedValueOnce({ rows: [{ definition: 'then 4 else 2 end', allowed: false }] })
    await expect(smokeCloudruNutrition()).rejects.toThrow('cloudru_nutrition_bind_execute_missing')
  })
  it('exports only fixed failure codes, not raw driver messages, SQL, credentials or arbitrary codes', () => {
    expect(nutritionSmokeFailureReason(new Error('cloudru_nutrition_cohort_rejected'))).toBe('cloudru_nutrition_cohort_rejected')
    expect(nutritionSmokeFailureReason(Object.assign(new Error('synthetic-secret SELECT private_fixture'), { code: '42501' })))
      .toBe('cloudru_nutrition_database_permission_denied')
    expect(nutritionSmokeFailureReason(Object.assign(new Error('synthetic-secret'), { code: '42883' })))
      .toBe('cloudru_nutrition_function_missing')
    expect(nutritionSmokeFailureReason({ code: '28P01', message: 'synthetic-secret' })).toBe('cloudru_nutrition_database_auth_failed')
    expect(nutritionSmokeFailureReason({ code: 'ECONNREFUSED', message: 'synthetic-secret' })).toBe('cloudru_nutrition_database_unavailable')
    expect(nutritionSmokeFailureReason({ code: 'synthetic-secret', message: 'SELECT private_fixture' })).toBe('cloudru_nutrition_smoke_failed')
  })
  it('distinguishes catalog permission from service execution permission without permitting activation', async () => {
    environment()
    database.query.mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockRejectedValueOnce(Object.assign(new Error('synthetic-private-message'), { code: '42501' }))
    await expect(smokeCloudruNutrition()).rejects.toThrow('cloudru_nutrition_metadata_read_denied')
    expect(database.end).toHaveBeenCalledOnce()
  })
  it('rejects the previous admission ceiling, missing execute grants and database failure, always closing the connection', async () => {
    environment()
    for (const row of [{ definition: 'then 3 else 2 end', allowed: true }, { definition: 'then 4 else 2 end', allowed: false }]) {
      database.query.mockResolvedValue({ rows: [row] })
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
