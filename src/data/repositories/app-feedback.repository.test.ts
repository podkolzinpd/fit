import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetYandexPlatformRequestStateForTests } from '../queries/request-diagnostics'

import { appDisplayMode, currentAppFeedbackContext } from './app-feedback-context'
import { appFeedbackRepository } from '../../test/native-backend'

describe('appFeedbackRepository', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    resetYandexPlatformRequestStateForTests()
    window.history.replaceState({}, '', '/me/profile?source=home#feedback')
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) })
  })

  it('collects route, build version and browser context automatically', () => {
    expect(currentAppFeedbackContext()).toMatchObject({
      screenPath: '/me/profile?source=home#feedback',
      appVersion: '0.1.0',
      displayMode: 'browser',
    })
  })

  it('detects the installed standalone mode', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true })) })
    expect(appDisplayMode()).toBe('standalone')
  })

  it('trims the message and maps repository failures safely', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{}', { headers: { 'x-fit-request-id': 'fixture-health' } })).mockResolvedValueOnce(new Response(JSON.stringify({ feedback: { id: '10000000-0000-4000-8000-000000000001' } }), { headers: { 'x-fit-request-id': 'fixture-submit' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(appFeedbackRepository.submit('suggestion', '  Отличная идея  ')).resolves.toBe('10000000-0000-4000-8000-000000000001')
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toMatchObject({ message: 'Отличная идея' })

    fetchMock.mockRejectedValueOnce(new TypeError('network failed'))
    await expect(appFeedbackRepository.submit('problem', 'Не работает')).rejects.toThrow('Проверьте интернет')
  })
})

