import { describe, expect, it } from 'vitest'
import type { TrainerFinanceClientBundle } from '../../data/contracts/trainer-finance'
import { workoutFinanceConfirmation } from './WorkoutFinanceConfirmation'

const bundle: TrainerFinanceClientBundle = {
  clientId: 'client',
  packages: [{ id: 'package', clientId: 'client', trainerId: 'trainer', kind: 'session_pack', title: '10 тренировок', sessionsTotal: 10, sessionsUsed: 3, sessionsRemaining: 7, priceCents: 3000000, paidCents: 3000000, dueCents: 0, startsOn: '2026-09-01', endsOn: null, paymentDueOn: null, comment: null, packageStatus: 'active', paymentStatus: 'paid', closedAt: null, version: 1, createdAt: '', updatedAt: '' }],
  payments: [],
  sessions: [{ id: 'session', packageId: 'package', workoutId: 'workout', disposition: 'charged', source: 'automatic', comment: null, workoutDate: '2026-09-30', voidedAt: null, voidReason: null, version: 1, createdAt: '', updatedAt: '' }],
}

describe('workoutFinanceConfirmation', () => {
  it('shows the package and remaining sessions after an automatic charge', () => {
    expect(workoutFinanceConfirmation(bundle, 'workout')).toEqual({ title: 'Занятие списано', detail: '10 тренировок · 01.09.2026 — без срока · осталось 7' })
  })

  it('does not show finance when the trainer has not enabled it for the workout', () => {
    expect(workoutFinanceConfirmation(bundle, 'another-workout')).toBeNull()
  })

  it('confirms that a self workout does not spend a session', () => {
    expect(workoutFinanceConfirmation(bundle, 'another-workout', 'self')).toEqual({ title: 'Самостоятельно', detail: 'Без списания' })
  })

  it('explains when a coached workout has no package to charge', () => {
    expect(workoutFinanceConfirmation(bundle, 'another-workout', 'with_trainer')).toEqual({ title: 'Не списано', detail: 'Нет абонемента' })
  })
})

it.each([[0,0,'Бесплатно'],[200000,0,'К оплате 2 000 ₽'],[200000,50000,'К оплате 1 500 ₽'],[200000,200000,'Оплачено']])('explains one-off price %s paid %s without subscription leftovers',(price,paid,detail)=>{
 const single={...bundle,packages:[{...bundle.packages[0]!,singleSession:true,sessionsTotal:1,sessionsUsed:1,sessionsRemaining:0,priceCents:Number(price),paidCents:Number(paid),dueCents:Number(price)-Number(paid)}]}
 const result=workoutFinanceConfirmation(single,'workout','with_trainer',true)
 expect(result?.title).toBe('Разовое занятие проведено')
 expect(result?.detail.replace(/\s/g,' ')).toBe(String(detail).replace(/\s/g,' '))
 expect(workoutFinanceConfirmation(single,'workout','with_trainer',false)?.detail).toContain('осталось 0')
})
