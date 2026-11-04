import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFinanceOperation, financeOperationKey, pendingPaymentSchema, readFinanceOperation, writeFinanceOperation } from './pending-finance-operation'

beforeEach(() => sessionStorage.clear())
describe('pending finance recovery', () => {
  it('isolates actor, client and operation kind', () => {
    const key = financeOperationKey('trainer-a', 'client-a', 'payment')
    const operation = { requestId: crypto.randomUUID(), attempts: 1, packageId: 'service-a',
      draft: { amountCents: 1001, receivedOn: '2026-11-04', comment: null } }
    writeFinanceOperation(key, operation)
    expect(readFinanceOperation(key, pendingPaymentSchema)).toEqual(operation)
    for (const other of [financeOperationKey('trainer-b', 'client-a', 'payment'), financeOperationKey('trainer-a', 'client-b', 'payment'), financeOperationKey('trainer-a', 'client-a', 'package')]) {
      expect(readFinanceOperation(other, pendingPaymentSchema)).toBeNull()
    }
  })
  it('does not clear a newer operation when an old page completes late', () => {
    const oldId = crypto.randomUUID()
    const newId = crypto.randomUUID()
    writeFinanceOperation('payment', { requestId: newId })
    clearFinanceOperation('payment', oldId)
    expect(sessionStorage.getItem('payment')).toContain(newId)
    clearFinanceOperation('payment', newId)
    expect(sessionStorage.getItem('payment')).toBeNull()
  })
  it('never silently drops corrupt or unavailable recovery storage', () => {
    sessionStorage.setItem('broken', '{')
    expect(() => readFinanceOperation('broken', pendingPaymentSchema)).toThrow('Не удалось восстановить')
    const storage = sessionStorage
    vi.stubGlobal('sessionStorage', { getItem: storage.getItem.bind(storage), setItem: () => { throw new DOMException('Full', 'QuotaExceededError') } })
    expect(() => writeFinanceOperation('new', {})).toThrow('Не удалось сохранить')
    vi.stubGlobal('sessionStorage', storage)
  })
})
