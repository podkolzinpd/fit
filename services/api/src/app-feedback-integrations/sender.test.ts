import { describe, expect, it, vi } from 'vitest'

import { HttpAppFeedbackSender } from './sender.js'

const delivery = {
  id: '780e135d-b64e-4415-a934-3c649236808b',
  accountRole: 'trainer' as const,
  kind: 'problem' as const,
  message: 'Не сохраняется результат тренировки',
  screenPath: '/trainer/workouts/one',
  appVersion: 'release-1',
  displayMode: 'browser' as const,
  createdAt: '2026-09-04T12:00:00.000Z',
  sendTracker: true,
  sendTelegram: true,
}

const config = {
  telegramBotToken: 'telegram-token',
  telegramChatId: 'telegram-chat',
  trackerToken: 'tracker-token',
  trackerOrganizationId: 'tracker-org',
  trackerOrganizationHeader: 'X-Cloud-Org-ID' as const,
  trackerQueue: 'YAFIT',
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

describe('HttpAppFeedbackSender', () => {
  it('sends one bounded delivery to Tracker and Telegram', async () => {
    const fetch_: typeof fetch = vi.fn((input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input)
      return Promise.resolve(url.includes('tracker')
        ? new Response(JSON.stringify({ key: 'YAFIT-42' }), { status: 201 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })
    const sender = new HttpAppFeedbackSender(config, fetch_)

    await expect(sender.send([delivery])).resolves.toEqual([{
      id: delivery.id,
      tracker: { ok: true, issueKey: 'YAFIT-42' },
      telegram: { ok: true },
    }])
    expect(fetch_).toHaveBeenCalledTimes(2)

    const trackerCall = vi.mocked(fetch_).mock.calls.find(
      ([input]) => requestUrl(input).includes('tracker.yandex.net'),
    )
    expect(trackerCall?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: {
        authorization: 'OAuth tracker-token',
        'content-type': 'application/json',
        'X-Cloud-Org-ID': 'tracker-org',
      },
    }))
    const trackerBody = trackerCall?.[1]?.body
    if (typeof trackerBody !== 'string') throw new Error('Expected Tracker JSON body')
    expect(JSON.parse(trackerBody)).toEqual(expect.objectContaining({
      queue: 'YAFIT',
      unique: delivery.id,
    }))
  })

  it('calls only providers still pending for a delivery', async () => {
    const fetch_: typeof fetch = vi.fn(() => Promise.resolve(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ))
    const sender = new HttpAppFeedbackSender(config, fetch_)

    await expect(sender.send([{
      ...delivery,
      sendTracker: false,
    }])).resolves.toEqual([{
      id: delivery.id,
      telegram: { ok: true },
    }])
    expect(fetch_).toHaveBeenCalledOnce()
    const call = vi.mocked(fetch_).mock.calls[0]
    if (call === undefined) throw new Error('Expected a Telegram request')
    expect(requestUrl(call[0])).toContain('api.telegram.org')
  })

  it('treats Tracker unique conflicts as delivered and sanitizes failures', async () => {
    const fetch_: typeof fetch = vi.fn((input: Parameters<typeof fetch>[0]) => Promise.resolve(
      requestUrl(input).includes('tracker')
        ? new Response('{}', { status: 409 })
        : new Response('{"ok":false,"description":"private"}', { status: 403 }),
    ))
    const sender = new HttpAppFeedbackSender(config, fetch_)

    await expect(sender.send([delivery])).resolves.toEqual([{
      id: delivery.id,
      tracker: { ok: true, issueKey: `deduplicated:${delivery.id}` },
      telegram: { ok: false, error: 'telegram_http_403' },
    }])
  })

  it('rejects malformed configuration and empty delivery batches', async () => {
    expect(() => new HttpAppFeedbackSender({
      ...config,
      trackerQueue: 'not valid',
    })).toThrow('TRACKER_QUEUE')
    const sender = new HttpAppFeedbackSender(config)
    await expect(sender.send([])).rejects.toThrow('between 1 and 20')
    await expect(sender.send([{
      ...delivery,
      sendTracker: false,
      sendTelegram: false,
    }])).rejects.toThrow('empty delivery')
  })
})
