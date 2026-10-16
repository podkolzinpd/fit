import { afterEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ query: vi.fn<(sql: string) => Promise<{ rows: Record<string, unknown>[] }>>(),
  connect: vi.fn(), end: vi.fn(), constructed: vi.fn() }))
vi.mock('pg', () => ({ Client: class {
  constructor(config: unknown) { database.constructed(config) }
  query = database.query
  connect = database.connect
  end = database.end
} }))
import { nutritionSmokeFailureReason, smokeCloudruNutrition } from './cloudru-nutrition-smoke.js'

function queries(overrides: { allowed?: boolean; definition?: string; readOnly?: string; timeout?: string; catalogError?: Error } = {}) {
  database.query.mockImplementation((sql: string) => {
    if (sql.includes('transaction_read_only')) return Promise.resolve({ rows: [{ readOnly: overrides.readOnly ?? 'on', timeout: overrides.timeout ?? '5s' }] })
    if (sql.includes('has_function_privilege')) return Promise.resolve({ rows: [{ allowed: overrides.allowed ?? true }] })
    if (sql.includes('pg_get_functiondef')) {
      if (overrides.catalogError) return Promise.reject(overrides.catalogError)
      return Promise.resolve({ rows: [{ definition: overrides.definition ?? "case when p_role = 'client' then 4 else 2 end" }] })
    }
    return Promise.resolve({ rows: [] })
  })
}
function environment() {
  const values = { DATABASE_HOST: '10.70.10.67', DATABASE_PORT: '5432', DATABASE_NAME: 'fit',
    DATABASE_USER: 'fit_api', DATABASE_PASSWORD: 'synthetic-local-only', DATABASE_SSL_MODE: 'require',
    FIT_MEDIA_STORAGE_PROVIDER: 'cloudru', NUTRITION_ENABLED: 'true',
    NUTRITION_LOGIN_COHORT: JSON.stringify({ clients: [1, 2, 3, 4].map(x => String(x).repeat(64)),
      trainers: [5, 6].map(x => String(x).repeat(64)) }) }
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value)
  queries()
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })

describe('Cloud.ru nutrition release smoke', () => {
  it('verifies four/two runtime configuration and migrated capability using only read queries', async () => {
    environment()
    expect(await smokeCloudruNutrition()).toEqual({ clients: 4, trainers: 2 })
    expect(database.constructed).toHaveBeenCalledWith(expect.objectContaining({ user: 'fit_api', query_timeout: 5_000, connectionTimeoutMillis: 5_000 }))
    expect(database.constructed.mock.calls[0]?.[0]).not.toHaveProperty('statement_timeout')
    expect(database.constructed.mock.calls[0]?.[0]).not.toHaveProperty('options')
    expect(database.connect).toHaveBeenCalledOnce()
    expect(database.query.mock.calls.map(([sql]) => sql)).toEqual([
      'begin read only', "set local statement_timeout = '5s'", "set local lock_timeout = '2s'",
      expect.stringContaining('transaction_read_only'), expect.stringContaining('has_function_privilege'),
      expect.stringContaining('pg_get_functiondef'), 'commit',
    ])
    expect(database.end).toHaveBeenCalledOnce()
  })
  it('accepts only cap4/5 with two trainers and permits prior-six config rollback without schema Down', async () => {
    environment()
    queries({ definition: "CASE WHEN p_role = 'client' THEN\n  4 ELSE\t2 END" })
    await smokeCloudruNutrition()
    queries({ definition: "case when p_role = 'client' then 5 else 2 end" })
    expect(await smokeCloudruNutrition()).toEqual({ clients: 4, trainers: 2 })
    vi.stubEnv('NUTRITION_LOGIN_COHORT', JSON.stringify({ clients: [1, 2, 3, 4, 7].map(x => String(x).repeat(64)), trainers: [5, 6].map(x => String(x).repeat(64)) }))
    expect(await smokeCloudruNutrition()).toEqual({ clients: 5, trainers: 2 })
    for (const definition of ["case when p_role = 'client' then 4 else 2 end",
      "case when p_role = 'client' then 6 else 2 end", "case when p_role = 'trainer' then 5 else 2 end",
      "case when p_role = 'client' then 5 else 3 end", 'then 5 else 2 end']) {
      queries({ definition })
      await expect(smokeCloudruNutrition()).rejects.toThrow('cloudru_nutrition_capability_mismatch')
    }
  })
  it('distinguishes a missing execute grant from the wrong admission ceiling without exposing DB content', async () => {
    environment()
    queries({ allowed: false })
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
    expect(nutritionSmokeFailureReason({ code: '08P01', message: 'synthetic-secret' })).toBe('cloudru_nutrition_database_protocol_rejected')
    expect(nutritionSmokeFailureReason({ code: 'synthetic-secret', message: 'SELECT private_fixture' })).toBe('cloudru_nutrition_smoke_failed')
  })
  it('distinguishes catalog permission from service execution permission without permitting activation', async () => {
    environment()
    queries({ catalogError: Object.assign(new Error('synthetic-private-message'), { code: '42501' }) })
    await expect(smokeCloudruNutrition()).rejects.toThrow('cloudru_nutrition_metadata_read_denied')
    expect(database.end).toHaveBeenCalledOnce()
  })
  it('rejects the previous admission ceiling, missing execute grants and database failure, always closing the connection', async () => {
    environment()
    for (const row of [{ definition: "case when p_role = 'client' then 3 else 2 end", allowed: true }, { definition: "case when p_role = 'client' then 4 else 2 end", allowed: false }]) {
      queries(row)
      await expect(smokeCloudruNutrition()).rejects.toThrow()
    }
    database.query.mockRejectedValueOnce(new Error('synthetic connection failure'))
    await expect(smokeCloudruNutrition()).rejects.toThrow()
    expect(database.end).toHaveBeenCalledTimes(3)
  })
  it('fails closed before capability reads unless READ ONLY and the server timeout are confirmed', async () => {
    environment()
    for (const overrides of [{ readOnly: 'off' }, { timeout: '0' }]) {
      database.query.mockClear()
      queries(overrides)
      await expect(smokeCloudruNutrition()).rejects.toThrow('cloudru_nutrition_readonly_required')
      expect(database.query.mock.calls.some(([sql]) => sql.includes('has_function_privilege'))).toBe(false)
      expect(database.query.mock.calls.some(([sql]) => sql === 'commit')).toBe(false)
    }
    expect(database.end).toHaveBeenCalledTimes(2)
  })
  it('closes the dedicated connection on connect and transaction setup failures without committing', async () => {
    environment()
    database.connect.mockRejectedValueOnce({ code: '08P01' })
    await expect(smokeCloudruNutrition()).rejects.toEqual({ code: '08P01' })
    expect(database.query).not.toHaveBeenCalled()
    database.query.mockRejectedValueOnce(new Error('synthetic setup failure'))
    await expect(smokeCloudruNutrition()).rejects.toThrow('synthetic setup failure')
    expect(database.end).toHaveBeenCalledTimes(2)
    expect(database.query.mock.calls.some(([sql]) => sql === 'commit')).toBe(false)
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
