import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProgramBrief } from './brief.js'

export function programGenerationKey(actorId: string, clientId: string, brief: ProgramBrief, fingerprint: string): string {
  const entries = Object.entries(brief).sort(([a], [b]) => a.localeCompare(b))
  const hex = createHash('sha256').update(JSON.stringify(['model-plan-v2', actorId, clientId, entries, fingerprint])).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
export async function generateProgramOnce(service: SupabaseClient, key: string, actorId: string, clientId: string, generate: () => Promise<unknown>): Promise<unknown> {
  const args = { p_id: key, p_owner_id: actorId, p_client_id: clientId, p_lease_id: randomUUID() }
  const claim = await service.rpc('assistant_program_generation_job', args)
  if (claim.error || !claim.data || typeof claim.data !== 'object') throw new Error('program_job_unavailable')
  const state = claim.data as Record<string, unknown>
  if (state.status === 'complete') return state.result
  if (state.status !== 'claimed') throw new Error('program_generation_busy')
  const result = await generate()
  const saved = await service.rpc('assistant_program_generation_job', { ...args, p_result: result })
  if (saved.error) throw new Error('program_job_unavailable')
  return result
}
