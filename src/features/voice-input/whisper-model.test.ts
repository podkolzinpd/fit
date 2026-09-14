import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWhisperModelUrl, WHISPER_MODEL_BYTES } from './whisper-model'

describe('Whisper model location', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('builds an immutable public Storage URL from the configured project', () => {
    vi.stubEnv('VITE_SUPABASE_URL', ' https://fit-test.supabase.co/ ')

    expect(getWhisperModelUrl()).toBe(
      'https://fit-test.supabase.co/storage/v1/object/public/fit-public-models/whisper/ggml-base-q5_1-5359861c739e955e79d9a303bcbc70fb988958b1.bin',
    )
    expect(WHISPER_MODEL_BYTES).toBe(59_707_625)
  })

  it('fails closed when the project URL is absent', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    expect(() => getWhisperModelUrl()).toThrow('VITE_SUPABASE_URL')
  })
})
