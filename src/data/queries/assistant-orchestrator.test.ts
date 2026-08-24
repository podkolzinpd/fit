import { describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({ supabase: { auth: { getSession: vi.fn() } } }))

import { resolveAssistantOrchestratorUrl } from './assistant-orchestrator'

describe('assistant orchestrator endpoint', () => {
  it('uses the deployed Cloud Function in production instead of a stale Vercel override', () => {
    expect(resolveAssistantOrchestratorUrl(true, 'https://stale.example.test'))
      .toBe('https://functions.yandexcloud.net/d4emhmr9v0qist9dbcml')
  })

  it('keeps the function invocation path in a valid production URL', () => {
    expect(resolveAssistantOrchestratorUrl(true, ''))
      .toBe('https://functions.yandexcloud.net/d4emhmr9v0qist9dbcml')
  })

  it('allows an explicit endpoint for local development', () => {
    expect(resolveAssistantOrchestratorUrl(false, 'http://localhost:8080/')).toBe('http://localhost:8080')
  })
})
