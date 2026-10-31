import { pathToFileURL } from 'node:url'
import { buildLimeRolloutRequest, verifyLimeRolloutResponse, verifyLimeRolloutReadback } from './lime-rollout-request.mjs'

export function readClientLimeOperation(env) {
  if (env.GITHUB_REPOSITORY !== 'podkolzinpd/fit' || env.GITHUB_REF !== 'refs/heads/main'
      || env.LIME_TARGET !== 'client') throw new Error('client_rollout_environment_invalid')
  return buildLimeRolloutRequest(env)
}

export async function runClientLimeOperation(manager, env) {
  const request = readClientLimeOperation(env)
  const inspect = { target: 'client', mode: 'inspect' }
  const before = verifyLimeRolloutResponse({ status: 'lime_rollout_inspected', ...await manager.apply(inspect) }, inspect)
  if (request.mode === 'inspect') return { event: 'client_lime_rollout', operation: 'inspect', ...before }
  if (before.revision !== request.expectedRevision) throw new Error('client_rollout_revision_conflict')
  // One atomic existing setter. An uncertain response must never replay a write.
  const after = { status: 'lime_rollout_updated', ...await manager.apply({
    target: 'client', mode: request.mode, expectedRevision: request.expectedRevision,
  }) }
  verifyLimeRolloutResponse(after, request)
  if (after.trainerMode !== before.trainerMode || after.scheduleMode !== before.scheduleMode) {
    throw new Error('client_rollout_other_roles_changed')
  }
  const readback = { status: 'lime_rollout_inspected', ...await manager.apply(inspect) }
  return { event: 'client_lime_rollout', operation: request.mode, ...verifyLimeRolloutReadback(after, readback) }
}

// Each manager call commits before returning; the final inspect is a new
// transaction. Reuse the existing transaction helper for pooler-safe limits.
export function boundedClientLimeManager(pool, Manager, withTransaction) {
  return {
    apply: command => withTransaction(pool, connection => {
      const leasedPool = { connect: async () => ({
        query: (text, values) => connection.query(text, values),
        release() {}, // The existing transaction helper owns this lease.
      }) }
      return new Manager(leasedPool).apply(command)
    }),
  }
}

async function main() {
  readClientLimeOperation(process.env)
  if (process.env.MIGRATION_DATABASE_HOST !== '10.70.10.67'
      || process.env.MIGRATION_DATABASE_PORT !== '5432'
      || process.env.MIGRATION_DATABASE_NAME !== 'fit'
      || process.env.MIGRATION_DATABASE_USER !== 'fit_owner'
      || process.env.MIGRATION_DATABASE_SSL_MODE !== 'require'
      || process.env.MIGRATION_DATABASE_URL !== undefined) throw new Error('client_rollout_database_invalid')
  const { buildDatabaseConnectionConfig } = await import('/app/dist/db/connection-config.js')
  const { PgDatabasePool } = await import('/app/dist/db/pg-pool.js')
  const { DatabaseLimeRolloutManager } = await import('/app/dist/db/lime-rollout.js')
  const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
  if (!config) throw new Error('client_rollout_database_invalid')
  const { withBackgroundTransaction } = await import('/app/dist/background-transaction.js')
  // statement_timeout/options in startup packets are rejected by the pooler.
  const pool = new PgDatabasePool({ ...config, max: 1, query_timeout: 10000 }, 'migration-owner')
  const manager = boundedClientLimeManager(pool, DatabaseLimeRolloutManager, withBackgroundTransaction)
  try { console.log(JSON.stringify(await runClientLimeOperation(manager, process.env))) }
  finally { await pool.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Client rollout failed or outcome is uncertain; inspect before any retry.')
    process.exitCode = 1
  })
}
