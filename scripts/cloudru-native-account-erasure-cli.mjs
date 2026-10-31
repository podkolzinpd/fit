import { createRequire } from 'node:module'
import { readFile, open, rename, unlink, lstat } from 'node:fs/promises'
import { approvedErasureScope, runNativeErasure } from './cloudru-native-account-erasure.mjs'

async function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== 'podkolzinpd/fit') throw Error('erasure_environment_invalid')
  const mode = process.env.ERASURE_MODE
  if (!['inspect', 'apply', 'verify'].includes(mode)) throw Error('erasure_mode_invalid')
  const rawScope = process.env.FIT_ACCOUNT_DELETION_TARGET_SHA256
  approvedErasureScope(rawScope)
  const { buildDatabaseConnectionConfig } = await import('/app/dist/db/connection-config.js')
  const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
  if (config.host !== '10.70.10.67' || config.port !== 5432 || config.database !== 'fit' || config.user !== 'fit_owner'
    || process.env.MIGRATION_DATABASE_SSL_MODE !== 'require') throw Error('erasure_environment_invalid')
  const directory = '/erasure-receipts'
  const dir = await lstat(directory)
  if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== 0 || (dir.mode & 0o777) !== 0o700) throw Error('erasure_receipt_permissions')
  const run = mode === 'verify' ? process.env.ERASURE_RECEIPT_RUN : process.env.GITHUB_RUN_ID
  if (!/^[1-9][0-9]{0,19}$/.test(run ?? '')) throw Error('erasure_receipt_invalid')
  const path = `${directory}/${run}.json`
  let receipt
  if (mode === 'verify') {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o777) !== 0o600 || stat.size > 20 * 1024 * 1024) throw Error('erasure_receipt_permissions')
    receipt = JSON.parse(await readFile(path, 'utf8'))
  }
  const persistReceipt = async value => {
    const raw = JSON.stringify(value)
    if (raw.length > 20 * 1024 * 1024) throw Error('erasure_receipt_invalid')
    const destination = value.phase === 'prepared' ? path : `${path}.tmp`
    const file = await open(destination, 'wx', 0o600)
    try { await file.writeFile(raw); await file.sync() } finally { await file.close() }
    if (value.phase !== 'prepared') await rename(destination, path)
    const folder = await open(directory, 'r')
    try { await folder.sync() } finally { await folder.close() }
  }
  const { Client } = createRequire('/app/package.json')('pg')
  const db = new Client({ ...config, connectionTimeoutMillis: 5000, query_timeout: 20000 })
  await db.connect()
  try {
    const result = await runNativeErasure({ db, mode, rawScope, receipt, persistReceipt })
    if (result.accountDeleted) await unlink(path)
    console.log(JSON.stringify(result))
  } finally { await db.end() }
}
main().catch(error => {
  // Never expose database errors, values, identity hashes or receipt contents.
  const message = error?.message
  console.error(/^erasure_[a-z_]+$/.test(message ?? '') ? message : 'erasure_failed_private_receipt_may_require_verification')
  process.exitCode = 1
})
