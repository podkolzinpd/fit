import { beforeEach, describe, expect, it, vi } from 'vitest'

const queries = vi.hoisted(() => ({ submit: vi.fn() }))
vi.mock('../queries/app-feedback.queries', () => ({ appFeedbackQueries: queries }))

import { appDisplayMode, appFeedbackRepository, currentAppFeedbackContext } from './app-feedback.repository'

describe('appFeedbackRepository', () => {
  beforeEach(() => {
    queries.submit.mockReset()
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
    queries.submit.mockResolvedValueOnce({ data: 'feedback-id', error: null })
    await expect(appFeedbackRepository.submit('suggestion', '  Отличная идея  ')).resolves.toBe('feedback-id')
    expect(queries.submit).toHaveBeenCalledWith(expect.objectContaining({ message: 'Отличная идея' }))

    queries.submit.mockResolvedValueOnce({ data: null, error: { code: 'network_unavailable', message: 'network failed' } })
    await expect(appFeedbackRepository.submit('problem', 'Не работает')).rejects.toThrow('Проверьте интернет')
  })
})

