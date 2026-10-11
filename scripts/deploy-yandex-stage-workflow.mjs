import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const resourceId = /^[a-z0-9]{20}$/
const functionName = 'fit-send-push-notifications'
const secretName = 'fit-send-push-notifications-secrets'
const functionsUrl = 'https://serverless-functions.api.cloud.yandex.net/functions/v1/functions'
const secretsUrl = 'https://lockbox.api.cloud.yandex.net/lockbox/v1/secrets'

// Official read-only REST metadata methods, same IAM identity and resources as
// the former CLI lookups. Never invoke a function or read a secret payload.
export async function readImmutablePushMetadata(env, { fetchImplementation = fetch, now = Date.now } = {}) {
  const folder = env.YC_PUSH_FOLDER_ID
  if (!resourceId.test(folder ?? '') || env.YC_PUSH_FUNCTION_NAME !== functionName
    || env.YC_PUSH_LOCKBOX_NAME !== secretName || !env.YC_TOKEN) {
    throw new Error('Immutable push metadata configuration invalid')
  }
  const deadline = now() + 60000
  async function readJson(url) {
    const remaining = deadline - now()
    if (remaining <= 0) throw new Error('Immutable push metadata deadline exceeded')
    let response
    try {
      response = await fetchImplementation(url, { method: 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${env.YC_TOKEN}` },
        signal: AbortSignal.timeout(Math.min(15000, remaining)) })
    } catch { throw new Error('Immutable push metadata network failure') }
    if (!response.ok) throw new Error(`Immutable push metadata HTTP ${response.status}`)
    const chunks = []
    let size = 0
    try {
      if (!response.body) throw new Error()
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > 1024 * 1024) throw new Error()
        chunks.push(chunk)
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch { throw new Error('Immutable push metadata response invalid') }
  }
  async function exactResource(base, field, name, filter) {
    const matches = []
    const tokens = new Set()
    let token = ''
    for (let page = 0; page < 20; page++) {
      const url = new URL(base)
      url.searchParams.set('folderId', folder)
      url.searchParams.set('pageSize', '1000')
      if (filter) url.searchParams.set('filter', `name="${name}"`)
      if (token) url.searchParams.set('pageToken', token)
      const result = await readJson(url)
      if (!Array.isArray(result?.[field]) || result[field].length > 1000) throw new Error('Immutable push metadata response invalid')
      for (const item of result[field]) {
        if (item?.name === name) matches.push(item)
      }
      const next = result.nextPageToken ?? ''
      if (typeof next !== 'string' || next.length > 2048 || tokens.has(next)) {
        throw new Error('Immutable push metadata pagination invalid')
      }
      if (!next) {
        if (matches.length !== 1 || !resourceId.test(matches[0].id ?? '')
          || matches[0].folderId !== folder) throw new Error('Immutable push metadata resource missing or ambiguous')
        return matches[0]
      }
      tokens.add(next)
      token = next
    }
    throw new Error('Immutable push metadata pagination exceeded')
  }
  const fn = await exactResource(functionsUrl, 'functions', functionName, true)
  if (fn.status !== 'ACTIVE') throw new Error('Immutable push function not active')
  const listed = await exactResource(secretsUrl, 'secrets', secretName, false)
  // Read the selected secret's current immutable version, not any payload.
  const secret = await readJson(`${secretsUrl}/${listed.id}`)
  const version = secret?.currentVersion
  if (secret?.id !== listed.id || secret.folderId !== folder || secret.name !== secretName
    || secret.status !== 'ACTIVE' || !resourceId.test(version?.id ?? '')
    || version.secretId !== secret.id || version.status !== 'ACTIVE') {
    throw new Error('Immutable push secret version invalid')
  }
  if (now() >= deadline) throw new Error('Immutable push metadata deadline exceeded')
  return { functionId: fn.id, sourceSecretId: secret.id, sourceSecretVersionId: version.id }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== 'podkolzinpd/fit') {
      throw new Error('Immutable push metadata requires official main workflow')
    }
    // Captured by command substitution inside the trusted workflow. These are
    // resource/version IDs only: never IAM tokens, payloads or user data.
    console.log(JSON.stringify(await readImmutablePushMetadata(process.env)))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
