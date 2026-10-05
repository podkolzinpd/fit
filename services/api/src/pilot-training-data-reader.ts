import type { DatabasePool } from './db/types.js'
import {
  readAccessibleTrainingData,
  type PilotTrainingDataResponse,
  type TrainingDataPage,
} from './training-data.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'

export interface PilotTrainingDataReader {
  readTrainingData(
    session: YandexActorSessionInput,
    page?: TrainingDataPage,
  ): Promise<PilotTrainingDataResponse>
}

export class DatabasePilotTrainingDataReader implements PilotTrainingDataReader {
  constructor(private readonly pool: DatabasePool) {}

  readTrainingData(
    session: YandexActorSessionInput,
    page?: TrainingDataPage,
  ): Promise<PilotTrainingDataResponse> {
    return withYandexActorSession(
      this.pool,
      session,
      (client) => readAccessibleTrainingData(client, page),
      // Root versions, exercises and sets must come from the same MVCC snapshot.
      'read-only-snapshot',
    )
  }
}
