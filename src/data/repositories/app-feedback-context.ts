import packageJson from '../../../package.json'

export type AppFeedbackKind = 'suggestion' | 'problem' | 'training program'
export type AppDisplayMode = 'browser' | 'standalone'

export interface AppFeedbackInput {
  kind: AppFeedbackKind
  message: string
  screenPath: string
  appVersion: string
  displayMode: AppDisplayMode
  userAgent: string
  modelInputJson?: Record<string, unknown>
  modelOutputJson?: Record<string, unknown>
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

