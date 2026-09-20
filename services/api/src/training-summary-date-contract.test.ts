import type { QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './db/types.js'
import { DatabasePilotTrainingSummaries } from './training-summary.js'

const ACTOR_ID = '00000000-0000-4000-8000-000000000002'
const CLIENT_ID = '00000000-0000-4000-8000-000000000001'
function selectedDate(query: string, value: string): string | Date {
  const [year, month, day] = value.split('-').map(Number)
  return query.includes('::text')
    ? value
    : new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

class SummaryConnection implements DatabaseConnection {
  readonly queries: string[] = []

  query<Row extends QueryResultRow = QueryResultRow>(text: string): Promise<readonly Row[]> {
    this.queries.push(text)
    const normalized = text.replaceAll(/\s+/g, ' ').trim()
    let rows: QueryResultRow[]
    if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback'
      || normalized.startsWith("select set_config('request.jwt.claim.sub'")) {
      rows = []
    } else if (normalized.includes('resolve_yandex_pilot_session')) {
      rows = [{ profile_id: ACTOR_ID }]
    } else if (normalized.includes('select item.auth_user_id')) {
      rows = [{ auth_user_id: ACTOR_ID, goal: null, trainer_id: ACTOR_ID }]
    } else if (normalized.includes('select client.auth_user_id')) {
      rows = [{ auth_user_id: ACTOR_ID, goal: null, trainer_id: ACTOR_ID }]
    } else if (normalized === 'select auth.uid() actor_id') {
      rows = [{ actor_id: ACTOR_ID }]
    } else if (normalized.includes('from public.client_goals')) {
      rows = []
    } else if (normalized.includes('from public.workouts') && normalized.includes('limit 1')) {
      rows = [{ workout_date: selectedDate(text, '2026-08-20') }]
    } else if (normalized.includes('from public.workouts')) {
      rows = [
        {
          id: '00000000-0000-4000-8000-000000000010',
          workout_date: selectedDate(text, '2026-08-20'),
          status: 'done', deleted_at: null, session_rpe: null,
          wellbeing: null, discomfort: null, client_comment: null,
        },
        {
          id: '00000000-0000-4000-8000-000000000011',
          workout_date: selectedDate(text, '2026-09-18'),
          status: 'done', deleted_at: null, session_rpe: null,
          wellbeing: null, discomfort: null, client_comment: null,
        },
      ]
    } else if (normalized.includes('from public.workout_exercises')) {
      rows = []
    } else if (normalized.includes('from public.client_progress')) {
      rows = [{
        recorded_on: selectedDate(text, '2026-09-01'),
        weight_kg: '80', chest_cm: null, waist_cm: null, hip_cm: null,
      }]
    } else if (normalized.includes('from public.client_published_training_summaries')) {
      rows = []
    } else if (normalized.includes('from app_private.training_summary_generation_guards')) {
      rows = []
    } else {
      throw new Error(`Unexpected query: ${normalized}`)
    }
    return Promise.resolve(rows as unknown as readonly Row[])
  }

  release(): void {}
}

class SummaryPool implements DatabasePool {
  constructor(readonly connection: SummaryConnection) {}
  connect(): Promise<DatabaseConnection> { return Promise.resolve(this.connection) }
  end(): Promise<void> { return Promise.resolve() }
}

describe('Yandex training summary date contract', () => {
  it('keeps PostgreSQL dates comparable without calling the model', async () => {
    const connection = new SummaryConnection()
    const summaries = new DatabasePilotTrainingSummaries(new SummaryPool(connection))

    const result = await summaries.diagnose('a'.repeat(43), {
      clientId: CLIENT_ID,
      periodStart: '2026-08-21',
      periodEnd: '2026-09-20',
      force: false,
      triggerReason: 'manual_refresh',
    }) as { calls: number; stats: { workouts: number } }

    expect(result.calls).toBe(0)
    expect(result.stats.workouts).toBe(2)
    expect(connection.queries.some((query) => query.includes('workout.workout_date::text as workout_date'))).toBe(true)
    expect(connection.queries.some((query) => query.includes('progress.recorded_on::text as recorded_on'))).toBe(true)
  })
})
