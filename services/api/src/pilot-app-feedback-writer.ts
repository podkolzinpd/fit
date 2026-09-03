import { submitAppFeedback } from './app-feedback-command.js'
import type { AppFeedbackDraft } from './app-feedback-request.js'
import type { DatabasePool } from './db/types.js'
import {
  withYandexActorSession,
  type YandexActorSessionInput,
} from './yandex-actor-session.js'

export interface PilotAppFeedbackWriter {
  submit(session: YandexActorSessionInput, draft: AppFeedbackDraft): Promise<string>
}

export class DatabasePilotAppFeedbackWriter implements PilotAppFeedbackWriter {
  constructor(private readonly pool: DatabasePool) {}

  submit(session: YandexActorSessionInput, draft: AppFeedbackDraft): Promise<string> {
    return withYandexActorSession(this.pool, session, (client) =>
      submitAppFeedback(client, draft))
  }
}
