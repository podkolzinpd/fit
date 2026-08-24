import packageJson from '../../../package.json'
import { appFeedbackQueries } from '../queries/app-feedback.queries'
import { repositoryError } from './error'

export type AppFeedbackKind = 'suggestion' | 'problem'
export type AppDisplayMode = 'browser' | 'standalone'

export interface AppFeedbackInput {
  kind: AppFeedbackKind
  message: string
  screenPath: string
  appVersion: string
  displayMode: AppDisplayMode
  userAgent: string
}

export function appDisplayMode(): AppDisplayMode {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || ('standalone' in navigator && navigator.standalone === true)
  return standalone ? 'standalone' : 'browser'
}

export function currentAppFeedbackContext(): Omit<AppFeedbackInput, 'kind' | 'message'> {
  return {
    screenPath: `${window.location.pathname}${window.location.search}${window.location.hash}`.slice(0, 500) || '/',
    appVersion: packageJson.version,
    displayMode: appDisplayMode(),
    userAgent: navigator.userAgent.slice(0, 512) || 'unknown',
  }
}

export const appFeedbackRepository = {
  async submit(kind: AppFeedbackKind, message: string): Promise<string> {
    const result = await appFeedbackQueries.submit({ kind, message: message.trim(), ...currentAppFeedbackContext() })
    if (result.error) throw repositoryError(result.error)
    if (!result.data) throw new Error('Сообщение не было сохранено')
    return result.data
  },
}

