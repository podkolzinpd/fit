import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClient = vi.hoisted(() => vi.fn(() => ({ auth: {} })))
vi.mock('@supabase/supabase-js', () => ({ createClient }))

describe('eager Supabase client compatibility rollback', () => {
  beforeEach(() => {
    vi.resetModules()
    createClient.mockClear()
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('creates one shared client during module initialization', async () => {
    const first = await import('./client')
    const second = await import('./client')
    expect(first.supabase).toBe(second.supabase)
    expect(createClient).toHaveBeenCalledOnce()
    expect(first.supabase).toBe(createClient.mock.results[0]?.value)
  })

  it.each(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'])('requires %s before startup', async (key) => {
    vi.stubEnv(key, '')
    await expect(import('./client')).rejects.toThrow('Задайте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('still rejects a remote Supabase URL during local development', async () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_SUPABASE_URL', 'https://legacy.example.test')
    await expect(import('./client')).rejects.toThrow('Локальная разработка может использовать только локальный Supabase')
    expect(createClient).not.toHaveBeenCalled()
  })
})
