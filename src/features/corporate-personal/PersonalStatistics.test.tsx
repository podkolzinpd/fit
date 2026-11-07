import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { CorporatePersonalStatistics } from './PersonalStatistics'
const api=vi.hoisted(()=>({statistics:vi.fn()}))
vi.mock('../../app/auth-context',()=>({useAuth:()=>({actor:{userId:'admin-test',role:'client',timezone:'Europe/Moscow'}})}))
vi.mock('../../data/repositories/corporate-personal.repository',()=>({corporatePersonalRepository:api}))
const id='10000000-0000-4000-8000-000000000001',next='20000000-0000-4000-8000-000000000002'
const row={id,date:'2026-11-07',trainerId:id,trainerName:'Тестовый тренер',status:'done'}
const data={count:1,trainers:[{id,name:'Тестовый тренер',count:1}],records:[row],nextCursor:null}
function setup(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><CorporatePersonalStatistics/></QueryClientProvider>)}
beforeEach(()=>{vi.resetAllMocks();api.statistics.mockResolvedValue(data)})
it('shows conducted total and detail without an office filter or client data',async()=>{
  setup();expect(await screen.findByLabelText('Проведено персональных тренировок')).toHaveTextContent('1')
  expect(screen.getByLabelText('Учтённые персональные тренировки')).toHaveTextContent('Тестовый тренер')
  expect(screen.queryByRole('combobox',{name:'Офис'})).not.toBeInTheDocument()
})
it('keeps failures distinct from a successful zero count and permits retry',async()=>{
  api.statistics.mockRejectedValueOnce(new Error('Не удалось загрузить')).mockResolvedValue({...data,count:0,records:[]})
  const user=userEvent.setup();setup();await screen.findByText('Не удалось загрузить')
  expect(screen.queryByLabelText('Проведено персональных тренировок')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button',{name:'Повторить'}))
  expect(await screen.findByText('За этот период тренировок нет')).toBeInTheDocument()
})
it('keeps loaded details on pagination failure and retries only the same next cursor',async()=>{
  const cursor={date:row.date,id:row.id}
  api.statistics.mockResolvedValueOnce({...data,count:2,nextCursor:cursor}).mockRejectedValueOnce(new Error('temporary'))
    .mockResolvedValueOnce({...data,count:2,records:[{...row,id:next}],nextCursor:null})
  const user=userEvent.setup();setup();await user.click(await screen.findByRole('button',{name:'Показать ещё'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('Уже загруженные записи сохранены')
  expect(screen.getByLabelText('Учтённые персональные тренировки').children).toHaveLength(1)
  await user.click(screen.getByRole('button',{name:'Повторить загрузку'}))
  await waitFor(()=>expect(screen.getByLabelText('Учтённые персональные тренировки').children).toHaveLength(2))
  expect(api.statistics.mock.calls[1]).toEqual(api.statistics.mock.calls[2])
})
it('applies the trainer filter with a fresh detail cursor',async()=>{
  const user=userEvent.setup();setup();await screen.findByLabelText('Проведено персональных тренировок')
  await user.click(screen.getByText('Период и тренер'))
  await user.selectOptions(screen.getByRole('combobox',{name:'Тренер персональных тренировок'}),id)
  await waitFor(()=>expect(api.statistics).toHaveBeenLastCalledWith(expect.anything(),id,undefined))
})
it('does not repeat a workout if its corrected date crosses the cursor between pages',async()=>{
  const cursor={date:row.date,id:row.id}
  api.statistics.mockResolvedValueOnce({...data,count:2,nextCursor:cursor}).mockResolvedValueOnce({...data,count:2,records:[{...row,date:'2026-11-06'},{...row,id:next}],nextCursor:null})
  const user=userEvent.setup();setup();await user.click(await screen.findByRole('button',{name:'Показать ещё'}))
  await waitFor(()=>expect(api.statistics).toHaveBeenCalledTimes(2))
  await waitFor(()=>expect(screen.getByLabelText('Учтённые персональные тренировки').children).toHaveLength(2))
})
