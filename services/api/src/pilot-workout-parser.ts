import type { QueryResultRow } from 'pg'

import { hashPilotSessionToken } from './auth/pilot-session-token.js'
import {
  YandexWorkoutParser,
  type WorkoutParseResponse,
  type WorkoutParserExercise,
} from './legacy-workout-parser.js'
import type { DatabasePool } from './db/types.js'
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'

interface ExerciseRow extends QueryResultRow {
  id: string
  input_kind: string
  name: string
}

export interface PilotWorkoutParser {
  parse(sessionToken: string, value: unknown): Promise<WorkoutParseResponse>
}

export class DatabasePilotWorkoutParser implements PilotWorkoutParser {
  constructor(
    private readonly pool: DatabasePool,
    private readonly parser: YandexWorkoutParser,
  ) {}

  async parse(sessionToken: string, value: unknown): Promise<WorkoutParseResponse> {
    const tokenHash = hashPilotSessionToken(sessionToken)
    if (tokenHash === undefined) throw new PilotSessionInvalidError()
    const customCatalog = await withYandexPilotSessionTransaction(
      this.pool,
      tokenHash,
      async (client) => {
        const rows = await client.query<ExerciseRow>(`
          select exercise.id, exercise.name, exercise.input_kind
          from public.custom_exercises exercise
          where exercise.archived_at is null
          order by lower(exercise.name), exercise.id
          limit 1000
        `)
        return rows.map((row): WorkoutParserExercise => ({
          source: 'custom',
          ref: row.id,
          name: row.name,
          inputKind: row.input_kind,
        }))
      },
    )
    return this.parser.parse(value, customCatalog)
  }
}
