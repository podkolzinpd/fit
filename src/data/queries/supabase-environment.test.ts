import { describe, expect, it } from 'vitest'
import { assertSafeSupabaseUrl } from './supabase-environment'

describe('assertSafeSupabaseUrl', () => {
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321'])(
    'allows local Supabase during development: %s',
    (url) => {
      expect(() => assertSafeSupabaseUrl(url, true)).not.toThrow()
    },
  )

  it('rejects a remote Supabase URL during development', () => {
    expect(() => assertSafeSupabaseUrl('https://project.supabase.co', true)).toThrow(
      'Локальная разработка может использовать только локальный Supabase',
    )
  })

  it('rejects a malformed URL during development', () => {
    expect(() => assertSafeSupabaseUrl('not-a-url', true)).toThrow(
      'VITE_SUPABASE_URL содержит некорректный URL',
    )
  })

  it('allows the deployment platform to provide a remote production URL', () => {
    expect(() => assertSafeSupabaseUrl('https://project.supabase.co', false)).not.toThrow()
  })
})
