const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface ProgressMetricValue {
  metricId: string
  value: number
}

export interface ProgressDraft {
  id: string | null
  clientId: string
  recordedOn: string
  weightKg: number | null
  chestCm: number | null
  waistCm: number | null
  hipCm: number | null
  notes: string | null
  customMetrics: ProgressMetricValue[]
}

export interface VersionedProgressRequest {
  draft: ProgressDraft
  expectedVersion: number | null
}

export interface MetricDraft {
  id: string | null
  clientId: string
  name: string
  unit: string | null
}

export interface VersionedMetricRequest {
  draft: MetricDraft
  expectedVersion: number | null
}

export interface GoalDraft {
  id: string | null
  clientId: string
  title: string
  targetDate: string | null
}

export interface VersionedGoalRequest {
  draft: GoalDraft
  expectedVersion: number | null
}

export interface GoalStageDraft {
  id: string | null
  goalId: string
  title: string
  startsOn: string
  endsOn: string
  position: number
}

export interface VersionedGoalStageRequest {
  draft: GoalStageDraft
  expectedVersion: number | null
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function uuid(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined
}

function requiredUuid(value: unknown): string | undefined {
  return uuid(value) ?? undefined
}

function date(value: unknown, nullable: true): string | null | undefined
function date(value: unknown, nullable: false): string | undefined
function date(value: unknown, nullable: boolean): string | null | undefined {
  if (nullable && (value === null || value === undefined || value === '')) return null
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return undefined
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined
}

function optionalNumber(value: unknown, maximum: number): number | null | undefined {
  if (value === null || value === undefined || value === '') return null
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum
    ? value
    : undefined
}

function text(value: unknown, maximum: number, required: true): string | undefined
function text(value: unknown, maximum: number, required: false): string | null | undefined
function text(value: unknown, maximum: number, required: boolean): string | null | undefined {
  if (!required && (value === null || value === undefined || value === '')) return null
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= maximum ? normalized : undefined
}

function version(value: unknown, required: boolean): number | null | undefined {
  if (!required && (value === null || value === undefined)) return null
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    ? value
    : undefined
}

export function readVersionedProgressRequest(body: unknown): VersionedProgressRequest | undefined {
  const input = record(body)
  const draft = record(input?.draft)
  const id = uuid(draft?.id)
  const clientId = requiredUuid(draft?.clientId)
  const recordedOn = date(draft?.recordedOn, false)
  const weightKg = optionalNumber(draft?.weightKg, 999.99)
  const chestCm = optionalNumber(draft?.chestCm, 999.99)
  const waistCm = optionalNumber(draft?.waistCm, 999.99)
  const hipCm = optionalNumber(draft?.hipCm, 999.99)
  const notes = text(draft?.notes, 5_000, false)
  const expectedVersion = version(input?.expectedVersion, id !== null)
  if (!Array.isArray(draft?.customMetrics)) return undefined
  const customMetrics = draft.customMetrics.map((raw) => {
    const metric = record(raw)
    const metricId = requiredUuid(metric?.metricId)
    const value = metric?.value
    return metricId !== undefined && typeof value === 'number' && Number.isFinite(value)
      && Math.abs(value) <= 999_999_999.999
      ? { metricId, value }
      : undefined
  })
  if (id === undefined || clientId === undefined || recordedOn === undefined
    || weightKg === undefined || chestCm === undefined || waistCm === undefined
    || hipCm === undefined || notes === undefined || expectedVersion === undefined
    || customMetrics.some((metric) => metric === undefined)) return undefined
  return {
    draft: { id, clientId, recordedOn, weightKg, chestCm, waistCm, hipCm,
      notes, customMetrics: customMetrics as ProgressMetricValue[] },
    expectedVersion,
  }
}

export function readVersionedMetricRequest(body: unknown): VersionedMetricRequest | undefined {
  const input = record(body)
  const draft = record(input?.draft)
  const id = uuid(draft?.id)
  const clientId = requiredUuid(draft?.clientId)
  const name = text(draft?.name, 120, true)
  const unit = text(draft?.unit, 40, false)
  const expectedVersion = version(input?.expectedVersion, id !== null)
  return id === undefined || clientId === undefined || name === undefined
    || unit === undefined || expectedVersion === undefined
    ? undefined : { draft: { id, clientId, name, unit }, expectedVersion }
}

export function readVersionedGoalRequest(body: unknown): VersionedGoalRequest | undefined {
  const input = record(body)
  const draft = record(input?.draft)
  const id = uuid(draft?.id)
  const clientId = requiredUuid(draft?.clientId)
  const title = text(draft?.title, 200, true)
  const targetDate = date(draft?.targetDate, true)
  const expectedVersion = version(input?.expectedVersion, id !== null)
  return id === undefined || clientId === undefined || title === undefined
    || targetDate === undefined || expectedVersion === undefined
    ? undefined : { draft: { id, clientId, title, targetDate }, expectedVersion }
}

export function readVersionedGoalStageRequest(body: unknown): VersionedGoalStageRequest | undefined {
  const input = record(body)
  const draft = record(input?.draft)
  const id = uuid(draft?.id)
  const goalId = requiredUuid(draft?.goalId)
  const title = text(draft?.title, 120, true)
  const startsOn = date(draft?.startsOn, false)
  const endsOn = date(draft?.endsOn, false)
  const position = draft?.position ?? 0
  const expectedVersion = version(input?.expectedVersion, id !== null)
  return id === undefined || goalId === undefined || title === undefined
    || startsOn === undefined || endsOn === undefined || startsOn > endsOn
    || typeof position !== 'number' || !Number.isSafeInteger(position)
    || position < 0 || position > 32_767 || expectedVersion === undefined
    ? undefined
    : { draft: { id, goalId, title, startsOn, endsOn, position }, expectedVersion }
}
