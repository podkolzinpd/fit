import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateProgramOnce, programGenerationKey } from './job.js'

it('concurrent turns share one claimed generation and retries read its cache', async () => {
  let claimed = false
  let cached: unknown
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
    await Promise.resolve()
    if (args.p_result) { cached = args.p_result; return { data: { status: 'complete', result: cached }, error: null } }
    if (cached) return { data: { status: 'complete', result: cached }, error: null }
    if (claimed) return { data: { status: 'busy' }, error: null }
    claimed = true; return { data: { status: 'claimed' }, error: null }
  })
  const service = { rpc } as unknown as SupabaseClient
  const generate = vi.fn(() => Promise.resolve({ sessions: ['verified'] }))
  const results = await Promise.allSettled([1, 2].map(() => generateProgramOnce(service, 'key', 'actor', 'client', generate)))
  expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
  expect(generate).toHaveBeenCalledOnce()
  expect(await generateProgramOnce(service, 'key', 'actor', 'client', generate)).toEqual({ sessions: ['verified'] })
  expect(generate).toHaveBeenCalledOnce()
})
it('binds job identity to actor, client, brief and source without property-order drift', () => {
  const key = programGenerationKey('a', 'c', { frequency: 2, durationMin: 60 }, 'source')
  expect(programGenerationKey('a', 'c', { durationMin: 60, frequency: 2 }, 'source')).toBe(key)
  expect(programGenerationKey('other', 'c', { frequency: 2, durationMin: 60 }, 'source')).not.toBe(key)
  expect(programGenerationKey('a', 'c', { frequency: 2, durationMin: 60 }, 'changed')).not.toBe(key)
})

it('releases a failed attempt immediately and allows the next turn to generate', async () => {
  let busy = false
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    await Promise.resolve()
    if (name === 'release_assistant_program_generation_job') { busy = false; return { data: true, error: null } }
    if (args.p_result) return { data: { status: 'complete' }, error: null }
    if (busy) return { data: { status: 'busy' }, error: null }
    busy = true
    return { data: { status: 'claimed' }, error: null }
  })
  const service = { rpc } as unknown as SupabaseClient
  const generate = vi.fn().mockRejectedValueOnce(new Error('program_validation_failed')).mockResolvedValueOnce({ ok: true })
  await expect(generateProgramOnce(service, 'key', 'actor', 'client', generate)).rejects.toThrow('program_validation_failed')
  expect(rpc.mock.calls[1]?.[1]).toEqual(rpc.mock.calls[0]?.[1])
  await expect(generateProgramOnce(service, 'key', 'actor', 'client', generate)).resolves.toEqual({ ok: true })
  expect(generate).toHaveBeenCalledTimes(2)
})
