import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TrainerFinancePackage, TrainerFinanceSession } from '../../data/contracts/trainer-finance'
import { financePackagePeriod } from './finance-package-label'
import { SessionAccountingForm } from './SessionAccountingForm'

const pack: TrainerFinancePackage = { id: 'first', clientId: 'client', trainerId: 'trainer', kind: 'session_pack',
  title: 'Персональные тренировки', sessionsTotal: 10, sessionsUsed: 7, sessionsRemaining: 3,
  priceCents: 100000, paidCents: 100000, dueCents: 0, startsOn: '2026-11-01', endsOn: '2026-11-30',
  paymentDueOn: null, comment: null, packageStatus: 'active', paymentStatus: 'paid', closedAt: null,
  version: 1, createdAt: '', updatedAt: '' }

describe('Lime accounting choice', () => {
  it('keeps years and an open-ended period explicit', () => {
    expect(financePackagePeriod({ startsOn: '2026-12-01', endsOn: '2027-01-31' })).toBe('01.12.2026 — 31.01.2027')
    expect(financePackagePeriod({ startsOn: '2026-11-01', endsOn: null })).toBe('01.11.2026 — без срока')
  })

  it('invalidates a selected package when the actual session date leaves its period', () => {
    const submit = vi.fn()
    render(<SessionAccountingForm lime packages={[pack]} today="2026-11-06" saving={false} onCancel={vi.fn()} onSubmit={submit} />)
    fireEvent.click(screen.getByRole('radio', { name: /Персональные тренировки 01.11.2026 — 30.11.2026 · осталось 3/ }))
    fireEvent.change(screen.getByLabelText('Дата занятия'), { target: { value: '2026-12-01' } })
    expect(screen.queryByRole('radio', { name: /Персональные тренировки/ })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Выбрать позже' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(submit).toHaveBeenCalledWith({ workoutDate: '2026-12-01', value: 'unassigned', comment: null })
  })

  it('retains the charged session package even when its final remaining count is zero', () => {
    const session: TrainerFinanceSession = { id: 'session', packageId: pack.id, workoutId: 'workout', disposition: 'charged',
      source: 'manual', comment: null, workoutDate: '2026-11-06', voidedAt: null, voidReason: null, version: 1, createdAt: '', updatedAt: '' }
    render(<SessionAccountingForm lime packages={[{ ...pack, sessionsUsed: 10, sessionsRemaining: 0 }]} session={session}
      today="2026-11-06" saving={false} onCancel={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /Персональные тренировки.*осталось 0/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
  })

  it('retries the original locked operation after its package becomes unavailable', () => {
    const submit = vi.fn()
    const draft = { workoutDate: '2026-11-06', value: `charged:${pack.id}`, comment: 'Исходный комментарий' }
    render(<SessionAccountingForm lime packages={[]} today="2026-11-06" initialDraft={draft} locked saving={false}
      onCancel={vi.fn()} onSubmit={submit} />)
    expect(screen.getByRole('radio', { name: 'Абонемент недоступен' })).toBeChecked()
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByLabelText('Дата занятия')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить сохранение' }))
    expect(submit).toHaveBeenCalledWith(draft)
  })
})

it('records an explicit partially paid single without a separate trial type',()=>{
 const submit=vi.fn()
 render(<SessionAccountingForm lime packages={[]} today="2026-11-10" saving={false} onCancel={vi.fn()} onSubmit={submit}/> )
 expect(screen.queryByRole('radio',{name:'Пробное занятие'})).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('radio',{name:'Разовое занятие'}))
 fireEvent.change(screen.getByLabelText('Стоимость, ₽'),{target:{value:'2000'}})
 fireEvent.change(screen.getByLabelText('Получено, ₽'),{target:{value:'500'}})
 fireEvent.click(screen.getByRole('button',{name:'Добавить'}))
 expect(submit).toHaveBeenCalledWith({workoutDate:'2026-11-10',value:'single:new',comment:null,singleService:{priceCents:200000,paidCents:50000,receivedOn:'2026-11-10'}})
})
it('preserves an historical trial and replays frozen single money',()=>{
 const submit=vi.fn(),draft={workoutDate:'2026-11-10',value:'single:new',comment:null,singleService:{priceCents:200000,paidCents:50000,receivedOn:'2026-11-09'}}
 render(<SessionAccountingForm lime packages={[]} today="2026-11-10" initialDraft={draft} locked saving={false} onCancel={vi.fn()} onSubmit={submit}/> )
 expect(screen.getByLabelText('Стоимость, ₽')).toBeDisabled()
 fireEvent.click(screen.getByRole('button',{name:'Повторить сохранение'}))
 expect(submit).toHaveBeenCalledWith(draft)
})
