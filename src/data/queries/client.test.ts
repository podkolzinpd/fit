import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ auth: {}, rpc: vi.fn(), from: vi.fn(),
  storage: { from: vi.fn() } }))
const createClient = vi.hoisted(() => vi.fn(() => sdk))
vi.mock('@supabase/supabase-js', () => ({ createClient }))

describe('local-only lazy Supabase transport', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('MODE', 'test')
    vi.stubEnv('PROD', false)
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('imports client and both media buckets without constructing the SDK', async () => {
    const first = await import('./client')
    const second = await import('./client')
    await import('./chat.queries')
    await import('./exercises.queries')
    expect(first.supabase).toBe(second.supabase)
    expect(createClient).not.toHaveBeenCalled()
    expect(sdk.storage.from).not.toHaveBeenCalled()
  })

  it('creates exactly one configured client for explicit local legacy operations', async () => {
    const { supabase } = await import('./client')
    expect(supabase.auth).toBe(sdk.auth)
    expect(supabase.auth).toBe(sdk.auth)
    supabase.rpc('list_chat_threads')
    expect(sdk.rpc).toHaveBeenCalledWith('list_chat_threads')
    expect(sdk.rpc.mock.contexts).toEqual([sdk])
    expect(createClient).toHaveBeenCalledOnce()
    expect(createClient).toHaveBeenCalledWith('http://127.0.0.1:54321', 'test-publishable-key', expect.objectContaining({
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    }))
  })

  it('opens the named media buckets only when an operation is requested', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const sign = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://media.example.test/fixture' }, error: null })
    sdk.storage.from.mockReturnValue({ upload, createSignedUrl: sign })
    const { chatMedia } = await import('./chat.queries')
    const { customExerciseMedia } = await import('./exercises.queries')
    expect(createClient).not.toHaveBeenCalled()
    const image = new Blob(['fixture'])
    await chatMedia.upload('fixture.jpg', image)
    await customExerciseMedia.createSignedUrl('fixture.jpg', 3600)
    expect(sdk.storage.from.mock.calls).toEqual([['chat-media'], ['custom-exercise-media']])
    expect(upload).toHaveBeenCalledWith('fixture.jpg', image)
    expect(sign).toHaveBeenCalledWith('fixture.jpg', 3600)
    expect(createClient).toHaveBeenCalledOnce()
  })

  it.each(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'])('allows imports without %s and rejects an accidental legacy operation', async (key) => {
    vi.stubEnv(key, '')
    const { supabase } = await import('./client')
    await import('./chat.queries')
    await import('./exercises.queries')
    expect(() => supabase.auth).toThrow('Локальный Supabase не настроен')
    expect(createClient).not.toHaveBeenCalled()
  })

  it.each([false, true])('never constructs a production SDK, including stale env=%s', async (configured) => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('PROD', true)
    vi.stubEnv('DEV', false)
    if (!configured) {
      vi.stubEnv('VITE_SUPABASE_URL', '')
      vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    }
    const { supabase } = await import('./client')
    await import('./chat.queries')
    await import('./exercises.queries')
    expect(createClient).not.toHaveBeenCalled()
    expect(() => supabase.auth).toThrow('Устаревший источник данных недоступен')
    expect(() => supabase.rpc('list_chat_threads')).toThrow('Устаревший источник данных недоступен')
    expect(createClient).not.toHaveBeenCalled()
  })

  it.each(['development', 'test'])('keeps explicit local %s builds available when Vite sets PROD=true', async (mode) => {
    vi.stubEnv('MODE', mode)
    vi.stubEnv('PROD', true)
    vi.stubEnv('DEV', false)
    const { supabase } = await import('./client')
    expect(supabase.auth).toBe(sdk.auth)
    expect(createClient).toHaveBeenCalledOnce()
  })

  it('rejects remote legacy config in an explicit local native build', async () => {
    vi.stubEnv('MODE', 'development')
    vi.stubEnv('PROD', true)
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_SUPABASE_URL', 'https://legacy.example.test')
    const { supabase } = await import('./client')
    expect(() => supabase.auth).toThrow('Локальная разработка может использовать только локальный Supabase')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('fails closed for an unknown release mode', async () => {
    vi.stubEnv('MODE', 'custom-release')
    const { supabase } = await import('./client')
    expect(() => supabase.auth).toThrow('Устаревший источник данных недоступен')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('still rejects a remote Supabase URL during local development', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://legacy.example.test')
    const { supabase } = await import('./client')
    expect(() => supabase.auth).toThrow('Локальная разработка может использовать только локальный Supabase')
    expect(createClient).not.toHaveBeenCalled()
  })
})
