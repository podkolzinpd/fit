const requestId = process.env.REQUEST_ID ?? ''
const sinceUtc = process.env.SINCE_UTC ?? ''
const untilUtc = process.env.UNTIL_UTC ?? ''

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

if (!requestIdPattern.test(requestId)) {
  throw new Error('diagnose_request_id must be a UUID')
}

const since = Date.parse(sinceUtc)
const until = Date.parse(untilUtc)
if (!Number.isFinite(since) || !Number.isFinite(until)) {
  throw new Error('diagnostic timestamps must be RFC-3339 values')
}

if (since >= until) {
  throw new Error('diagnostic start must be earlier than end')
}

if (until - since > 30 * 60 * 1000) {
  throw new Error('diagnostic window must not exceed 30 minutes')
}

process.stdout.write(`Validated a ${Math.round((until - since) / 1000)} second diagnostic window.\n`)
