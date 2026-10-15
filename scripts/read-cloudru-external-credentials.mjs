import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const allowed = {
  ai: ['fit-summarize-client-training-supabase', ['YANDEX_CLOUD_API_KEY', 'YANDEX_CLOUD_FOLDER_ID', 'YANDEX_CLOUD_MODEL_ID']],
  push: ['fit-send-push-notifications-secrets', ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']],
}

// Output is secret material: callers must pipe it directly to a root0600 file.
// This reads existing credentials only; no cloud resource or IAM mutation.
export async function readCloudruExternalCredentials(kind, environment, request = fetch) {
  const config = allowed[kind]
  if (!config || environment.GITHUB_REPOSITORY !== 'podkolzinpd/fit'
    || environment.GITHUB_REF !== 'refs/heads/main'
    || !/^[a-z0-9]+$/.test(environment.YC_DEPLOY_SA_ID ?? '')
    || !/^[a-z0-9]+$/.test(environment.YC_FOLDER_ID ?? '')) throw new Error('external_credentials_context_rejected')
  async function json(url, options = {}) {
    const response = await request(url, { ...options, signal: AbortSignal.timeout(15_000), redirect: 'error' })
    if (!response.ok) throw new Error('external_credentials_unavailable')
    return response.json()
  }
  const oidcUrl = new URL(environment.ACTIONS_ID_TOKEN_REQUEST_URL)
  if (oidcUrl.protocol !== 'https:' || !oidcUrl.hostname.endsWith('.actions.githubusercontent.com')) {
    throw new Error('external_credentials_oidc_rejected')
  }
  oidcUrl.searchParams.set('audience', 'https://github.com/podkolzinpd')
  const oidc = await json(oidcUrl, { headers: { authorization: `Bearer ${environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } })
  if (typeof oidc.value !== 'string' || !oidc.value) throw new Error('external_credentials_oidc_rejected')
  const exchange = await json('https://auth.yandex.cloud/oauth/token', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token', audience: environment.YC_DEPLOY_SA_ID,
      subject_token: oidc.value, subject_token_type: 'urn:ietf:params:oauth:token-type:id_token' }) })
  if (typeof exchange.access_token !== 'string' || !exchange.access_token) throw new Error('external_credentials_oidc_rejected')
  const headers = { authorization: `Bearer ${exchange.access_token}` }
  let next = ''
  let found
  let pages = 0
  do {
    if (++pages > 10) throw new Error('external_credentials_page_limit')
    const url = new URL('https://lockbox.api.cloud.yandex.net/lockbox/v1/secrets')
    url.search = new URLSearchParams({ folderId: environment.YC_FOLDER_ID, pageSize: '1000', pageToken: next }).toString()
    const page = await json(url, { headers })
    const matches = (page.secrets ?? []).filter(secret => secret.name === config[0])
    if (matches.length > 1 || (found && matches.length)) throw new Error('external_credentials_ambiguous')
    if (matches.length) found = matches[0]
    next = page.nextPageToken ?? ''
  } while (next)
  if (!/^[a-z0-9]+$/.test(found?.id ?? '') || !/^[a-z0-9]+$/.test(found?.currentVersion?.id ?? '')) {
    throw new Error('external_credentials_missing')
  }
  const payload = await json(`https://payload.lockbox.api.cloud.yandex.net/lockbox/v1/secrets/${found.id}/payload?versionId=${found.currentVersion.id}`, { headers })
  if (payload.versionId !== found.currentVersion.id) throw new Error('external_credentials_version_rejected')
  return config[1].map(name => {
    const entries = (payload.entries ?? []).filter(entry => entry.key === name)
    const value = entries[0]?.textValue
    if (entries.length !== 1 || typeof value !== 'string' || !value || /[\x00-\x20\x7f]/.test(value)) {
      throw new Error('external_credentials_value_rejected')
    }
    if (name === 'VAPID_PUBLIC_KEY' && value !== environment.EXPECTED_VAPID_PUBLIC_KEY) {
      throw new Error('external_credentials_vapid_mismatch')
    }
    return `${name}=${value}\n`
  }).join('')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(await readCloudruExternalCredentials(process.argv[2], process.env)) }
  catch { console.error('external_credentials_read_failed'); process.exitCode = 1 }
}
