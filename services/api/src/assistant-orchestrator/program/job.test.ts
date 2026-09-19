import { expect, it, vi } from 'vitest'
import { generateProgramOnce, programGenerationKey, type ProgramGenerationJobStore } from './job.js'

it('concurrent turns share one claimed generation and retries read its cache', async () => {
  let claimed = false
  let cached: unknown
  const run = vi.fn(async (args: { result?: unknown }) => {
    await Promise.resolve()
    if (args.result) { cached = args.result; return { status: 'complete' as const, result: cached } }
    if (cached) return { status: 'complete' as const, result: cached }
    if (claimed) return { status: 'busy' as const }
    claimed = true; return { status: 'claimed' as const }
  })
  const jobs = { run, release: vi.fn() } satisfies ProgramGenerationJobStore
  const generate = vi.fn(() => Promise.resolve({ sessions: ['verified'] }))
  const results = await Promise.allSettled([1, 2].map(() => generateProgramOnce(jobs, 'key', 'client', generate)))
  expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
  expect(generate).toHaveBeenCalledOnce()
  expect(await generateProgramOnce(jobs, 'key', 'client', generate)).toEqual({ sessions: ['verified'] })
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
  const run = vi.fn(async (args: { result?: unknown }) => {
    await Promise.resolve()
    if (args.result) return { status: 'complete' as const }
    if (busy) return { status: 'busy' as const }
    busy = true; return { status: 'claimed' as const }
  })
  const release = vi.fn(() => {
    busy = false
    return Promise.resolve()
  })
  const jobs = { run, release } satisfies ProgramGenerationJobStore
  const generate = vi.fn().mockRejectedValueOnce(new Error('program_validation_failed')).mockResolvedValueOnce({ ok: true })
  await expect(generateProgramOnce(jobs, 'key', 'client', generate)).rejects.toThrow('program_validation_failed')
  expect(release).toHaveBeenCalledOnce()
  await expect(generateProgramOnce(jobs, 'key', 'client', generate)).resolves.toEqual({ ok: true })
  expect(generate).toHaveBeenCalledTimes(2)
})
