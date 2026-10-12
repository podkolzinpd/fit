import {
  CloudDatabaseTransferError,
  readDatabaseTransferConnection,
  restoreEncryptedDatabaseDump,
} from './cloud-database-transfer.js'

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new CloudDatabaseTransferError('database_restore_configuration_missing')
  }
  return value
}

try {
  await restoreEncryptedDatabaseDump(
    required('FIT_DATABASE_EXPORT_PATH'),
    required('FIT_DATABASE_EXPORT_SHA256'),
    required('FIT_DATABASE_EXPORT_PASSPHRASE'),
    readDatabaseTransferConnection(process.env, 'MIGRATION_DATABASE'),
  )
  process.stdout.write('database_restore: completed\n')
} catch (error) {
  const code = error instanceof CloudDatabaseTransferError
    ? error.code
    : 'database_restore_unexpected_failure'
  process.stderr.write(`database_restore: ${code}\n`)
  process.exitCode = 1
}

