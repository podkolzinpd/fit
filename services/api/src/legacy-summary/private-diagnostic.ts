import { createHash } from 'node:crypto'

// Temporary, explicitly authorized incident scope. Never use a body-supplied email.
const EMAIL_SHA256 = 'fd477d96cbc17819d7516adccb42e5458ef81d6c35145300f5d5b9f1c6c07ede'
const EXPIRES_AT = Date.parse('2026-09-13T00:00:00Z')

export function diagnosticAllowed(user: { email?: string; email_confirmed_at?: string }, ownClient: boolean, now = Date.now()): boolean {
  return ownClient && now < EXPIRES_AT && Boolean(user.email_confirmed_at) &&
    createHash('sha256').update((user.email ?? '').trim().toLowerCase()).digest('hex') === EMAIL_SHA256
}

export class PrivateSummaryDiagnostic extends Error {
  constructor(readonly result: {
    answer: string
    issues: string[]
    alternativeStatus: string | null
    modelVersion: string | null
    usage: Record<string, string>
  }) {
    super('private_summary_diagnostic')
  }
}
