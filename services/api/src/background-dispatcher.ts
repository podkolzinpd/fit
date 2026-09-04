import type { AppFeedbackDispatchSummary } from './app-feedback-dispatcher.js'
import type { PushDispatchSummary } from './push-dispatcher.js'

interface Dispatcher<Summary> {
  run(now?: Date): Promise<Summary>
}

export interface BackgroundDispatchSummary extends PushDispatchSummary {
  appFeedback: AppFeedbackDispatchSummary
}

export class BackgroundDispatcher {
  constructor(
    private readonly push: Dispatcher<PushDispatchSummary>,
    private readonly appFeedback: Dispatcher<AppFeedbackDispatchSummary>,
  ) {}

  async run(now = new Date()): Promise<BackgroundDispatchSummary> {
    const [push, appFeedback] = await Promise.all([
      this.push.run(now),
      this.appFeedback.run(now),
    ])
    return { ...push, appFeedback }
  }
}
