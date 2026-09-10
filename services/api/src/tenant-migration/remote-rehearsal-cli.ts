import {
  readRemoteTenantRehearsalSettings,
  RemoteTenantRehearsalError,
  runRemoteTenantRehearsal,
} from './remote-rehearsal.js'
import { TenantMigrationArtifactError } from './bundle.js'
import { TenantMigrationError } from './engine.js'

try {
  await runRemoteTenantRehearsal(
    readRemoteTenantRehearsalSettings(process.env),
  )
} catch (error) {
  const code = error instanceof RemoteTenantRehearsalError
    || error instanceof TenantMigrationArtifactError
    || error instanceof TenantMigrationError
    ? error.code
    : 'unexpected_failure'
  process.stderr.write(`Remote tenant rehearsal failed: ${code}\n`)
  process.exitCode = 1
}
