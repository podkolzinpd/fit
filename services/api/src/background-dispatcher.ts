import type { AppFeedbackDispatchSummary } from './app-feedback-dispatcher.js'
import type { PushDispatchSummary } from './push-dispatcher.js'
import { BackgroundDispatchError, backgroundDispatchDiagnostics } from './background-dispatch-error.js'
import type { SessionCleanupResult } from './session-cleanup.js'

interface Dispatcher<Summary> {
  run(now?: Date): Promise<Summary>
}

export interface BackgroundDispatchSummary extends PushDispatchSummary {
  appFeedback?: AppFeedbackDispatchSummary
  sessionCleanup: { status: 'cleaned'; deleted: number } | { status: 'failed' }
}

export class BackgroundDispatcher {
  constructor(
    private readonly push: Dispatcher<PushDispatchSummary>,
    private readonly appFeedback: Dispatcher<AppFeedbackDispatchSummary> | undefined,
    private readonly sessionCleanup: Dispatcher<SessionCleanupResult>,
  ) {}

  async run(now = new Date()): Promise<BackgroundDispatchSummary> {
    const [push, appFeedback, cleanup] = await Promise.allSettled([
      this.push.run(now),
      this.appFeedback?.run(now),
      this.sessionCleanup.run(),
    ])
    // Finish every independent job even when another fails. Cleanup is retried
    // by the next timer, without cancelling notification delivery.
    if (cleanup.status === 'rejected') {
      console.warn(JSON.stringify({
        level: 'WARN', event: 'yandex_session_cleanup_failed',
        ...backgroundDispatchDiagnostics(
          new BackgroundDispatchError('auth_sessions', 'cleanup', cleanup.reason),
        ),
      }))
    } else {
      console.info(JSON.stringify({
        level: 'INFO', event: 'yandex_session_cleanup', deleted: cleanup.value.deleted,
      }))
    }
    if (push.status === 'rejected') throw push.reason
    if (appFeedback.status === 'rejected') throw appFeedback.reason
    return {
      ...push.value,
      ...(appFeedback.value === undefined ? {} : { appFeedback: appFeedback.value }),
      sessionCleanup: cleanup.status === 'fulfilled'
        ? { status: 'cleaned', deleted: cleanup.value.deleted }
        : { status: 'failed' },
    }
  }
}
