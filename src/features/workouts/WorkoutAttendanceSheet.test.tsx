import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { WorkoutAttendanceSheet } from './WorkoutAttendanceSheet'

const backend = vi.hoisted(() => ({ confirmAttendance: vi.fn(), cancelPlanned: vi.fn(), get: vi.fn(), listClient: vi.fn() }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ workouts: backend, trainerFinance: backend }) }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { timezone: 'Europe/Moscow' } }) }))
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

it('requires a deliberate date change before future attendance and performs no write on cancel', () => {
  const onChangeDate=vi.fn(), onClose=vi.fn()
  render(<QueryClientProvider client={new QueryClient()}><WorkoutAttendanceSheet workout={{...workout,workoutDate:localDate('2099-01-01')}} action="complete" onChangeDate={onChangeDate} onClose={onClose} onCompleted={vi.fn()} /></QueryClientProvider>)
  expect(screen.getByText('Дата занятия ещё не наступила')).toBeVisible()
  expect(screen.getByRole('button',{name:'Подтвердить проведение'})).toBeDisabled()
  fireEvent.click(screen.getByRole('button',{name:'Изменить дату'}))
  expect(onChangeDate).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button',{name:'Отмена'}))
  expect(onClose).toHaveBeenCalledOnce()
  expect(backend.listClient).not.toHaveBeenCalled()
  expect(backend.confirmAttendance).not.toHaveBeenCalled()
})

const packageFixture = (id: string) => ({id,title:`Абонемент ${id}`,kind:'session_pack',closedAt:null,startsOn:'2026-01-01',endsOn:null,sessionsRemaining:10})
it('makes multiple packages optional and passes only an explicit selection', async () => {
  backend.listClient.mockResolvedValue({packages:[packageFixture('one'),packageFixture('two')]})
  show('complete')
  expect(await screen.findByText('Абонемент не выбран')).toBeVisible()
  expect(screen.getByText('Занятие сохранится без списания')).toBeVisible()
  expect(screen.getByRole('button',{name:'Подтвердить проведение'})).toBeEnabled()
  fireEvent.click(screen.getByRole('button',{name:'Выбрать'}))
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'charged:two'}})
  expect(screen.getByText('Спишется 1 занятие')).toBeVisible()
  fireEvent.click(screen.getByRole('button',{name:'Подтвердить проведение'}))
  await waitFor(()=>expect(backend.confirmAttendance).toHaveBeenCalledWith(workout,{disposition:'charged',packageId:'two'},expect.any(String)))
})
it('allows multiple packages to remain unselected without fabricating a charge', async () => {
  backend.listClient.mockResolvedValue({packages:[packageFixture('one'),packageFixture('two')]})
  show('complete');await screen.findByText('Абонемент не выбран')
  fireEvent.click(screen.getByRole('button',{name:'Подтвердить проведение'}))
  await waitFor(()=>expect(backend.confirmAttendance).toHaveBeenCalledWith(workout,{disposition:'auto',packageId:null},expect.any(String)))
})
it('blocks finance loading and failed reads until their retry succeeds', async () => {
  let rejectRead!:(error:Error)=>void
  backend.listClient.mockImplementationOnce(()=>new Promise((_resolve,reject)=>{rejectRead=reject})).mockResolvedValue({packages:[]})
  show('complete')
  expect(screen.getByRole('button',{name:'Подтвердить проведение'})).toBeDisabled()
  rejectRead(new Error('Нет сети'))
  await screen.findByText('Не удалось загрузить абонементы.')
  expect(screen.getByRole('button',{name:'Подтвердить проведение'})).toBeDisabled()
  expect(backend.confirmAttendance).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Повторить'}))
  await screen.findByText('Нет подходящего абонемента')
  expect(screen.getByRole('button',{name:'Подтвердить проведение'})).toBeEnabled()
})
it('retries an unchanged uncommitted attendance with the same operation ID', async () => {
  backend.confirmAttendance.mockRejectedValueOnce(new Error('Нет сети')).mockResolvedValue(8)
  backend.get.mockResolvedValue(workout)
  show('complete');await screen.findByText('Нет подходящего абонемента')
  fireEvent.click(screen.getByRole('button',{name:'Подтвердить проведение'}))
  await screen.findByRole('button',{name:'Обновить запись'})
  fireEvent.click(screen.getByRole('button',{name:'Обновить запись'}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'Подтвердить проведение'})).toBeEnabled())
  fireEvent.click(screen.getByRole('button',{name:'Подтвердить проведение'}))
  await waitFor(()=>expect(backend.confirmAttendance).toHaveBeenCalledTimes(2))
  expect(backend.confirmAttendance.mock.calls[0]).toEqual(backend.confirmAttendance.mock.calls[1])
})
it('names each Live command and changes no data on selection or closing', async () => {
  const onClose=vi.fn(),onDelete=vi.fn()
  render(<QueryClientProvider client={new QueryClient()}><WorkoutAttendanceSheet workout={{...workout,status:'in_progress'}} action="choose" onDelete={onDelete} onClose={onClose} onCompleted={vi.fn()} /></QueryClientProvider>)
  await screen.findByText('Нет подходящего абонемента')
  expect(screen.getByRole('button',{name:'Завершить тренировку'})).toBeEnabled()
  fireEvent.click(screen.getByRole('radio',{name:'Отметить как несостоявшуюся'}))
  expect(screen.getByRole('button',{name:'Отметить как несостоявшуюся'})).toBeEnabled()
  fireEvent.click(screen.getByRole('radio',{name:'Удалить пустую тренировку'}))
  expect(screen.getByRole('button',{name:'Удалить пустую тренировку'})).toHaveClass('danger')
  fireEvent.click(screen.getByRole('button',{name:'Продолжить тренировку'}))
  expect(onClose).toHaveBeenCalledOnce()
  expect(backend.confirmAttendance).not.toHaveBeenCalled();expect(backend.cancelPlanned).not.toHaveBeenCalled();expect(onDelete).not.toHaveBeenCalled()
})
it('never offers deletion of a populated Live or loads packages for self training', () => {
  render(<QueryClientProvider client={new QueryClient()}><WorkoutAttendanceSheet workout={{...workout,status:'in_progress',trainingFormat:'self',exercises:[{id:'exercise',position:0,source:'system',ref:'squat',name:'Приседания',muscleGroup:'legs',inputKind:'strength',blockId:'block',blockType:'single',blockPreset:'set',blockRounds:1,restBetweenExercisesSec:0,restBetweenRoundsSec:0,restBetweenSetsSec:90,sets:[]}]}} action="choose" onDelete={vi.fn()} onClose={vi.fn()} onCompleted={vi.fn()} /></QueryClientProvider>)
  expect(screen.queryByRole('radio',{name:'Удалить пустую тренировку'})).not.toBeInTheDocument()
  expect(screen.getByText('Абонемент не списывается')).toBeVisible()
  expect(backend.listClient).not.toHaveBeenCalled()
})
