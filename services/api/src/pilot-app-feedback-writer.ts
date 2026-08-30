import { submitAppFeedback } from './app-feedback-command.js'
import type { AppFeedbackDraft } from './app-feedback-request.js'
import { hashPilotSessionToken } from './auth/pilot-session-token.js'
import type { DatabasePool } from './db/types.js'
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'

export interface PilotAppFeedbackWriter {
  submit(sessionToken: string, draft: AppFeedbackDraft): Promise<string>
}

export class DatabasePilotAppFeedbackWriter implements PilotAppFeedbackWriter {
  constructor(private readonly pool: DatabasePool) {}

  submit(sessionToken: string, draft: AppFeedbackDraft): Promise<string> {
    const tokenHash = hashPilotSessionToken(sessionToken)
    if (tokenHash === undefined) throw new PilotSessionInvalidError()
    return withYandexPilotSessionTransaction(this.pool, tokenHash, (client) =>
      submitAppFeedback(client, draft))
  }
}
