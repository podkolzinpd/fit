import { describe, expect, it } from 'vitest'
import { readTrainerFinancePaymentDraft, readTrainerFinancePackageDraft } from './trainer-finance-request.js'

describe('finance payment calendar validation', () => {
  it.each(['2026-02-30', '2026-02-29', '2026-04-31', '0000-01-01', '2026-13-01'])('rejects impossible date %s before database access', receivedOn => {
    expect(readTrainerFinancePaymentDraft({ amountCents: 1, receivedOn, comment: null })).toBeUndefined()
  })
  it.each(['2024-02-29', '2026-02-28', '2026-12-31'])('accepts real date %s', receivedOn => {
    expect(readTrainerFinancePaymentDraft({ amountCents: 1, receivedOn, comment: null })).toMatchObject({ receivedOn })
  })
})

const singleDraft = { requestId: '60000000-0000-4000-8000-000000000001', singleSession: true,
  kind: 'session_pack', title: 'Разовое занятие', sessionsTotal: 1, openingUsedSessions: 0,
  priceCents: 200000, openingPaidCents: 50000, startsOn: '2026-11-10', endsOn: null,
  paymentDueOn: null, comment: null }
it('validates explicit single service without converting legacy one-session packs', () => {
  expect(readTrainerFinancePackageDraft(singleDraft)).toMatchObject({singleSession:true,priceCents:200000,openingPaidCents:50000})
  const legacy = { ...singleDraft, singleSession: undefined }
  expect(readTrainerFinancePackageDraft(legacy)).not.toHaveProperty('singleSession')
  for (const invalid of [{sessionsTotal:2},{kind:'online_coaching'},{requestId:undefined},{singleSession:'true'}])
    expect(readTrainerFinancePackageDraft({...singleDraft,...invalid})).toBeUndefined()
})
