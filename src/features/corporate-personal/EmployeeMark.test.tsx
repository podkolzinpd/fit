import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { CorporateEmployeeMark } from './EmployeeMark'
import { CorporatePersonalError } from '../../data/repositories/corporate-personal.repository'
const api = vi.hoisted(()=>({access:vi.fn(),mark:vi.fn(),save:vi.fn()}))
const session = vi.hoisted(()=>({role:'trainer'}))
vi.mock('../../app/auth-context',()=>({useAuth:()=>({actor:{userId:'trainer-test',role:session.role,timezone:'Europe/Moscow'}})}))
vi.mock('../../data/repositories/corporate-personal.repository',async original=>({
  ...await original<typeof import('../../data/repositories/corporate-personal.repository')>(),corporatePersonalRepository:api,
}))
const before={marked:false,version:0,fromDate:null},after={marked:true,version:1,fromDate:'2026-11-07'}
function setup(clientId='first') {
  const cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  const view=(id:string)=><QueryClientProvider client={cache}><CorporateEmployeeMark clientId={id}/></QueryClientProvider>
  const result=render(view(clientId))
  return {...result,cache,changeClient:(id:string)=>result.rerender(view(id))}
}
beforeEach(()=>{vi.resetAllMocks();session.role='trainer';api.access.mockResolvedValue(true);api.mark.mockResolvedValue(before);api.save.mockResolvedValue(after)})
it('never reads a client mark before a positive access receipt and hides it for outsiders',async()=>{
  let resolve!:(value:boolean)=>void
  api.access.mockImplementation(()=>new Promise<boolean>(r=>{resolve=r}))
  setup();expect(screen.queryByRole('switch')).not.toBeInTheDocument();expect(api.mark).not.toHaveBeenCalled()
  await act(async()=>{resolve(false);await Promise.resolve()});expect(screen.queryByRole('switch')).not.toBeInTheDocument();expect(api.mark).not.toHaveBeenCalled()
})
it('does not request corporate access as an athlete',()=>{
  session.role='client';setup();expect(api.access).not.toHaveBeenCalled();expect(api.mark).not.toHaveBeenCalled()
})
it('saves an explicit versioned mark and uses only the server start date',async()=>{
  const user=userEvent.setup();setup()
  const toggle=await screen.findByRole('switch',{name:'Сотрудник Яндекса'})
  expect(toggle).not.toBeChecked();await user.click(toggle)
  await waitFor(()=>expect(toggle).toBeChecked())
  expect(api.save.mock.calls[0]?.[0]).toBe('first')
  expect(api.save.mock.calls[0]?.[1]).toMatchObject({marked:true,version:0})
  expect(api.save.mock.calls[0]?.[1]).toHaveProperty('commandId',expect.any(String))
  expect(screen.getByText(/Самостоятельные не учитываются/)).toBeInTheDocument()
})
it('retries the exact same command after an uncertain response instead of creating another period',async()=>{
  api.save.mockRejectedValueOnce(new CorporatePersonalError(503,'Ответ не получен'))
  const user=userEvent.setup();setup();await user.click(await screen.findByRole('switch'))
  await user.click(await screen.findByRole('button',{name:'Повторить сохранение'}))
  await waitFor(()=>expect(screen.getByRole('switch')).toBeChecked())
  expect(api.save).toHaveBeenCalledTimes(2);expect(api.save.mock.calls[1]).toEqual(api.save.mock.calls[0])
})
it('preserves state after conflict and requires a successful readback before another change',async()=>{
  api.save.mockRejectedValueOnce(new CorporatePersonalError(409,'Отметка уже изменилась'))
  api.mark.mockResolvedValueOnce(before).mockResolvedValue(after)
  const user=userEvent.setup();setup();await user.click(await screen.findByRole('switch'))
  await screen.findByRole('alert');expect(screen.getByRole('switch')).not.toBeChecked();expect(screen.getByRole('switch')).toBeDisabled()
  expect(screen.queryByRole('button',{name:'Повторить сохранение'})).not.toBeInTheDocument()
  await user.click(screen.getByRole('button',{name:'Загрузить сохранённую версию'}))
  await waitFor(()=>expect(screen.getByRole('switch')).toBeChecked())
  expect(api.save).toHaveBeenCalledTimes(1)
})
it('does not apply a late acknowledgement to another client',async()=>{
  let finish!:(value:typeof after)=>void
  api.save.mockImplementation(()=>new Promise<typeof after>(r=>{finish=r}))
  const user=userEvent.setup(),view=setup();await user.click(await screen.findByRole('switch'))
  view.changeClient('second');await waitFor(()=>expect(api.mark).toHaveBeenCalledWith('second'))
  await act(async()=>{finish(after);await Promise.resolve()});await waitFor(()=>expect(screen.getByRole('switch')).not.toBeChecked())
})
it('shows an access-check failure with retry instead of enabling the switch',async()=>{
  api.access.mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(true)
  const user=userEvent.setup();setup();await user.click(await screen.findByRole('button',{name:'Повторить проверку'}))
  expect(await screen.findByRole('switch')).not.toBeChecked()
})

it('keeps a newer saved mark when an older acknowledgement arrives for the same client',async()=>{
  let finish!:(value:typeof after)=>void
  api.save.mockImplementation(()=>new Promise<typeof after>(r=>{finish=r}))
  const user=userEvent.setup(),view=setup();await user.click(await screen.findByRole('switch'))
  const newer={...before,version:2}
  api.mark.mockResolvedValue(newer)
  await act(async()=>{view.cache.setQueryData(['corporate-employee-mark','trainer-test','first'],newer);await Promise.resolve()})
  await act(async()=>{finish(after);await Promise.resolve()})
  expect(await screen.findByRole('alert')).toHaveTextContent('Отметка уже изменилась')
  expect(screen.getByRole('switch')).not.toBeChecked()
  expect(screen.queryByRole('button',{name:'Повторить сохранение'})).not.toBeInTheDocument()
  await user.click(screen.getByRole('button',{name:'Загрузить сохранённую версию'}))
  await waitFor(()=>expect(screen.getByRole('switch')).not.toBeDisabled())
  expect(screen.getByRole('switch')).not.toBeChecked();expect(api.save).toHaveBeenCalledTimes(1)
})
it('ignores a stale read that finishes after a newer save acknowledgement',async()=>{
  let finishSave!:(value:typeof after)=>void,finishRead!:(value:typeof before)=>void
  api.save.mockImplementation(()=>new Promise<typeof after>(r=>{finishSave=r}))
  api.mark.mockResolvedValueOnce(before).mockImplementationOnce(()=>new Promise<typeof before>(r=>{finishRead=r}))
  const user=userEvent.setup(),view=setup();await screen.findByRole('switch')
  await act(async()=>{void view.cache.refetchQueries({queryKey:['corporate-employee-mark','trainer-test','first'],exact:true});await Promise.resolve()})
  await waitFor(()=>expect(api.mark).toHaveBeenCalledTimes(2))
  await user.click(screen.getByRole('switch'))
  await act(async()=>{finishSave(after);await Promise.resolve()})
  await screen.findByText('Отметка сохранена');expect(screen.getByRole('switch')).toBeChecked()
  await act(async()=>{finishRead(before);await Promise.resolve()})
  expect(screen.getByRole('switch')).toBeChecked()
  expect(view.cache.getQueryData(['corporate-employee-mark','trainer-test','first'])).toMatchObject({version:1})
})
