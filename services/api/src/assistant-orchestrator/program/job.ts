import { createHash, randomUUID } from 'node:crypto'
import type { ProgramBrief } from './brief.js'

type ProgramGenerationJobArgs = {
  id: string
  clientId: string
  leaseId: string
  result?: unknown
}

export type ProgramGenerationJobState = {
  status: 'claimed' | 'busy' | 'complete'
  result?: unknown
}

export interface ProgramGenerationJobStore {
  run(args: ProgramGenerationJobArgs): Promise<ProgramGenerationJobState>
  release(args: Omit<ProgramGenerationJobArgs, 'result'>): Promise<void>
}

export function programGenerationKey(actorId: string, clientId: string, brief: ProgramBrief, fingerprint: string): string {
  const entries = Object.entries(brief).sort(([a], [b]) => a.localeCompare(b))
  const hex = createHash('sha256').update(JSON.stringify(['model-plan-v6-goal-quality', actorId, clientId, entries, fingerprint])).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
export async function generateProgramOnce(
  jobs: ProgramGenerationJobStore,
  key: string,
  clientId: string,
  generate: () => Promise<unknown>,
): Promise<unknown> {
  const args = { id: key, clientId, leaseId: randomUUID() }
  const state = await jobs.run(args)
  if (state.status === 'complete') return state.result
  if (state.status !== 'claimed') throw new Error('program_generation_busy')
  try {
    const result = await generate()
    await jobs.run({ ...args, result })
    return result
  } catch (error) {
    try {
      await jobs.release(args)
    } catch (releaseError) {
      throw new AggregateError([error], 'program_job_release_failed', { cause: releaseError })
    }
    throw error
  }
}
