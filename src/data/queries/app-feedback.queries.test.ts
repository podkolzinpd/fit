import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./client', () => ({ supabase: { rpc } }))

import { appFeedbackQueries } from './app-feedback.queries'

describe('appFeedbackQueries', () => {
  beforeEach(() => rpc.mockReset())

  it('sends the message and automatic context through one RPC', () => {
    const response = Promise.resolve({ data: 'feedback-id', error: null })
    rpc.mockReturnValue(response)
    const input = {
      kind: 'problem' as const,
      message: 'Не открывается тренировка',
      screenPath: '/profile?from=home',
      appVersion: '0.1.0',
      displayMode: 'standalone' as const,
      userAgent: 'Mobile Safari',
    }

    expect(appFeedbackQueries.submit(input)).toBe(response)
    expect(rpc).toHaveBeenCalledWith('submit_app_feedback', {
      p_kind: 'problem',
      p_message: 'Не открывается тренировка',
      p_screen_path: '/profile?from=home',
      p_app_version: '0.1.0',
      p_display_mode: 'standalone',
      p_user_agent: 'Mobile Safari',
    })
  })
})

