import { withYandexPilotActorTransaction } from './db/yandex-pilot-transaction.js'
import type { DatabasePool } from './db/types.js'
import { readOwnProfile, type ProfileResponse } from './profile.js'

export interface PilotProfileReader {
  readProfile(subjectHash: string): Promise<ProfileResponse | undefined>
}

export class DatabasePilotProfileReader implements PilotProfileReader {
  constructor(private readonly pool: DatabasePool) {}

  readProfile(subjectHash: string): Promise<ProfileResponse | undefined> {
    return withYandexPilotActorTransaction(
      this.pool,
      subjectHash,
      readOwnProfile,
    )
  }
}
