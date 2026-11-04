import { describe, expect, it } from 'vitest'
import { readTrainerFinancePaymentDraft } from './trainer-finance-request.js'

describe('finance payment calendar validation', () => {
  it.each(['2026-02-30', '2026-02-29', '2026-04-31', '0000-01-01', '2026-13-01'])('rejects impossible date %s before database access', receivedOn => {
    expect(readTrainerFinancePaymentDraft({ amountCents: 1, receivedOn, comment: null })).toBeUndefined()
  })
  it.each(['2024-02-29', '2026-02-28', '2026-12-31'])('accepts real date %s', receivedOn => {
    expect(readTrainerFinancePaymentDraft({ amountCents: 1, receivedOn, comment: null })).toMatchObject({ receivedOn })
  })
})
