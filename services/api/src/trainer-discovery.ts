import type { QueryResultRow } from 'pg'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import { withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'

export type TrainerDiscoveryPromptAction = 'snooze' | 'dismiss'
export type TrainerDiscoveryPrompt = {
  state: 'visible' | 'snoozed' | 'dismissed'
  remindAt: string | null
  updatedAt: string | null
}

export class TrainerDiscoveryError extends Error {
  constructor(public readonly failure: 'forbidden') {
    super(failure)
    this.name = 'TrainerDiscoveryError'
  }
}

interface PromptRow extends QueryResultRow {
  prompt: TrainerDiscoveryPrompt
}

export interface PilotTrainerDiscovery {
  getPrompt(session: YandexActorSessionInput): Promise<TrainerDiscoveryPrompt>
  setPrompt(session: YandexActorSessionInput, action: TrainerDiscoveryPromptAction): Promise<TrainerDiscoveryPrompt>
}

export class DatabasePilotTrainerDiscovery implements PilotTrainerDiscovery {
  constructor(private readonly pool: DatabasePool) {}

  private withSession<Result>(session: YandexActorSessionInput, work: (client: DatabaseClient) => Promise<Result>) {
    return withYandexActorSession(this.pool, session, work)
  }

  getPrompt(session: YandexActorSessionInput) {
    return this.withSession(session, async (client) => {
      await this.ensureClient(client)
      const rows = await client.query<PromptRow>('select public.get_trainer_discovery_prompt() as prompt')
      return rows[0]!.prompt
    })
  }

  setPrompt(session: YandexActorSessionInput, action: TrainerDiscoveryPromptAction) {
    return this.withSession(session, async (client) => {
      await this.ensureClient(client)
      const rows = await client.query<PromptRow>(
        'select public.set_trainer_discovery_prompt($1) as prompt',
        [action],
      )
      return rows[0]!.prompt
    })
  }

  private async ensureClient(client: DatabaseClient) {
    const rows = await client.query(
      "select id from public.profiles where id = auth.uid() and account_role = 'client'",
    )
    if (rows[0] === undefined) throw new TrainerDiscoveryError('forbidden')
  }
}
