import { currentAppFeedbackContext, type AppFeedbackInput, type AppFeedbackKind } from './app-feedback-context'
import { appFeedbackQueries } from '../queries/app-feedback.queries'
import { repositoryError } from './error'

export { appDisplayMode, currentAppFeedbackContext } from './app-feedback-context'
export type { AppFeedbackInput, AppFeedbackKind, AppDisplayMode } from './app-feedback-context'

export const appFeedbackRepository = {
  async submit(kind: AppFeedbackKind, message: string, metadata?: Pick<AppFeedbackInput, 'modelInputJson' | 'modelOutputJson'>): Promise<string> {
    const result = await appFeedbackQueries.submit({ kind, message: message.trim(), ...currentAppFeedbackContext(), ...metadata })
    if (result.error) throw repositoryError(result.error)
    if (!result.data) throw new Error('Сообщение не было сохранено')
    return result.data
  },
}
