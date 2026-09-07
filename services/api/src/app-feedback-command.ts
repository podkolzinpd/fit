import type { QueryResultRow } from 'pg'

import type { AppFeedbackDraft } from './app-feedback-request.js'
import type { DatabaseClient } from './db/types.js'

interface AppFeedbackRow extends QueryResultRow {
  feedback_id: string
}

export type AppFeedbackCommandFailure = 'forbidden' | 'invalid'

export class AppFeedbackCommandError extends Error {
  constructor(readonly failure: AppFeedbackCommandFailure) {
    super(`App feedback command failed: ${failure}`)
    this.name = 'AppFeedbackCommandError'
  }
}

function commandError(error: unknown): AppFeedbackCommandError | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return undefined
  }
  if (error.message === 'app_feedback_forbidden') {
    return new AppFeedbackCommandError('forbidden')
  }
  if (error.message === 'app_feedback_invalid') {
    return new AppFeedbackCommandError('invalid')
  }
  return undefined
}

export async function submitAppFeedback(
  client: DatabaseClient,
  draft: AppFeedbackDraft,
): Promise<string> {
  try {
    const rows = await client.query<AppFeedbackRow>(
      `select public.submit_app_feedback($1, $2, $3, $4, $5, $6)
        as feedback_id`,
      [
        draft.kind,
        draft.message,
        draft.screenPath,
        draft.appVersion,
        draft.displayMode,
        draft.userAgent,
      ],
    )
    const feedbackId = rows[0]?.feedback_id
    if (feedbackId === undefined) {
      throw new Error('App feedback command returned no result')
    }
    return feedbackId
  } catch (error) {
    throw commandError(error) ?? error
  }
}
