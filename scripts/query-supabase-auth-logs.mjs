import { pathToFileURL } from 'node:url'

const MAX_RANGE_MS = 60 * 60 * 1000
const SAFE_ROW_KEYS = new Set([
  'second',
  'minute',
  'status',
  'path',
  'requests',
  'avg_origin_ms',
  'max_origin_ms',
  'severity',
  'category',
  'events',
])

export const EDGE_AUTH_QUERY = `
select
  toString(toStartOfSecond(timestamp)) as second,
  toString(toStartOfMinute(timestamp)) as minute,
  toInt32OrZero(log_attributes['response.status_code']) as status,
  log_attributes['request.path'] as path,
  count() as requests,
  round(avg(toFloat64OrZero(log_attributes['response.origin_time'])), 1) as avg_origin_ms,
  round(max(toFloat64OrZero(log_attributes['response.origin_time'])), 1) as max_origin_ms
from logs
where source = 'edge_logs'
  and log_attributes['request.path'] = '/auth/v1/token'
group by second, minute, status, path
order by second asc, status asc
limit 200`

export const AUTH_SERVICE_QUERY = `
select
  toString(toStartOfSecond(timestamp)) as second,
  toString(toStartOfMinute(timestamp)) as minute,
  severity_text as severity,
  multiIf(
    positionCaseInsensitive(event_message, 'invalid login credentials') > 0, 'invalid_credentials',
    positionCaseInsensitive(event_message, 'email not confirmed') > 0, 'email_not_confirmed',
    positionCaseInsensitive(event_message, 'rate limit') > 0 or positionCaseInsensitive(event_message, 'too many requests') > 0, 'rate_limited',
    positionCaseInsensitive(event_message, 'captcha') > 0, 'captcha',
    positionCaseInsensitive(event_message, 'database') > 0 or positionCaseInsensitive(event_message, 'schema') > 0, 'database',
    positionCaseInsensitive(event_message, 'refresh token') > 0, 'refresh_token',
    positionCaseInsensitive(event_message, 'request completed') > 0, 'request_completed',
    positionCaseInsensitive(event_message, 'connection') > 0 or positionCaseInsensitive(event_message, 'network') > 0, 'connection',
    positionCaseInsensitive(event_message, 'timed out') > 0 or positionCaseInsensitive(event_message, 'timeout') > 0, 'timeout',
    positionCaseInsensitive(event_message, 'error') > 0 or positionCaseInsensitive(event_message, 'failed') > 0, 'error',
    positionCaseInsensitive(event_message, 'token') > 0, 'token',
    'other'
  ) as category,
  count() as events
from logs
where source = 'auth_logs'
group by second, minute, severity, category
order by second asc, severity asc, category asc
limit 200`

export function parseLogRange(startValue, endValue) {
  const startMs = Date.parse(startValue)
  const endMs = Date.parse(endValue)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error('Start and end must be ISO-8601 timestamps')
  }
  if (endMs <= startMs) throw new Error('End must be after start')
  if (endMs - startMs > MAX_RANGE_MS) throw new Error('Auth log range must not exceed 60 minutes')
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() }
}

export function buildLogsUrl(projectId, sql, range) {
  if (!projectId?.trim()) throw new Error('SUPABASE_PROJECT_ID is required')
  const url = new URL(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectId)}/analytics/endpoints/logs`)
  url.searchParams.set('sql', sql)
  url.searchParams.set('iso_timestamp_start', range.start)
  url.searchParams.set('iso_timestamp_end', range.end)
  return url
}

function safeRows(value) {
  if (!Array.isArray(value)) return []
  return value.map((row) => Object.fromEntries(Object.entries(row ?? {}).filter(([key]) => SAFE_ROW_KEYS.has(key))))
}

export async function queryLogs({ accessToken, projectId, sql, range, fetchImplementation = fetch }) {
  if (!accessToken?.trim()) throw new Error('SUPABASE_ACCESS_TOKEN is required')
  const response = await fetchImplementation(buildLogsUrl(projectId, sql, range), {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`Supabase logs query failed with HTTP ${response.status}`)
  const payload = await response.json()
  if (payload?.error) throw new Error('Supabase logs query returned an error')
  return safeRows(payload?.result)
}

async function main() {
  const range = parseLogRange(process.argv[2], process.argv[3])
  const options = {
    accessToken: process.env.SUPABASE_ACCESS_TOKEN,
    projectId: process.env.SUPABASE_PROJECT_ID,
    range,
  }
  const edge = await queryLogs({ ...options, sql: EDGE_AUTH_QUERY })
  const auth = await queryLogs({ ...options, sql: AUTH_SERVICE_QUERY })
  console.log('AUTH_EDGE_AGGREGATES')
  console.log(JSON.stringify(edge, null, 2))
  console.log('AUTH_SERVICE_AGGREGATES')
  console.log(JSON.stringify(auth, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Auth log diagnostic failed')
    process.exitCode = 1
  })
}
