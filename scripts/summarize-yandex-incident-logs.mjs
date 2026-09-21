import fs from 'node:fs'

const [logPath, requestId] = process.argv.slice(2)
if (!logPath || !requestId) {
  throw new Error('Usage: summarize-yandex-incident-logs.mjs <logs.json> <request-id>')
}

const document = JSON.parse(fs.readFileSync(logPath, 'utf8'))
const entries = Array.isArray(document) ? document : document.entries ?? []

function redact(value) {
  if (typeof value !== 'string') return value
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      (uuid) => uuid.toLowerCase() === requestId.toLowerCase() ? uuid : '[uuid]',
    )
    .replace(/([?&](?:token|code|state|secret|key)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 500)
}

function findField(value, names, depth = 0) {
  if (depth > 5 || value === null || typeof value !== 'object') return undefined
  for (const [key, child] of Object.entries(value)) {
    if (names.has(key) && ['string', 'number', 'boolean'].includes(typeof child)) return child
  }
  for (const child of Object.values(value)) {
    const found = findField(child, names, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

function containsRequestId(entry) {
  return JSON.stringify(entry).includes(requestId)
}

function safeEntry(entry) {
  const payload = entry.jsonPayload ?? entry.json_payload ?? {}
  const rawPath = findField(payload, new Set(['url', 'path', 'route']))
  const path = typeof rawPath === 'string' ? rawPath.split('?')[0] : undefined
  return {
    timestamp: entry.timestamp,
    level: entry.level,
    stream: entry.streamName ?? entry.stream_name,
    message: redact(entry.message),
    requestId,
    method: findField(payload, new Set(['method'])),
    path: redact(path),
    statusCode: findField(payload, new Set(['statusCode', 'status_code'])),
    responseTime: findField(payload, new Set(['responseTime', 'response_time'])),
    errorName: redact(findField(payload, new Set(['name', 'errorName']))),
    errorCode: redact(findField(payload, new Set(['code', 'errorCode']))),
    errorMessage: redact(findField(payload, new Set(['message', 'errorMessage']))),
  }
}

const matches = entries.filter(containsRequestId).map(safeEntry)
const infrastructurePattern = /(?:error|failed|failure|timeout|terminated|crash|signal|unavailable|502|503|504|ECONN|ENET|database)/i
const infrastructureEntries = entries
  .filter((entry) => {
    const level = String(entry.level ?? '')
    return ['ERROR', 'FATAL'].includes(level) || infrastructurePattern.test(String(entry.message ?? ''))
  })
  .slice(0, 30)
  .map((entry) => ({
    timestamp: entry.timestamp,
    level: entry.level,
    stream: entry.streamName ?? entry.stream_name,
    message: redact(entry.message),
  }))

process.stdout.write(`${JSON.stringify({
  totalEntries: entries.length,
  requestMatches: matches,
  infrastructureEntries,
}, null, 2)}\n`)
