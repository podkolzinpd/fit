import { z } from 'zod'

const date = z.iso.date()
const comment = z.string().nullable()
const cents = z.number().int().min(0).max(100000000000)
const envelope = { requestId: z.uuid(), attempts: z.number().int().nonnegative() }
export const pendingPackageSchema = z.object({ ...envelope,
  draft: z.object({ kind: z.enum(['session_pack', 'online_coaching']), singleSession: z.boolean().optional(), title: z.string(),
    sessionsTotal: z.number().int(), openingUsedSessions: z.number().int(), priceCents: cents,
    openingPaidCents: cents, openingReceivedOn: date.optional(), startsOn: date,
    endsOn: date.nullable(), paymentDueOn: date.nullable(), comment }),
})
export const pendingPaymentSchema = z.object({ ...envelope, packageId: z.string(),
  draft: z.object({ amountCents: cents, receivedOn: date, comment }),
})
export const pendingSessionSchema = z.object({ ...envelope,
  draft: z.object({ workoutDate: date, value: z.string(), comment }),
})

// Tab-scoped recovery survives navigation/reload without sharing financial
// drafts between accounts or clients. Never send if durable storage fails.
export function financeOperationKey(actorId: string, clientId: string, kind: string) {
  return `fit.finance.pending.v1:${actorId}:${clientId}:${kind}`
}
export function readFinanceOperation<T>(key: string, schema: z.ZodType<T>): T | null {
  try {
    const value = sessionStorage.getItem(key)
    return value === null ? null : schema.parse(JSON.parse(value))
  } catch (cause) {
    throw new Error('Не удалось восстановить неподтверждённое сохранение. Обратитесь в поддержку.', { cause })
  }
}
export function writeFinanceOperation(key: string, operation: unknown) {
  try {
    if (operation === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(operation))
  } catch (cause) {
    throw new Error('Не удалось сохранить проверку операции на устройстве. Повторите попытку.', { cause })
  }
}

export function clearFinanceOperation(key: string, requestId: string | undefined) {
  if (!requestId) return
  // A late response from an unmounted page must not clear a newer operation.
  const stored = sessionStorage.getItem(key)
  if (stored === null) return
  const operation = z.object({ requestId: z.uuid() }).parse(JSON.parse(stored))
  if (operation.requestId === requestId) writeFinanceOperation(key, null)
}
