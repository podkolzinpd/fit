import { readFileSync } from 'node:fs'

import type { PoolConfig, QueryResultRow } from 'pg'

import type { DatabaseClient } from '../db/types.js'
import { buildSupabaseSourceConfig } from './remote-rehearsal.js'

type Environment = Readonly<Record<string, string | undefined>>

export type SourceCutoverWriteGateAction = 'disable' | 'enable' | 'inspect'

export interface SourceCutoverWriteGateSettings {
  action: SourceCutoverWriteGateAction
  sourceConfig: PoolConfig
}

interface GateRow extends QueryResultRow {
  writes_paused: boolean
}

const ENABLE_CONFIRMATION = 'PAUSE_SUPABASE_PRODUCT_WRITES_FOR_CUTOVER'
const DISABLE_CONFIRMATION =
  'RESUME_SUPABASE_PRODUCT_WRITES_BEFORE_YANDEX_WRITES'

export class SourceCutoverWriteGateError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function readAction(value: string | undefined): SourceCutoverWriteGateAction {
  if (value === 'disable' || value === 'enable' || value === 'inspect') {
    return value
  }
  throw new SourceCutoverWriteGateError('action_invalid')
}

export function readSourceCutoverWriteGateSettings(
  environment: Environment,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): SourceCutoverWriteGateSettings {
  const action = readAction(environment.FIT_SOURCE_CUTOVER_WRITE_GATE_ACTION)
  const confirmation = environment.FIT_SOURCE_CUTOVER_WRITE_GATE_CONFIRMATION
  if (action === 'enable' && confirmation !== ENABLE_CONFIRMATION) {
    throw new SourceCutoverWriteGateError('enable_not_confirmed')
  }
  if (action === 'disable' && confirmation !== DISABLE_CONFIRMATION) {
    throw new SourceCutoverWriteGateError('disable_not_confirmed')
  }

  return {
    action,
    sourceConfig: buildSupabaseSourceConfig(environment, readFile),
  }
}

function readGateRow(rows: readonly GateRow[]): GateRow {
  const row = rows[0]
  if (rows.length !== 1 || row === undefined || typeof row.writes_paused !== 'boolean') {
    throw new SourceCutoverWriteGateError('gate_state_invalid')
  }
  return row
}

export async function applySourceCutoverWriteGate(
  database: DatabaseClient,
  action: SourceCutoverWriteGateAction,
): Promise<boolean> {
  const rows = action === 'inspect'
    ? await database.query<GateRow>(`
        select writes_paused
        from private.source_cutover_write_gate
        where singleton
      `)
    : await database.query<GateRow>(
        `select private.set_source_cutover_write_gate($1) as writes_paused`,
        [action === 'enable'],
      )
  const writesPaused = readGateRow(rows).writes_paused
  if (action === 'enable' && !writesPaused) {
    throw new SourceCutoverWriteGateError('enable_failed')
  }
  if (action === 'disable' && writesPaused) {
    throw new SourceCutoverWriteGateError('disable_failed')
  }
  return writesPaused
}
