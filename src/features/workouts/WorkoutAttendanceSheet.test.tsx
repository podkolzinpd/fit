import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { WorkoutAttendanceSheet } from './WorkoutAttendanceSheet'

const backend = vi.hoisted(() => ({ confirmAttendance: vi.fn(), cancelPlanned: vi.fn(), get: vi.fn(), listClient: vi.fn() }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ workouts: backend, trainerFinance: backend }) }))
const workout: Workout = { id:'workout-1',clientId:'client-1',clientName:'Спортсмен',workoutDate:localDate('2026-10-31'),
  status:'planned',trainingFormat:'with_trainer',title:'Название',startTime:'10:00',endTime:null,startedAt:null,completedAt:null,
  notes:null,stageId:null,stageTitle:null,version:7,exercises:[] }
function show(action: 'complete' | 'cancel', onCompleted=vi.fn().mockResolvedValue(undefined)) {
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}>
    <WorkoutAttendanceSheet workout={workout} action={action} onCompleted={onCompleted} onClose={vi.fn()} />
  </QueryClientProvider>)
  return onCompleted
}
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open','') } })
beforeEach(() => {
  vi.clearAllMocks()
  backend.confirmAttendance.mockResolvedValue(8);backend.cancelPlanned.mockResolvedValue(8)
  backend.listClient.mockResolvedValue({clientId:workout.clientId,packages:[],sessions:[],payments:[]})
})
describe('shared workout attendance confirmation', () => {
  it('confirms the existing empty appointment and prevents duplicate submits', async () => {
    const completed=show('complete')
    await screen.findByText('Нет подходящего абонемента')
    const button=screen.getByRole('button',{name:'Подтвердить проведение'})
    fireEvent.click(button);fireEvent.click(button)
    await waitFor(()=>expect(completed).toHaveBeenCalledOnce())
    expect(backend.confirmAttendance).toHaveBeenCalledOnce()
    expect(backend.confirmAttendance).toHaveBeenCalledWith(workout,{disposition:'auto',packageId:null},expect.any(String))
    expect(backend.cancelPlanned).not.toHaveBeenCalled()
  })
  it('uses the existing cancellation without loading or selecting finance', async () => {
    const completed=show('cancel')
    expect(screen.getByText(/Занятие не спишется/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Отметить: не состоялась'}))
    await waitFor(()=>expect(completed).toHaveBeenCalledOnce())
    expect(backend.cancelPlanned).toHaveBeenCalledWith(workout)
    expect(backend.confirmAttendance).not.toHaveBeenCalled();expect(backend.listClient).not.toHaveBeenCalled()
  })
  it('passes an explicit trial instead of an automatic charge', async () => {
    show('complete');await screen.findByText('Нет подходящего абонемента')
    fireEvent.click(screen.getByRole('button',{name:'Изменить учёт'}))
    fireEvent.change(screen.getByRole('combobox',{name:'Учёт занятия'}),{target:{value:'trial'}})
    fireEvent.click(screen.getByRole('button',{name:'Подтвердить проведение'}))
    await waitFor(()=>expect(backend.confirmAttendance).toHaveBeenCalledWith(workout,{disposition:'trial',packageId:null},expect.any(String)))
  })
  it('uses the version after Live drafts have been flushed', async () => {
    const fresh={...workout,status:'in_progress' as const,version:9}
    const prepare=vi.fn().mockResolvedValue(fresh)
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><WorkoutAttendanceSheet workout={workout} action="complete" beforeSave={prepare} onClose={vi.fn()} onCompleted={vi.fn().mockResolvedValue(undefined)} /></QueryClientProvider>)
    await screen.findByText('Нет подходящего абонемента')
    fireEvent.click(screen.getByRole('button',{name:'Подтвердить проведение'}))
    await waitFor(()=>expect(backend.confirmAttendance).toHaveBeenCalledWith(fresh,{disposition:'auto',packageId:null},expect.any(String)))
    expect(prepare).toHaveBeenCalledOnce()
  })
  it('flushes Live before cancellation, warns about retained facts and uses the fresh version', async () => {
    const fresh={...workout,status:'in_progress' as const,version:9}
    const live={...fresh,exercises:[{sets:[{confirmedAt:'2026-10-31T10:00:00Z'}]}]} as Workout
    const prepare=vi.fn().mockResolvedValue(fresh)
    render(<QueryClientProvider client={new QueryClient()}><WorkoutAttendanceSheet workout={live} action="cancel" beforeSave={prepare} onClose={vi.fn()} onCompleted={vi.fn().mockResolvedValue(undefined)} /></QueryClientProvider>)
    expect(screen.getByText(/В тренировке есть записанные результаты/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Отметить: не состоялась'}))
    await waitFor(()=>expect(backend.cancelPlanned).toHaveBeenCalledWith(fresh))
    expect(prepare).toHaveBeenCalledOnce();expect(backend.listClient).not.toHaveBeenCalled()
  })
  it('requires fresh data after failure and recognizes an already committed result', async () => {
    backend.confirmAttendance.mockRejectedValueOnce(new Error('Нет сети'))
    backend.get.mockResolvedValue({...workout,status:'done',version:8})
    const completed=show('complete');await screen.findByText('Нет подходящего абонемента')
    fireEvent.click(screen.getByRole('button',{name:'Подтвердить проведение'}))
    await screen.findByRole('button',{name:'Обновить запись'})
    expect(screen.getByRole('button',{name:'Подтвердить проведение'})).toBeDisabled()
    fireEvent.click(screen.getByRole('button',{name:'Обновить запись'}))
    await waitFor(()=>expect(completed).toHaveBeenCalledOnce())
    expect(backend.confirmAttendance).toHaveBeenCalledOnce()
  })
})
