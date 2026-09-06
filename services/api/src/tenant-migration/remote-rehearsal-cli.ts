import {
  readRemoteTenantRehearsalFailureCode,
  readRemoteTenantRehearsalSettings,
  runRemoteTenantRehearsal,
} from './remote-rehearsal.js'

try {
  await runRemoteTenantRehearsal(
    readRemoteTenantRehearsalSettings(process.env),
  )
} catch (error) {
  const code = readRemoteTenantRehearsalFailureCode(error)
  process.stderr.write(`Remote tenant rehearsal failed: ${code}\n`)
  process.exitCode = 1
}
