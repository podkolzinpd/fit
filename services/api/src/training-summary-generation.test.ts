import type { QueryResultRow } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './db/types.js'
import * as summaryModel from './training-summary-core.js'
import { DatabasePilotTrainingSummaries } from './training-summary.js'

const ACTOR_ID = '00000000-0000-4000-8000-000000000002'
const CLIENT_ID = '00000000-0000-4000-8000-000000000001'
const SESSION = { accessMode: 'read_write' as const, token: 'A'.repeat(43) }
const REQUEST = {
  clientId: CLIENT_ID, periodStart: '2026-09-01', periodEnd: '2026-09-20',
  force: false, triggerReason: 'create' as const,
}
const GENERATED: Awaited<ReturnType<typeof summaryModel.requestYandexSummary>> = {
  summary: {
    trainer: { headline: 'Одна тренировка.', progress: ['Результат сохранён.'], consistency: 'Одна тренировка.', attention: [] },
    client: { headline: 'Одна тренировка.', achievements: ['Результат сохранён.'], consistency: 'Одна тренировка.',
      encouragement: 'Продолжайте.', goalAlignment: '', nextSteps: [], missingContext: [], analysisVersion: 'test' },
  },
  modelUri: 'test-model', modelVersion: 'test', usage: { totalTokens: '10' },
}

// Emulates only database replies. Production actor transactions, source/input
// construction, guard handling, save and cache paths execute unchanged.
function generationFixture() {
  const claims: { fingerprint: unknown; decision: 'claimed' | 'in_progress' }[] = []
  let cache: QueryResultRow | undefined
  const query = vi.fn((text: string, values: readonly unknown[] = []): readonly QueryResultRow[] => {
    const sql = text.replaceAll(/\s+/g, ' ').trim()
    if (['begin', 'commit', 'rollback'].includes(sql) || sql.includes('set_config')) return []
    if (sql.includes('resolve_yandex_app_session')) return [{ profile_id: ACTOR_ID }]
    if (sql.includes('select item.auth_user_id') || sql.includes('select client.auth_user_id')) {
      return [{ auth_user_id: null, trainer_id: ACTOR_ID, goal: null }]
    }
    if (sql === 'select auth.uid() actor_id') return [{ actor_id: ACTOR_ID }]
    if (sql.includes('from public.client_goals') || sql.includes('from public.workout_exercises')
      || sql.includes('from public.client_progress')) return []
    if (sql.includes('from public.workouts') && sql.includes('limit 1')) return [{ workout_date: '2026-09-10' }]
    if (sql.includes('from public.workouts')) return [{
      id: '00000000-0000-4000-8000-000000000010', workout_date: '2026-09-10', status: 'done',
      deleted_at: null, session_rpe: null, wellbeing: null, discomfort: null, client_comment: null,
    }]
    if (sql.includes('from public.client_training_summaries')) return cache === undefined ? [] : [cache]
    if (sql.includes('claim_training_summary_generation')) {
      const decision = claims.length === 0 ? 'claimed' : 'in_progress'
      claims.push({ fingerprint: values[3], decision })
      return [{ result: { decision } }]
    }
    if (sql.includes('save_generated_training_summary')) {
      const trainerSummary: unknown = JSON.parse(String(values[4]))
      const clientSummary: unknown = JSON.parse(String(values[5]))
      const result = { id: 'saved-summary', trainer_summary: trainerSummary, client_summary: clientSummary }
      cache = { input_fingerprint: values[9], result }
      return [{ result }]
    }
    if (sql.includes('complete_training_summary_generation')) return []
    throw new Error(`Unexpected query: ${sql}`)
  })
  const pool: DatabasePool = {
    connect: () => Promise.resolve({
      query: <Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) =>
        Promise.resolve(query(text, values) as readonly Row[]),
      release() {},
    } satisfies DatabaseConnection),
    end: () => Promise.resolve(),
  }
  return { pool, query, claims }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('native training summary generation guard', () => {
  it('calls the model once, rejects an in-flight duplicate and then reuses the saved cache', async () => {
    vi.stubEnv('FIT_AI_SUMMARY_GENERATION_DISABLED', 'false')
    vi.spyOn(summaryModel, 'configuredModelId').mockReturnValue('test-model')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    let releaseModel!: (value: typeof GENERATED) => void
    let markModelStarted!: () => void
    const modelResult = new Promise<typeof GENERATED>(resolve => { releaseModel = resolve })
    const modelStarted = new Promise<void>(resolve => { markModelStarted = resolve })
    const model = vi.spyOn(summaryModel, 'requestYandexSummary').mockImplementation(() => {
      markModelStarted()
      return modelResult
    })
    const { pool, query, claims } = generationFixture()
    const summaries = new DatabasePilotTrainingSummaries(pool)

    const first = summaries.generate(SESSION, REQUEST)
    await Promise.race([modelStarted, first])
    try {
      await expect(summaries.generate(SESSION, REQUEST)).rejects.toMatchObject({
        status: 409, code: 'summary_generation_in_progress',
      })
      expect(model).toHaveBeenCalledOnce()
      expect(claims.map(claim => claim.decision)).toEqual(['claimed', 'in_progress'])
      expect(claims[1]?.fingerprint).toBe(claims[0]?.fingerprint)
    } finally {
      releaseModel(GENERATED)
    }
    const saved = await first as { data: unknown; cached: boolean }
    expect(saved).toMatchObject({ data: { id: 'saved-summary' }, cached: false })
    await expect(summaries.generate(SESSION, { ...REQUEST, force: true, triggerReason: 'manual_refresh' }))
      .resolves.toEqual({ data: saved.data, cached: true })
    expect(model).toHaveBeenCalledOnce()
    expect(claims).toHaveLength(2)
    expect(query.mock.calls.filter(([text]) => text.includes('save_generated_training_summary'))).toHaveLength(1)
    expect(query.mock.calls.filter(([text]) => text.includes('complete_training_summary_generation'))).toHaveLength(1)
  })
})
