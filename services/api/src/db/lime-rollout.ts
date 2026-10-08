import type { QueryResultRow } from 'pg'
import type { DatabasePool } from './types.js'

export type LimeRolloutTarget = 'client' | 'trainer' | 'trainer-schedule'
export type LimeRolloutMode = 'pilot' | 'all' | 'off'
export interface LimeRolloutState {
  clientMode: LimeRolloutMode
  trainerMode: LimeRolloutMode
  scheduleMode: LimeRolloutMode
  revision: number
}
export type LimeRolloutCommand =
  | { target: LimeRolloutTarget; mode: 'inspect' }
  | { target: LimeRolloutTarget; mode: LimeRolloutMode; expectedRevision: number }
export interface LimeRolloutManager {
  apply(command: LimeRolloutCommand): Promise<LimeRolloutState>
}
export class LimeRolloutConflictError extends Error {
  constructor() { super('Lime rollout revision or schedule dependency conflict') }
}
interface StateRow extends QueryResultRow {
  client_mode: LimeRolloutMode
  trainer_mode: LimeRolloutMode
  schedule_mode: LimeRolloutMode
  revision: number
}
function isMode(value: unknown): value is LimeRolloutMode {
  return value === 'pilot' || value === 'all' || value === 'off'
}
export function limeRolloutConfirmation(target: LimeRolloutTarget, mode: LimeRolloutMode): string {
  return `SET_${target.replace('-', '_').toUpperCase()}_LIME_${mode.toUpperCase()}`
}
export function readLimeRolloutCommand(body: unknown): LimeRolloutCommand | undefined {
  if (typeof body !== 'object' || body === null || !('target' in body) || !('mode' in body)) return undefined
  const { target, mode } = body
  if (target !== 'client' && target !== 'trainer' && target !== 'trainer-schedule') return undefined
  if (mode === 'inspect') {
    return Object.keys(body).length === 2 ? { target, mode } : undefined
  }
  if (!isMode(mode) || Object.keys(body).length !== 4
    || !('expectedRevision' in body) || typeof body.expectedRevision !== 'number'
    || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0
    || body.expectedRevision >= 2_147_483_647
    || !('confirmation' in body) || body.confirmation !== limeRolloutConfirmation(target, mode)) return undefined
  return { target, mode, expectedRevision: body.expectedRevision }
}

// This pool belongs exclusively to the IAM-protected migration container.
export class DatabaseLimeRolloutManager implements LimeRolloutManager {
  constructor(private readonly pool: DatabasePool) {}
  async apply(command: LimeRolloutCommand): Promise<LimeRolloutState> {
    const connection = await this.pool.connect()
    try {
      const rows = command.mode === 'inspect'
        ? await connection.query<StateRow>('select client_mode, trainer_mode, schedule_mode, revision from app_private.lime_rollout_controls where singleton')
        : await connection.query<StateRow>('select * from app_private.set_lime_rollout_mode($1, $2, $3)',
          [command.target, command.mode, command.expectedRevision])
      const row = rows[0]
      if (rows.length !== 1 || row === undefined || !isMode(row.client_mode)
        || !isMode(row.trainer_mode) || !isMode(row.schedule_mode)
        || !Number.isSafeInteger(row.revision) || row.revision < 0
        || (row.trainer_mode === 'all' && row.schedule_mode !== 'all')) throw new Error('Invalid Lime rollout state')
      return { clientMode: row.client_mode, trainerMode: row.trainer_mode, scheduleMode: row.schedule_mode, revision: row.revision }
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'PT409') throw new LimeRolloutConflictError()
      throw error
    } finally { connection.release() }
  }
}
