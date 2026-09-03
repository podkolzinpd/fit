import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, unlinkSync } from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const PAYLOAD_KEY = 'PUSH_DISPATCH_SECRET'

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must not be empty`)
  }
  return value.trim()
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`)
    }
    options[key.slice(2).replaceAll('-', '_')] = value
  }
  return options
}

function defaultRunYc(args, input) {
  return spawnSync('yc', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 1024 * 1024,
  })
}

function commandResult(result, operation, secret) {
  if (result.error !== undefined) {
    throw new Error(`Yandex Lockbox ${operation} could not start`)
  }
  if (result.status !== 0) {
    const detail = String(result.stderr ?? '')
      .replaceAll(secret, '[REDACTED]')
      .trim()
      .slice(0, 500)
    throw new Error(
      `Yandex Lockbox ${operation} failed${detail === '' ? '' : `: ${detail}`}`,
    )
  }
  return String(result.stdout ?? '')
}

function parseSecretMetadata(output) {
  let secret
  try {
    secret = JSON.parse(output)
  } catch {
    throw new Error('Yandex Lockbox returned invalid secret metadata')
  }
  const id = requireText(secret.id, 'Lockbox secret ID')
  const versionId = requireText(secret.current_version?.id, 'Lockbox version ID')
  if (!/^[a-z0-9]+$/u.test(id) || !/^[a-z0-9]+$/u.test(versionId)) {
    throw new Error('Yandex Lockbox returned invalid resource IDs')
  }
  if (!secret.current_version?.payload_entry_keys?.includes(PAYLOAD_KEY)) {
    throw new Error(`Stage Lockbox version does not contain ${PAYLOAD_KEY}`)
  }
  return {
    description: secret.current_version.description ?? '',
    id,
    versionId,
  }
}

export function mirrorYandexPushTransport(input, dependencies = {}) {
  const folderId = requireText(input.folderId, 'folder ID')
  const secretFile = requireText(input.secretFile, 'secret file')
  const secretName = requireText(input.secretName, 'secret name')
  const sourceVersionId = requireText(input.sourceVersionId, 'source version ID')
  const githubEnv = requireText(input.githubEnv, 'GITHUB_ENV')
  const runYc = dependencies.runYc ?? defaultRunYc
  const removeFile = dependencies.removeFile ?? unlinkSync

  if (!/^[a-z0-9]+$/u.test(folderId) || !/^[a-z0-9]+$/u.test(sourceVersionId)) {
    throw new Error('Yandex resource IDs are invalid')
  }

  let dispatchSecret = ''
  try {
    dispatchSecret = readFileSync(secretFile, 'utf8').trim()
    if (!/^[A-Za-z0-9_-]{32,}$/u.test(dispatchSecret)) {
      throw new Error(`${PAYLOAD_KEY} is invalid`)
    }

    const marker = `source-version:${sourceVersionId}`
    const getArgs = [
      'lockbox', 'secret', 'get',
      '--name', secretName,
      '--folder-id', folderId,
      '--format', 'json',
    ]
    let getResult = runYc(getArgs)
    let metadata

    if (getResult.status === 0) {
      metadata = parseSecretMetadata(String(getResult.stdout ?? ''))
      if (metadata.description !== marker) {
        const payload = JSON.stringify([
          { key: PAYLOAD_KEY, text_value: dispatchSecret },
        ])
        commandResult(
          runYc([
            'lockbox', 'secret', 'add-version',
            '--id', metadata.id,
            '--description', marker,
            '--payload', '-',
            '--format', 'json',
          ], payload),
          'version update',
          dispatchSecret,
        )
        getResult = runYc(getArgs)
        metadata = parseSecretMetadata(
          commandResult(getResult, 'metadata refresh', dispatchSecret),
        )
      }
    } else if (/NOT_FOUND|not found/iu.test(String(getResult.stderr ?? ''))) {
      const payload = JSON.stringify([
        { key: PAYLOAD_KEY, text_value: dispatchSecret },
      ])
      commandResult(
        runYc([
          'lockbox', 'secret', 'create',
          '--name', secretName,
          '--description', 'Stage-local mirror of the shared Web Push dispatch credential',
          '--folder-id', folderId,
          '--deletion-protection',
          '--version-description', marker,
          '--payload', '-',
          '--format', 'json',
        ], payload),
        'secret creation',
        dispatchSecret,
      )
      metadata = parseSecretMetadata(
        commandResult(runYc(getArgs), 'metadata refresh', dispatchSecret),
      )
    } else {
      commandResult(getResult, 'metadata lookup', dispatchSecret)
    }

    appendFileSync(
      githubEnv,
      `TF_VAR_push_transport_secret_id=${metadata.id}\n`
        + `TF_VAR_push_transport_secret_version_id=${metadata.versionId}\n`,
    )
    return metadata
  } finally {
    removeFile(secretFile)
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const metadata = mirrorYandexPushTransport({
      folderId: options.folder_id,
      githubEnv: process.env.GITHUB_ENV,
      secretFile: options.secret_file,
      secretName: options.secret_name,
      sourceVersionId: options.source_version_id,
    })
    process.stdout.write(`Stage push transport mirror is current at version ${metadata.versionId}.\n`)
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Stage push transport mirror failed'}\n`,
    )
    process.exitCode = 1
  }
}
