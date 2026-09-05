export type AppFeedbackDeliveryInput = {
  id: string
  accountRole: 'trainer' | 'client'
  kind: 'suggestion' | 'problem'
  message: string
  screenPath: string
  appVersion: string
  displayMode: 'browser' | 'standalone'
  createdAt: string
  sendTracker: boolean
  sendTelegram: boolean
}

export type AppFeedbackProviderResult =
  | { ok: true; issueKey?: string }
  | { ok: false; error: string }

export type AppFeedbackDeliveryResult = {
  id: string
  tracker?: AppFeedbackProviderResult
  telegram?: AppFeedbackProviderResult
}

export interface AppFeedbackSender {
  send(
    deliveries: readonly AppFeedbackDeliveryInput[],
  ): Promise<AppFeedbackDeliveryResult[]>
}

type Fetch = typeof fetch

export interface AppFeedbackIntegrationsConfig {
  telegramBotToken: string
  telegramChatId: string
  trackerToken: string
  trackerOrganizationId: string
  trackerOrganizationHeader: 'X-Org-ID' | 'X-Cloud-Org-ID'
  trackerQueue: string
}

const TRACKER_URL = 'https://api.tracker.yandex.net/v3/issues/'

function stableHttpError(provider: 'telegram' | 'tracker', status: number): string {
  return `${provider}_http_${String(status)}`
}

function trimMessage(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : 'unknown'
}

function formatTelegramMessage(delivery: AppFeedbackDeliveryInput): string {
  const title = delivery.kind === 'problem' ? 'Проблема' : 'Пожелание'
  return trimMessage(
    `${title} · ${formatTimestamp(delivery.createdAt)}\n`
      + `Роль: ${delivery.accountRole} · Экран: ${delivery.screenPath}\n`
      + `Версия: ${delivery.appVersion} · Режим: ${delivery.displayMode}\n\n`
      + `${delivery.message}\n\nКод сообщения: ${delivery.id}`,
    4_000,
  )
}

function formatTrackerDescription(delivery: AppFeedbackDeliveryInput): string {
  return `Роль: ${delivery.accountRole}\n`
    + `Экран: ${delivery.screenPath}\n`
    + `Версия приложения: ${delivery.appVersion}\n`
    + `Режим: ${delivery.displayMode}\n`
    + `Отправлено: ${formatTimestamp(delivery.createdAt)}\n`
    + `Код сообщения: ${delivery.id}\n\n`
    + delivery.message
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function readIssueKey(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const key = (value as Record<string, unknown>).key
  return typeof key === 'string' && key.trim() !== '' ? key.trim() : null
}

export class HttpAppFeedbackSender implements AppFeedbackSender {
  constructor(
    private readonly config: AppFeedbackIntegrationsConfig,
    private readonly fetch_: Fetch = fetch,
  ) {
    if (config.telegramBotToken.trim().length < 10) {
      throw new Error('APP_FEEDBACK_TELEGRAM_BOT_TOKEN is invalid')
    }
    if (config.telegramChatId.trim() === '') {
      throw new Error('APP_FEEDBACK_TELEGRAM_CHAT_ID is required')
    }
    if (config.trackerToken.trim().length < 10) {
      throw new Error('APP_FEEDBACK_TRACKER_TOKEN is invalid')
    }
    if (config.trackerOrganizationId.trim() === '') {
      throw new Error('APP_FEEDBACK_TRACKER_ORG_ID is required')
    }
    if (!/^[A-Z][A-Z0-9_]{1,19}$/u.test(config.trackerQueue)) {
      throw new Error('APP_FEEDBACK_TRACKER_QUEUE is invalid')
    }
  }

  private async sendTracker(
    delivery: AppFeedbackDeliveryInput,
  ): Promise<AppFeedbackProviderResult> {
    try {
      const response = await this.fetch_(TRACKER_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(8_000),
        headers: {
          authorization: `OAuth ${this.config.trackerToken}`,
          'content-type': 'application/json',
          [this.config.trackerOrganizationHeader]: this.config.trackerOrganizationId,
        },
        body: JSON.stringify({
          queue: this.config.trackerQueue,
          summary: trimMessage(
            `[app-feedback/${delivery.kind}] ${delivery.message}`,
            200,
          ),
          description: formatTrackerDescription(delivery),
          type: 'task',
          tags: ['app-feedback', `app-feedback-${delivery.kind}`],
          unique: delivery.id,
        }),
      })
      const body = await readJson(response)
      if (response.ok) {
        const issueKey = readIssueKey(body)
        return issueKey === null
          ? { ok: false, error: 'tracker_response_invalid' }
          : { ok: true, issueKey }
      }
      // Tracker guarantees uniqueness for the `unique` field. A retry after a
      // lost response returns 409 and must be terminal to avoid a duplicate.
      if (response.status === 409) {
        return { ok: true, issueKey: `deduplicated:${delivery.id}` }
      }
      return { ok: false, error: stableHttpError('tracker', response.status) }
    } catch {
      return { ok: false, error: 'tracker_unavailable' }
    }
  }

  private async sendTelegram(
    delivery: AppFeedbackDeliveryInput,
  ): Promise<AppFeedbackProviderResult> {
    try {
      const response = await this.fetch_(
        `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(8_000),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.config.telegramChatId,
            text: formatTelegramMessage(delivery),
            disable_web_page_preview: true,
          }),
        },
      )
      if (!response.ok) {
        return { ok: false, error: stableHttpError('telegram', response.status) }
      }
      const body = await readJson(response)
      if (
        typeof body !== 'object'
        || body === null
        || Array.isArray(body)
        || (body as Record<string, unknown>).ok !== true
      ) {
        return { ok: false, error: 'telegram_response_invalid' }
      }
      return { ok: true }
    } catch {
      return { ok: false, error: 'telegram_unavailable' }
    }
  }

  async send(
    deliveries: readonly AppFeedbackDeliveryInput[],
  ): Promise<AppFeedbackDeliveryResult[]> {
    if (deliveries.length === 0 || deliveries.length > 20) {
      throw new Error('App feedback batch must contain between 1 and 20 deliveries')
    }
    if (new Set(deliveries.map((delivery) => delivery.id)).size !== deliveries.length) {
      throw new Error('App feedback batch contains duplicate ids')
    }
    if (deliveries.some((delivery) => !delivery.sendTracker && !delivery.sendTelegram)) {
      throw new Error('App feedback batch contains an empty delivery')
    }

    return Promise.all(deliveries.map(async (delivery) => {
      const [tracker, telegram] = await Promise.all([
        delivery.sendTracker ? this.sendTracker(delivery) : undefined,
        delivery.sendTelegram ? this.sendTelegram(delivery) : undefined,
      ])
      return {
        id: delivery.id,
        ...(tracker === undefined ? {} : { tracker }),
        ...(telegram === undefined ? {} : { telegram }),
      }
    }))
  }
}
