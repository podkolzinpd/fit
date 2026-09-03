import type { QueryResultRow } from 'pg'

import {
  type GoalCriteriaSuggestionResponse,
  YandexWorkoutParser,
  type WorkoutParseResponse,
  type WorkoutParserExercise,
} from './legacy-workout-parser.js'
import type { DatabasePool } from './db/types.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'

interface ExerciseRow extends QueryResultRow {
  id: string
  input_kind: string
  name: string
}

export interface PilotWorkoutParser {
  parse(session: YandexActorSessionInput, value: unknown): Promise<WorkoutParseResponse>
  suggest?(
    session: YandexActorSessionInput,
    value: unknown,
  ): Promise<GoalCriteriaSuggestionResponse>
}

export class DatabasePilotWorkoutParser implements PilotWorkoutParser {
  constructor(
    private readonly pool: DatabasePool,
    private readonly parser: YandexWorkoutParser,
  ) {}

  async parse(session: YandexActorSessionInput, value: unknown): Promise<WorkoutParseResponse> {
    const customCatalog = await withYandexActorSession(
      this.pool,
      session,
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

  async suggest(
    session: YandexActorSessionInput,
    value: unknown,
  ): Promise<GoalCriteriaSuggestionResponse> {
    return withYandexActorSession(this.pool, session, async (client) => {
      const [exerciseRows, metricRows] = await Promise.all([
        client.query<ExerciseRow>(`
          select exercise.id, exercise.name, exercise.input_kind
          from public.custom_exercises exercise
          where exercise.archived_at is null
          order by lower(exercise.name), exercise.id
          limit 1000
        `),
        client.query<{ id: string; name: string; unit: string | null }>(`
          select metric.id, metric.name, metric.unit
          from public.client_custom_metrics metric
          where metric.archived_at is null
          order by lower(metric.name), metric.id
          limit 1000
        `),
      ])
      const customCatalog = exerciseRows.map((row): WorkoutParserExercise => ({
        source: 'custom',
        ref: row.id,
        name: row.name,
        inputKind: row.input_kind,
      }))
      return this.parser.suggest(value, customCatalog, [...metricRows])
    })
  }
}
