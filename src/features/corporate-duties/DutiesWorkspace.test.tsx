import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {act,render,screen,waitFor,within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach,expect,it,vi} from 'vitest'
import {CorporateDutiesWorkspace,dutyAccessKey,hasDutyAccess} from './DutiesWorkspace'
import {CorporateDutyError,type CorporateDuty,type DutyAccess} from '../../data/repositories/corporate-duties.repository'
const api=vi.hoisted(()=>({access:vi.fn(),command:vi.fn(),list:vi.fn()}))
vi.mock('../../app/auth-context',()=>({useAuth:()=>({actor:{userId:'trainer-test',role:'trainer',timezone:'Europe/Moscow'}})}))
vi.mock('../../data/repositories/corporate-duties.repository',async original=>({...await original<typeof import('../../data/repositories/corporate-duties.repository')>(),corporateDutiesRepository:api}))
const office={id:'20000000-0000-4000-8000-000000000001',name:'Тестовый',city:'Москва',timeZone:'Europe/Moscow'}
const row:CorporateDuty={id:'10000000-0000-4000-8000-000000000001',trainerId:office.id,officeId:office.id,officeName:office.name,officeCity:office.city,timeZone:office.timeZone,startedAt:'2026-11-08T06:00:00Z',endedAt:null,seconds:null,version:1,status:'open'}
const initial:DutyAccess={allowed:true,hasHistory:false,active:null,offices:[office]}
const report={seconds:0,days:0,completed:0,open:0,review:0,records:[],nextCursor:null,trainers:[],offices:[],byTrainer:[],byOffice:[]}
function mount(access=initial){
 const cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
 cache.setQueryData(dutyAccessKey('trainer-test'),access)
 function View(){const data=cache.getQueryData<DutyAccess>(dutyAccessKey('trainer-test'))!;return <CorporateDutiesWorkspace access={data}/>}
 const r=render(<QueryClientProvider client={cache}><View/></QueryClientProvider>)
 return{cache,...r,update:(value:DutyAccess)=>r.rerender(<QueryClientProvider client={cache}><CorporateDutiesWorkspace access={value}/></QueryClientProvider>)}
}
beforeEach(()=>{vi.resetAllMocks();api.access.mockResolvedValue({...initial,active:row,hasHistory:true});api.command.mockResolvedValue(row);api.list.mockResolvedValue(report)})
it('does not inherit a different pilot and keeps history after revoked access',()=>{
 expect(hasDutyAccess()).toBe(false);expect(hasDutyAccess({...initial,allowed:false})).toBe(false);expect(hasDutyAccess({...initial,allowed:false,hasHistory:true})).toBe(true)
})
it('auto-selects a single assigned office and sends no client timestamps at start',async()=>{
 const user=userEvent.setup();mount();await user.click(await screen.findByRole('button',{name:'Начать дежурство'}))
 await waitFor(()=>expect(api.command).toHaveBeenCalledTimes(1));expect(api.command.mock.calls[0]![0]).toMatchObject({action:'start',officeId:office.id,version:0})
 expect(Object.keys(api.command.mock.calls[0]![0] as Record<string,unknown>).sort()).toEqual(['action','commandId','id','officeId','version'])
 await waitFor(()=>expect(api.access).toHaveBeenCalledTimes(1))
})
it('requires an explicit office for multiple assignments and disables an unset timezone',async()=>{
 const user=userEvent.setup();mount({...initial,offices:[{...office,timeZone:null},{...office,id:row.id,name:'Второй'}]})
 expect(screen.getByRole('button',{name:'Начать дежурство'})).toBeDisabled()
 await user.selectOptions(screen.getByLabelText('Офис дежурства'),office.id)
 expect(screen.getByText(/должен указать часовой пояс/)).toBeVisible();expect(screen.getByRole('button',{name:'Начать дежурство'})).toBeDisabled()
 await user.selectOptions(screen.getByLabelText('Офис дежурства'),row.id)
 expect(screen.getByRole('button',{name:'Начать дежурство'})).toBeEnabled()
})
it('retains a revoked active duty with a versioned server-time stop',async()=>{
 const user=userEvent.setup();mount({...initial,allowed:false,hasHistory:true,active:row,offices:[]})
 await user.click(screen.getByRole('button',{name:'Закончить дежурство'}))
 expect(api.command.mock.calls[0]![0]).toMatchObject({id:row.id,action:'stop',version:1})
 expect(api.command.mock.calls[0]![0]).not.toHaveProperty('endedAt')
})
it('blocks another new intent after an uncertain outcome and retries exactly the same command',async()=>{
 const user=userEvent.setup();api.command.mockRejectedValueOnce(new CorporateDutyError(503,'Ответ не получен'));mount()
 await user.click(screen.getByRole('button',{name:'Начать дежурство'}));await screen.findByRole('alert')
 expect(screen.getByRole('button',{name:'Начать дежурство'})).toBeDisabled()
 await user.click(screen.getByRole('button',{name:'Повторить тот же запрос'}))
 await waitFor(()=>expect(api.command).toHaveBeenCalledTimes(2));expect(api.command.mock.calls[1]).toEqual(api.command.mock.calls[0])
})
it('requires readback on conflict and keeps the block if recovery fails',async()=>{
 const user=userEvent.setup();api.command.mockRejectedValue(new CorporateDutyError(409,'Конфликт'));api.access.mockRejectedValueOnce(new Error('Нет сети')).mockResolvedValue(initial)
 mount();await user.click(screen.getByRole('button',{name:'Начать дежурство'}));await screen.findByRole('alert')
 expect(screen.queryByRole('button',{name:'Повторить тот же запрос'})).not.toBeInTheDocument()
 await user.click(screen.getByRole('button',{name:'Проверить сохранённое состояние'}));await screen.findByText('Нет сети')
 expect(screen.getByRole('button',{name:'Начать дежурство'})).toBeDisabled()
 await user.click(screen.getByRole('button',{name:'Проверить сохранённое состояние'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Начать дежурство'})).toBeEnabled())
})
it('never treats an old replay acknowledgement as the current active shift',async()=>{
 const user=userEvent.setup();let finish!:(value:CorporateDuty)=>void
 api.command.mockImplementation(()=>new Promise<CorporateDuty>(r=>{finish=r}));api.access.mockResolvedValue({...initial,hasHistory:true,active:null})
 const {cache}=mount();await user.click(screen.getByRole('button',{name:'Начать дежурство'}))
 await act(async()=>{finish(row);await Promise.resolve()})
 await waitFor(()=>expect(cache.getQueryData<DutyAccess>(dutyAccessKey('trainer-test'))?.active).toBeNull())
 expect(api.access).toHaveBeenCalled();expect(cache.getQueryData<DutyAccess>(dutyAccessKey('trainer-test'))?.hasHistory).toBe(true)
})
it('keeps already loaded history on page error and retries the same cursor',async()=>{
 const user=userEvent.setup();api.list.mockResolvedValueOnce({...report,records:[row],nextCursor:{at:row.startedAt,id:row.id}}).mockRejectedValueOnce(new Error('Page failed')).mockResolvedValue({...report,records:[],nextCursor:null})
 mount();await user.click(await screen.findByRole('button',{name:'Показать ещё'}));await screen.findByRole('alert')
 expect(within(screen.getByRole('list')).getByText('Москва · Тестовый')).toBeVisible()
 await user.click(screen.getByRole('button',{name:'Повторить загрузку'}));await waitFor(()=>expect(api.list).toHaveBeenCalledTimes(3))
 expect(api.list.mock.calls[1]).toEqual(api.list.mock.calls[2])
})
