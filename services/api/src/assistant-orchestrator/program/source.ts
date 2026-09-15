import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildTrainingGoalContext } from '../../legacy-summary/summary-goal.js'
import { buildProgramHistoryContext, type ProgramContextSource } from './context.js'
import { addDays } from './generate.js'

type Row = Record<string, unknown>
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('program_source_invalid')
  return value as Row[]
}
function string(row: Row, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error('program_source_invalid')
  return value
}
function numberOrNull(row: Row, key: string): number | null {
  if (row[key] === null || row[key] === undefined) return null
  const value = typeof row[key] === 'number' ? row[key] : typeof row[key] === 'string' && row[key].trim() ? Number(row[key]) : NaN
  if (!Number.isFinite(value)) throw new Error('program_source_invalid')
  return value
}

async function pages(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  const result: Row[] = []
  for (let offset = 0; offset <= 10_000; offset += 100) {
    const response = await read(offset, offset + 99)
    if (response.error) throw new Error('program_context_unavailable')
    const batch = rows(response.data)
    result.push(...batch)
    if (result.length > 10_000) throw new Error('program_source_limit_reached')
    if (batch.length < 100) return result
  }
  throw new Error('program_source_limit_reached')
}

/** Uses the actor JWT throughout, including connected-client access through RLS. */
export async function loadProgramContext(actor: SupabaseClient, client: { id: string; ageYears: number | null; goal: string | null }, today: string) {
  const capturedAt = new Date().toISOString()
  const periodStart = addDays(today, -55)
  const workoutRows = await pages((from, to) => actor.from('workouts')
    .select('id,client_id,workout_date,status,deleted_at,session_rpe,wellbeing,discomfort')
    .eq('client_id', client.id).eq('status', 'done').is('deleted_at', null)
    .gte('workout_date', periodStart).lte('workout_date', today).order('id').range(from, to))
  const workoutIds = workoutRows.map((row) => string(row, 'id'))
  const exerciseRows = workoutIds.length ? await pages((from, to) => actor.from('workout_exercises')
    .select('id,workout_id,exercise_source,exercise_ref,position').in('workout_id', workoutIds).order('id').range(from, to)) : []
  const setRows: Row[] = []
  for (let index = 0; index < exerciseRows.length; index += 100) {
    const ids = exerciseRows.slice(index, index + 100).map((row) => string(row, 'id'))
    setRows.push(...await pages((from, to) => actor.from('workout_sets')
      .select('id,workout_exercise_id,position,confirmed_at,fact_reps,fact_weight_kg,fact_duration_sec,fact_duration_min,fact_distance_km,fact_rpe')
      .in('workout_exercise_id', ids).order('id').range(from, to)))
    if (setRows.length > 10_000) throw new Error('program_source_limit_reached')
  }
  const source: ProgramContextSource = {
    clientId: client.id, periodStart, periodEnd: today,
    workouts: workoutRows.map((row) => ({ id: string(row, 'id'), clientId: string(row, 'client_id'), date: string(row, 'workout_date'),
      status: 'done', deletedAt: null, sessionRpe: numberOrNull(row, 'session_rpe'),
      wellbeing: row.wellbeing === 'good' || row.wellbeing === 'normal' || row.wellbeing === 'hard' ? row.wellbeing : null,
      discomfort: typeof row.discomfort === 'boolean' ? row.discomfort : null,
    })),
    exercises: exerciseRows.map((row) => {
      if (row.exercise_source !== 'system' && row.exercise_source !== 'custom') throw new Error('program_source_invalid')
      return { id: string(row, 'id'), workoutId: string(row, 'workout_id'), source: row.exercise_source,
        ref: string(row, 'exercise_ref'), position: numberOrNull(row, 'position') ?? 0 }
    }),
    sets: setRows.map((row) => ({ id: string(row, 'id'), exerciseId: string(row, 'workout_exercise_id'), position: numberOrNull(row, 'position') ?? 0,
      confirmedAt: typeof row.confirmed_at === 'string' ? row.confirmed_at : null,
      factReps: numberOrNull(row, 'fact_reps'), factWeightKg: numberOrNull(row, 'fact_weight_kg'),
      factDurationSec: numberOrNull(row, 'fact_duration_sec') ?? (row.fact_duration_min == null ? null : numberOrNull(row, 'fact_duration_min')! * 60),
      factDistanceKm: numberOrNull(row, 'fact_distance_km'), factRpe: numberOrNull(row, 'fact_rpe'),
    })),
  }
  const result = buildProgramHistoryContext(source)
  const [goal, measurement] = await Promise.all([
    actor.rpc('get_client_goal', { p_client_id: client.id }),
    actor.from('client_progress').select('recorded_on,weight_kg').eq('client_id', client.id).is('deleted_at', null)
      .lte('recorded_on', today).order('recorded_on', { ascending: false }).order('id', { ascending: false }).limit(1),
  ])
  if (goal.error || measurement.error) throw new Error('program_context_unavailable')
  const latest = rows(measurement.data)[0]
  const profile = { ageYears: client.ageYears, goal: buildTrainingGoalContext(client.goal, goal.data, today),
    latestWeight: latest ? { date: string(latest, 'recorded_on'), weightKg: numberOrNull(latest, 'weight_kg') } : null }
  return { ...result, capturedAt, profile, fingerprint: createHash('sha256').update(JSON.stringify([result.fingerprint, profile])).digest('hex') }
}

