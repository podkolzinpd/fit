import type { AppFeedbackIntegrationsConfig } from './sender.js'

const SECRET_NAMES = [
  'APP_FEEDBACK_TELEGRAM_BOT_TOKEN',
  'APP_FEEDBACK_TELEGRAM_CHAT_ID',
  'APP_FEEDBACK_TRACKER_TOKEN',
  'APP_FEEDBACK_TRACKER_ORG_ID',
] as const

export function readAppFeedbackIntegrationsConfig(
  environment: Readonly<Record<string, string | undefined>>,
): AppFeedbackIntegrationsConfig | undefined {
  const values = SECRET_NAMES.map((name) => environment[name]?.trim() ?? '')
  if (values.every((value) => value === '')) return undefined
  if (values.some((value) => value === '')) {
    throw new Error('App feedback integration secrets must be configured together')
  }

  const organizationHeader = environment.APP_FEEDBACK_TRACKER_ORG_HEADER?.trim()
    || 'X-Org-ID'
  if (organizationHeader !== 'X-Org-ID' && organizationHeader !== 'X-Cloud-Org-ID') {
    throw new Error('APP_FEEDBACK_TRACKER_ORG_HEADER is invalid')
  }

  return {
    telegramBotToken: values[0]!,
    telegramChatId: values[1]!,
    trackerToken: values[2]!,
    trackerOrganizationId: values[3]!,
    trackerOrganizationHeader: organizationHeader,
    trackerQueue: environment.APP_FEEDBACK_TRACKER_QUEUE?.trim() || 'YAFIT',
  }
}
