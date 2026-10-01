import type {
  TrainerFinancePackageDraft,
  TrainerFinancePackageUpdate,
  TrainerFinancePaymentDraft,
  TrainerFinancePaymentUpdate,
  TrainerFinanceSessionUpdate,
} from './trainer-finance.js'

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function integer(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= minimum && value <= maximum ? value : undefined
}

function date(value: unknown, nullable = false): string | null | undefined {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !localDatePattern.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return undefined
  return value
}

function text(value: unknown, maximum: number, nullable = false): string | null | undefined {
  if (nullable && (value === null || value === '')) return null
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maximum) return undefined
  return normalized
}

export function readTrainerFinancePackageDraft(value: unknown): TrainerFinancePackageDraft | undefined {
  const input = record(value)
  if (!input) return undefined
  const kind = input.kind
  const title = text(input.title, 120)
  const sessionsTotal = integer(input.sessionsTotal, 0, 10000)
  const openingUsedSessions = integer(input.openingUsedSessions, 0, 10000)
  const priceCents = integer(input.priceCents, 0, 100000000000)
  const openingPaidCents = integer(input.openingPaidCents, 0, 100000000000)
  const startsOn = date(input.startsOn)
  const endsOn = date(input.endsOn, true)
  const paymentDueOn = date(input.paymentDueOn, true)
  const comment = text(input.comment, 2000, true)
  if ((kind !== 'session_pack' && kind !== 'online_coaching')
    || typeof title !== 'string' || sessionsTotal === undefined || openingUsedSessions === undefined
    || (kind === 'session_pack' && (sessionsTotal < 1 || openingUsedSessions > sessionsTotal))
    || (kind === 'online_coaching' && (sessionsTotal !== 0 || openingUsedSessions !== 0 || endsOn === null))
    || priceCents === undefined
    || openingPaidCents === undefined || openingPaidCents > priceCents || typeof startsOn !== 'string'
    || endsOn === undefined || paymentDueOn === undefined || comment === undefined
    || (endsOn !== null && endsOn < startsOn)) return undefined
  return { kind, title, sessionsTotal, openingUsedSessions, priceCents, openingPaidCents,
    startsOn, endsOn, paymentDueOn, comment }
}

export function readTrainerFinancePackageUpdate(value: unknown): TrainerFinancePackageUpdate | undefined {
  const input = record(value)
  if (!input) return undefined
  const base = readTrainerFinancePackageDraft({ ...input, openingUsedSessions: 0, openingPaidCents: 0 })
  const expectedVersion = integer(input.expectedVersion, 1, Number.MAX_SAFE_INTEGER)
  if (!base || expectedVersion === undefined) return undefined
  return {
    kind: base.kind,
    title: base.title,
    sessionsTotal: base.sessionsTotal,
    priceCents: base.priceCents,
    startsOn: base.startsOn,
    endsOn: base.endsOn,
    paymentDueOn: base.paymentDueOn,
    comment: base.comment,
    expectedVersion,
  }
}

export function readTrainerFinancePaymentDraft(value: unknown): TrainerFinancePaymentDraft | undefined {
  const input = record(value)
  if (!input) return undefined
  const amountCents = integer(input.amountCents, 1, 100000000000)
  const receivedOn = date(input.receivedOn)
  const comment = text(input.comment, 2000, true)
  if (amountCents === undefined || receivedOn === undefined || receivedOn === null
    || comment === undefined) return undefined
  return { amountCents, receivedOn, comment }
}

export function readTrainerFinancePaymentUpdate(value: unknown): TrainerFinancePaymentUpdate | undefined {
  const input = record(value)
  const draft = readTrainerFinancePaymentDraft(value)
  const expectedVersion = input && integer(input.expectedVersion, 1, Number.MAX_SAFE_INTEGER)
  return draft && expectedVersion !== undefined ? { ...draft, expectedVersion } : undefined
}

export function readTrainerFinanceVoidPayment(value: unknown): { expectedVersion: number; reason: string } | undefined {
  const input = record(value)
  if (!input) return undefined
  const expectedVersion = integer(input.expectedVersion, 1, Number.MAX_SAFE_INTEGER)
  const reason = text(input.reason, 500)
  return expectedVersion === undefined || reason === undefined || reason === null
    ? undefined : { expectedVersion, reason }
}

export function readTrainerFinanceSessionUpdate(value: unknown): TrainerFinanceSessionUpdate | undefined {
  const input = record(value)
  if (!input) return undefined
  const expectedVersion = integer(input.expectedVersion, 1, Number.MAX_SAFE_INTEGER)
  const disposition = input.disposition
  const packageId = input.packageId === null ? null
    : typeof input.packageId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.packageId)
      ? input.packageId : undefined
  const comment = text(input.comment, 2000, true)
  const workoutDate = date(input.workoutDate)
  if (expectedVersion === undefined || !['charged', 'unassigned', 'free', 'trial'].includes(String(disposition))
    || packageId === undefined || comment === undefined || typeof workoutDate !== 'string'
    || ((disposition === 'charged') !== (packageId !== null))) return undefined
  return { expectedVersion, disposition: disposition as TrainerFinanceSessionUpdate['disposition'], packageId, comment, workoutDate }
}
