import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, unlinkSync } from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const PAYLOAD_KEYS = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY']

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must not be empty`)
  return value.trim()
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument near ${key ?? '<end>'}`)
    options[key.slice(2).replaceAll('-', '_')] = value
  }
  return options
}

function defaultRunYc(args, input) {
  return spawnSync('yc', args, { encoding: 'utf8', input, maxBuffer: 1024 * 1024 })
}

function commandResult(result, operation, secrets) {
  if (result.error !== undefined) throw new Error(`Yandex Lockbox ${operation} could not start`)
  if (result.status !== 0) {
    let detail = String(result.stderr ?? '')
    for (const secret of secrets) detail = detail.replaceAll(secret, '[REDACTED]')
    throw new Error(`Yandex Lockbox ${operation} failed${detail.trim() === '' ? '' : `: ${detail.trim().slice(0, 500)}`}`)
  }
  return String(result.stdout ?? '')
}

function parsePayload(file) {
  let payload
  try { payload = JSON.parse(readFileSync(file, 'utf8')) } catch { throw new Error('Supabase bridge payload is invalid JSON') }
  if (!Array.isArray(payload) || payload.length !== PAYLOAD_KEYS.length) throw new Error('Supabase bridge payload is incomplete')
  const values = new Map(payload.map((entry) => [entry?.key, entry?.text_value]))
  const result = PAYLOAD_KEYS.map((key) => requireText(values.get(key), key))
  const url = new URL(result[0])
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) throw new Error('SUPABASE_URL must target Supabase HTTPS')
  return { payload, secrets: result }
}

function parseSecretMetadata(output) {
  let secret
  try { secret = JSON.parse(output) } catch { throw new Error('Yandex Lockbox returned invalid secret metadata') }
  const id = requireText(secret.id, 'Lockbox secret ID')
  const versionId = requireText(secret.current_version?.id, 'Lockbox version ID')
  if (!/^[a-z0-9]+$/u.test(id) || !/^[a-z0-9]+$/u.test(versionId)) throw new Error('Yandex Lockbox returned invalid resource IDs')
  if (!PAYLOAD_KEYS.every((key) => secret.current_version?.payload_entry_keys?.includes(key))) {
    throw new Error('Stage Lockbox version does not contain the complete Supabase bridge payload')
  }
  return { description: secret.current_version.description ?? '', id, versionId }
}

export function mirrorYandexLegacySupabaseBridge(input, dependencies = {}) {
  const folderId = requireText(input.folderId, 'folder ID')
  const githubEnv = requireText(input.githubEnv, 'GITHUB_ENV')
  const payloadFile = requireText(input.payloadFile, 'payload file')
  const secretName = requireText(input.secretName, 'secret name')
  if (!/^[a-z0-9]+$/u.test(folderId)) throw new Error('Yandex folder ID is invalid')
  const runYc = dependencies.runYc ?? defaultRunYc
  const removeFile = dependencies.removeFile ?? unlinkSync

  try {
    const { payload, secrets } = parsePayload(payloadFile)
    const marker = `payload-sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`
    const getArgs = ['lockbox', 'secret', 'get', '--name', secretName, '--folder-id', folderId, '--format', 'json']
    let getResult = runYc(getArgs)
    let metadata
    if (getResult.status === 0) {
      metadata = parseSecretMetadata(commandResult(getResult, 'metadata lookup', secrets))
      if (metadata.description !== marker) {
        commandResult(runYc([
          'lockbox', 'secret', 'add-version', '--id', metadata.id, '--description', marker,
          '--payload', '-', '--format', 'json',
        ], JSON.stringify(payload)), 'version update', secrets)
        metadata = parseSecretMetadata(commandResult(runYc(getArgs), 'metadata refresh', secrets))
      }
    } else if (/NOT_FOUND|not found/iu.test(String(getResult.stderr ?? ''))) {
      commandResult(runYc([
        'lockbox', 'secret', 'create', '--name', secretName,
        '--description', 'Stage-only Supabase credentials for the legacy chat media bridge',
        '--folder-id', folderId, '--deletion-protection', '--version-description', marker,
        '--payload', '-', '--format', 'json',
      ], JSON.stringify(payload)), 'secret creation', secrets)
      metadata = parseSecretMetadata(commandResult(runYc(getArgs), 'metadata refresh', secrets))
    } else commandResult(getResult, 'metadata lookup', secrets)

    appendFileSync(githubEnv,
      `TF_VAR_legacy_supabase_bridge_lockbox_secret_id=${metadata.id}\n`
      + `TF_VAR_legacy_supabase_bridge_lockbox_secret_version_id=${metadata.versionId}\n`)
    return metadata
  } finally {
    removeFile(payloadFile)
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const metadata = mirrorYandexLegacySupabaseBridge({
      folderId: options.folder_id, githubEnv: process.env.GITHUB_ENV,
      payloadFile: options.payload_file, secretName: options.secret_name,
    })
    process.stdout.write(`Stage Supabase bridge mirror is current at version ${metadata.versionId}.\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Stage Supabase bridge mirror failed'}\n`)
    process.exitCode = 1
  }
}
