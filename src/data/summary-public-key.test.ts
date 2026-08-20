import { describe, expect, it } from 'vitest'
import { resolveSupabasePublicKey } from '../../supabase/functions/summarize-client-training/supabase-public-key'

describe('summary function Supabase public key', () => {
  it('uses the hosted publishable key dictionary', () => {
    expect(resolveSupabasePublicKey({
      publishableKeys: JSON.stringify({ default: 'sb_publishable_default' }),
      anonKey: 'legacy-anon',
    })).toBe('sb_publishable_default')
  })

  it('falls back to the hosted legacy anon key', () => {
    expect(resolveSupabasePublicKey({ anonKey: 'legacy-anon' })).toBe('legacy-anon')
  })

  it('keeps compatibility with the previous custom variable', () => {
    expect(resolveSupabasePublicKey({
      publishableKey: 'custom-publishable',
      publishableKeys: JSON.stringify({ default: 'hosted-publishable' }),
      anonKey: 'legacy-anon',
    })).toBe('custom-publishable')
  })

  it('uses the legacy key when the dictionary is malformed', () => {
    expect(resolveSupabasePublicKey({
      publishableKeys: '{not-json',
      anonKey: 'legacy-anon',
    })).toBe('legacy-anon')
  })

  it('returns null when no supported key exists', () => {
    expect(resolveSupabasePublicKey({})).toBeNull()
  })
})
