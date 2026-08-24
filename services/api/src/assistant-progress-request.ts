export type AssistantProgressRequest = {
  clientId: string
  periodStart: string
  periodEnd: string
  force: boolean
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function readAssistantProgressRequest(value: unknown): AssistantProgressRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const body = value as Record<string, unknown>
  const clientId = body.client_id
  const periodStart = body.period_start
  const periodEnd = body.period_end
  const force = body.force
  if (
    typeof clientId !== 'string' || !UUID_PATTERN.test(clientId) ||
    typeof periodStart !== 'string' || !DATE_PATTERN.test(periodStart) ||
    typeof periodEnd !== 'string' || !DATE_PATTERN.test(periodEnd) ||
    (force !== undefined && typeof force !== 'boolean')
  ) return undefined

  const start = Date.parse(`${periodStart}T00:00:00Z`)
  const end = Date.parse(`${periodEnd}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start || end - start > 366 * 24 * 60 * 60 * 1000) return undefined
  return { clientId, periodStart, periodEnd, force: force === true }
}
