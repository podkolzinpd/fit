import process from 'node:process'
import { pathToFileURL } from 'node:url'

const UPSERT_QUERY = `
with desired(name, secret_value, description) as materialized (
  values
    ('push_function_url'::text, $1::text, 'Yandex Cloud Web Push sender URL'::text),
    ('push_dispatch_secret'::text, $2::text, 'Shared secret for the Web Push dispatcher'::text)
), existing as materialized (
  select secrets.id, secrets.name
  from vault.secrets as secrets
  join desired using (name)
), updated as materialized (
  select desired.name,
    vault.update_secret(existing.id, desired.secret_value, desired.name, desired.description)
  from desired
  join existing using (name)
), created as materialized (
  select desired.name,
    vault.create_secret(desired.secret_value, desired.name, desired.description)
  from desired
  left join existing using (name)
  where existing.id is null
)
select
  (select count(*) from updated) + (select count(*) from created) as configured;
`

const VERIFY_QUERY = `
select 1 / case when count(*) = 2 then 1 else 0 end as verified
from vault.decrypted_secrets
where (name = 'push_function_url' and decrypted_secret = $1::text)
   or (name = 'push_dispatch_secret' and decrypted_secret = $2::text);
`

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must not be empty`)
  return value.trim()
}

function validateInput(input) {
  const projectId = requireText(input.projectId, 'SUPABASE_PROJECT_ID')
  const accessToken = requireText(input.accessToken, 'SUPABASE_ACCESS_TOKEN')
  const functionUrl = requireText(input.functionUrl, 'PUSH_FUNCTION_URL')
  const dispatchSecret = requireText(input.dispatchSecret, 'PUSH_DISPATCH_SECRET')

  if (!/^[a-z]{20}$/.test(projectId)) throw new Error('SUPABASE_PROJECT_ID is invalid')
  const parsedUrl = new URL(functionUrl)
  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'functions.yandexcloud.net') {
    throw new Error('PUSH_FUNCTION_URL must be a Yandex Cloud Functions HTTPS URL')
  }
  if (!/^[A-Za-z0-9_-]{32,}$/.test(dispatchSecret)) throw new Error('PUSH_DISPATCH_SECRET is invalid')

  return { accessToken, dispatchSecret, functionUrl, projectId }
}

async function runQuery({ accessToken, fetch_, parameters, projectId, query }) {
  const response = await fetch_(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(projectId)}/database/query`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ parameters, query, read_only: false }),
    },
  )

  if (!response.ok) throw new Error(`Supabase push transport sync failed with HTTP ${response.status}`)
}

export async function syncSupabasePushTransport(input, dependencies = {}) {
  const values = validateInput(input)
  const fetch_ = dependencies.fetch ?? globalThis.fetch
  if (typeof fetch_ !== 'function') throw new Error('fetch is unavailable')

  const parameters = [values.functionUrl, values.dispatchSecret]
  const request = {
    accessToken: values.accessToken,
    fetch_,
    parameters,
    projectId: values.projectId,
  }
  await runQuery({ ...request, query: UPSERT_QUERY })
  await runQuery({ ...request, query: VERIFY_QUERY })
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  try {
    await syncSupabasePushTransport({
      accessToken: process.env.SUPABASE_ACCESS_TOKEN,
      dispatchSecret: process.env.PUSH_DISPATCH_SECRET,
      functionUrl: process.env.PUSH_FUNCTION_URL,
      projectId: process.env.SUPABASE_PROJECT_ID,
    })
    console.log('Verified production push transport in Supabase Vault')
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Supabase push transport sync failed')
    process.exitCode = 1
  }
}
