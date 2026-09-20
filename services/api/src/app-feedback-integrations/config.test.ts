import { describe, expect, it } from 'vitest'

import { readAppFeedbackIntegrationsConfig } from './config.js'

const completeEnvironment = {
  APP_FEEDBACK_TELEGRAM_BOT_TOKEN: 'telegram-token',
  APP_FEEDBACK_TELEGRAM_CHAT_ID: 'telegram-chat',
  APP_FEEDBACK_TRACKER_TOKEN: 'tracker-token',
  APP_FEEDBACK_TRACKER_ORG_ID: 'tracker-org',
}

describe('readAppFeedbackIntegrationsConfig', () => {
  it('keeps the dispatcher disabled when the Lockbox payload is absent', () => {
    expect(readAppFeedbackIntegrationsConfig({})).toBeUndefined()
  })

  it('reads a complete payload with bounded non-secret defaults', () => {
    expect(readAppFeedbackIntegrationsConfig(completeEnvironment)).toEqual({
      telegramBotToken: 'telegram-token',
      telegramChatId: 'telegram-chat',
      trackerToken: 'tracker-token',
      trackerOrganizationId: 'tracker-org',
      trackerOrganizationHeader: 'X-Org-ID',
      trackerQueue: 'YAFIT',
    })
  })

  it('rejects partial secrets and unsupported organization headers', () => {
    expect(() => readAppFeedbackIntegrationsConfig({
      APP_FEEDBACK_TELEGRAM_BOT_TOKEN: 'telegram-token',
    })).toThrow('Telegram')
    expect(() => readAppFeedbackIntegrationsConfig({
      ...completeEnvironment,
      APP_FEEDBACK_TRACKER_ORG_HEADER: 'Authorization',
    })).toThrow('ORG_HEADER')
  })

  it('allows Telegram delivery without Tracker credentials', () => {
    expect(readAppFeedbackIntegrationsConfig({
      APP_FEEDBACK_TELEGRAM_BOT_TOKEN: 'telegram-token',
      APP_FEEDBACK_TELEGRAM_CHAT_ID: 'telegram-chat',
    })).toEqual({
      telegramBotToken: 'telegram-token',
      telegramChatId: 'telegram-chat',
      trackerOrganizationHeader: 'X-Org-ID',
      trackerQueue: 'YAFIT',
    })
  })

  it('reads an optional Telegram forum topic id', () => {
    expect(readAppFeedbackIntegrationsConfig({
      ...completeEnvironment,
      APP_FEEDBACK_TELEGRAM_MESSAGE_THREAD_ID: '1',
    })?.telegramMessageThreadId).toBe(1)
  })
})
