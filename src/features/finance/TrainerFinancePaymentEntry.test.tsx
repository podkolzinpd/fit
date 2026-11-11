import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { PackageForm, PaymentForm, TrainerFinancePage } from './TrainerFinancePage'
import type { TrainerFinanceClientBundle, TrainerFinancePackageDraft } from '../../data/contracts/trainer-finance'

const backend = vi.hoisted(() => ({ listClient: vi.fn(), createPackage: vi.fn<(clientId:string,draft:TrainerFinancePackageDraft)=>Promise<unknown>>(), addPayment: vi.fn() }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({actor:{userId:'trainer',role:'trainer',timezone:'Europe/Moscow',experiments:{fitLime:true}}}) }))
vi.mock('../../app/data-backend-context', () => ({useDataBackend:()=>({trainerFinance:backend})}))
// Period calculations have their own suite; this suite isolates the payment entry mutation.
vi.mock('./use-trainer-finance-month', () => ({useTrainerFinanceMonth:()=>({enabled:false})}))
const empty: TrainerFinanceClientBundle = {clientId:'client',canCreate:true,packages:[],payments:[],sessions:[]}
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); backend.listClient.mockResolvedValue(empty); backend.createPackage.mockResolvedValue({}) })
it('creates a single service and its partial receipt from the zero-services payment entry', async () => {
  const user=userEvent.setup()
  render(<MemoryRouter initialEntries={['/clients/client/finance']}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Routes><Route path="/clients/:clientId/finance" element={<TrainerFinancePage/>}/></Routes></QueryClientProvider></MemoryRouter>)
  await user.click(await screen.findByRole('tab',{name:'Оплаты: 0'}))
  await user.click(screen.getByRole('button',{name:'Добавить оплату'}))
  expect(screen.getByRole('heading',{name:'Добавить оплату'})).toBeVisible()
  expect(screen.getByLabelText('Тип')).toHaveValue('single')
  expect(screen.queryByLabelText('Количество занятий')).not.toBeInTheDocument()
  await user.type(screen.getByLabelText('Стоимость, ₽'),'2000')
  await user.clear(screen.getByLabelText('Уже оплачено, ₽'))
  await user.type(screen.getByLabelText('Уже оплачено, ₽'),'500')
  await user.click(screen.getByRole('button',{name:'Сохранить'}))
  await waitFor(()=>expect(backend.createPackage).toHaveBeenCalledWith('client',expect.objectContaining({singleSession:true,kind:'session_pack',sessionsTotal:1,openingUsedSessions:0,priceCents:200000,openingPaidCents:50000})))
  expect(backend.createPackage.mock.calls[0]![1].requestId).toMatch(/^[0-9a-f-]{36}$/)
  expect(backend.addPayment).not.toHaveBeenCalled()
})
it('keeps a subscription with one session distinct from an explicitly selected single service', async () => {
  const user=userEvent.setup(), submit=vi.fn()
  render(<PackageForm lime today="2026-11-10" saving={false} error={null} onCancel={vi.fn()} onSubmit={submit}/>)
  expect(screen.getByLabelText('Тип')).toHaveValue('session_pack')
  await user.clear(screen.getByLabelText('Количество занятий')); await user.type(screen.getByLabelText('Количество занятий'),'1')
  await user.type(screen.getByLabelText('Стоимость, ₽'),'0')
  await user.click(screen.getByRole('button',{name:'Сохранить'}))
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({sessionsTotal:1,openingPaidCents:0,priceCents:0}))
  expect(submit.mock.calls[0]![0]).not.toHaveProperty('singleSession')
})
it('identifies same-title services and offers a new purchase independently of existing services', async () => {
  const newService=vi.fn(),user=userEvent.setup()
  const pack={id:'one',title:'Персональные',startsOn:'2026-11-01',endsOn:'2026-11-30',dueCents:50000} as TrainerFinanceClientBundle['packages'][number]
  render(<PaymentForm lime packages={[pack,{...pack,id:'two',startsOn:'2026-12-01',endsOn:'2026-12-31'}]} packageId="one" today="2026-11-10" saving={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()} onNewService={newService}/>)
  expect(screen.getByRole('option',{name:/01.11.2026.*30.11.2026/})).toBeInTheDocument()
  expect(screen.getByRole('option',{name:/01.12.2026.*31.12.2026/})).toBeInTheDocument()
  await user.click(screen.getByRole('button',{name:'Новая услуга'}))
  expect(newService).toHaveBeenCalledTimes(1)
})
it('does not offer unresolved package coaching or activation policies', async () => {
  const user=userEvent.setup()
  render(<PackageForm lime today="2026-11-10" saving={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()}/>)
  expect(screen.getAllByRole('option').map(x=>x.textContent)).toEqual(['Разовое занятие','Абонемент','Ведение за период'])
  await user.selectOptions(screen.getByLabelText('Тип'),'online_coaching')
  expect(screen.getByLabelText('Окончание')).toBeRequired()
  expect(screen.queryByLabelText('Количество занятий')).not.toBeInTheDocument()
  expect(screen.queryByText(/первого занятия|безлимит/i)).not.toBeInTheDocument()
})
