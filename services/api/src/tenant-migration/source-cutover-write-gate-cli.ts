import { PgDatabasePool } from '../db/pg-pool.js'
import {
  applySourceCutoverWriteGate,
  readSourceCutoverWriteGateSettings,
  SourceCutoverWriteGateError,
} from './source-cutover-write-gate.js'

let pool: PgDatabasePool | undefined

try {
  const settings = readSourceCutoverWriteGateSettings(process.env)
  pool = new PgDatabasePool(settings.sourceConfig)
  const connection = await pool.connect()
  try {
    const writesPaused = await applySourceCutoverWriteGate(
      connection,
      settings.action,
    )
    process.stdout.write(
      `source_cutover_write_gate: ${writesPaused ? 'paused' : 'open'}\n`,
    )
  } finally {
    connection.release()
  }
} catch (error) {
  const code = error instanceof SourceCutoverWriteGateError
    ? error.code
    : 'unexpected_failure'
  process.stderr.write(`Source cutover write gate failed: ${code}\n`)
  process.exitCode = 1
} finally {
  await pool?.end()
}
