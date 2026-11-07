import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { TrainerFinanceClientBundle } from '../../data/contracts/trainer-finance'
import { TrainerFinancePage } from './TrainerFinancePage'

const backend = vi.hoisted(() => ({ listClient: vi.fn(), listOverview: vi.fn() }))
vi.mock('../../app/auth-context',()=>({useAuth:()=>({actor:{userId:'trainer',role:'trainer',timezone:'Europe/Moscow',experiments:{fitLime:true}}})}))
vi.mock('../../app/data-backend-context',()=>({useDataBackend:()=>({trainerFinance:backend})}))
const stamp='2026-09-01T10:00:00Z'
const bundle:TrainerFinanceClientBundle={clientId:'one',clientName:'Даша Иванова',canCreate:false,packages:[],
  payments:[{id:'pay',packageId:'pack',amountCents:1000000,receivedOn:'2026-09-01',source:'manual',comment:null,voidedAt:null,voidReason:null,version:1,createdAt:stamp,updatedAt:stamp},
    {id:'old',packageId:'pack',amountCents:500000,receivedOn:'2026-08-01',source:'manual',comment:null,voidedAt:null,voidReason:null,version:1,createdAt:stamp,updatedAt:stamp}],
  sessions:[{id:'session',packageId:null,workoutId:'first',disposition:'free',source:'automatic',comment:null,workoutDate:'2026-09-02',voidedAt:null,voidReason:null,version:1,createdAt:stamp,updatedAt:stamp}],
  attendedWorkouts:[{workoutId:'first',workoutDate:'2026-09-02',title:null},{workoutId:'online',workoutDate:'2026-09-03',title:'Проведение без списания'}, {workoutId:'older',workoutDate:'2026-08-03',title:null}]}
const summary={month:'2026-09',receivedCents:3000000,completedSessions:6,dueCents:0,attentionCount:0,
  clients:[{clientId:'one',fullName:'Даша Иванова',receivedCents:1000000,completedSessions:2},
    {clientId:'two',fullName:'Другой спортсмен',receivedCents:2000000,completedSessions:4}]}
function renderPage(path='/clients/one/finance?month=2026-09&metric=money'){
  const cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  return render(<MemoryRouter initialEntries={[{pathname:path.split('?')[0],search:path.includes('?')?'?'+path.split('?')[1]:'',state:{financeBackTo:'/finance?month=2026-09&q=Даша'}}]}><QueryClientProvider client={cache}><Routes><Route path="/finance" element={<p>Возврат в финансы</p>}/><Route path="/clients/:clientId/finance" element={<TrainerFinancePage/>}/></Routes></QueryClientProvider></MemoryRouter>)
}
beforeEach(()=>{vi.clearAllMocks();backend.listClient.mockResolvedValue(structuredClone(bundle));backend.listOverview.mockResolvedValue(structuredClone(summary))})
it('shows personal monthly receipts and every actual attendance once, retaining all history',async()=>{
  const user=userEvent.setup();const {container}=renderPage()
  await waitFor(()=>expect(container.querySelector('[data-finance-monthly-total]')?.textContent).toMatch(/10\s000/))
  expect(container.querySelector('.finance-monthly-switch')).toBeNull()
  expect(container.querySelector('.finance-monthly')?.textContent).not.toContain('%')
  expect(container.querySelectorAll('.finance-payment')).toHaveLength(1)
  await user.click(screen.getByRole('tab',{name:'Занятия: 2'}))
  expect(container.querySelector('[data-finance-monthly-total]')?.textContent).toBe('2')
  expect(container.querySelectorAll('.finance-session')).toHaveLength(2)
  expect(screen.getByText('Проведение без списания')).toBeVisible()
  await user.click(screen.getByRole('button',{name:'Вся история'}))
  expect(container.querySelectorAll('.finance-session')).toHaveLength(3)
  expect(container.querySelector('[data-finance-monthly-total]')?.textContent).toBe('2')
  await user.click(screen.getByRole('tab',{name:'Оплаты: 2'}))
  expect(container.querySelectorAll('.finance-payment')).toHaveLength(2)
  await user.click(screen.getByRole('button',{name:'За месяц'}))
  expect(container.querySelectorAll('.finance-payment')).toHaveLength(1)
  await user.click(screen.getByRole('button',{name:'Назад'}))
  expect(screen.getByText('Возврат в финансы')).toBeVisible()
})
it('never substitutes a late previous-month response for the current month',async()=>{
  let previous!:(value:typeof summary)=>void
  backend.listOverview.mockImplementation((month:string)=>month==='2026-09'?new Promise(resolve=>{previous=resolve}):Promise.resolve({...summary,month,receivedCents:500000,completedSessions:1,clients:[{...summary.clients[0]!,receivedCents:500000,completedSessions:1}]}))
  const user=userEvent.setup();const {container}=renderPage()
  await screen.findByText('Даша Иванова')
  await user.click(screen.getByRole('button',{name:'Предыдущий месяц'}))
  await waitFor(()=>expect(container.querySelector('[data-finance-monthly-total]')?.textContent).toMatch(/5\s000/))
  await act(async()=>{previous(summary);await Promise.resolve()})
  expect(screen.getByText('Август 2026')).toBeVisible()
  expect(container.querySelector('[data-finance-monthly-total]')?.textContent).toMatch(/5\s000/)
})
it('shows the monthly read error and restores it through the existing retry',async()=>{
  backend.listOverview.mockRejectedValueOnce(new Error('Unavailable'))
  const user=userEvent.setup();const {container}=renderPage()
  await user.click(await screen.findByRole('button',{name:'Повторить'}))
  await waitFor(()=>expect(container.querySelector('[data-finance-monthly-total]')?.textContent).toMatch(/10\s000/))
  expect(backend.listOverview).toHaveBeenCalledTimes(2)
})
it('keeps an invalid month outside the new reporting path',async()=>{
  renderPage('/clients/one/finance?month=2026-13')
  await screen.findByText('Даша Иванова')
  expect(backend.listOverview).not.toHaveBeenCalled()
  expect(screen.getByRole('tab',{name:'Услуги: 0'})).toHaveAttribute('aria-selected','true')
})
