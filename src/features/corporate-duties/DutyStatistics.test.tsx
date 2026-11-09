import {formatLocalDate,localDate} from '../../shared/local-date'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach,expect,it,vi} from 'vitest'
import {CorporateDutyStatistics} from './DutyStatistics'
import {CorporateDutyError,type CorporateDuty} from '../../data/repositories/corporate-duties.repository'
const api=vi.hoisted(()=>({list:vi.fn(),audit:vi.fn(),command:vi.fn(),zone:vi.fn()}))
vi.mock('../../app/auth-context',()=>({useAuth:()=>({actor:{userId:'admin-test',timezone:'Europe/Moscow'}})}))
vi.mock('../../data/repositories/corporate-duties.repository',async original=>({...await original<typeof import('../../data/repositories/corporate-duties.repository')>(),corporateDutiesRepository:api}))
const id='10000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000001'
const office={id,name:'Тестовый',city:'Москва',timeZone:'Europe/Moscow',zoneVersion:1,archived:false}
const duty:CorporateDuty={id,trainerId:other,officeId:id,officeName:office.name,officeCity:office.city,timeZone:office.timeZone,startedAt:'2026-11-01T06:00:45.123Z',endedAt:'2026-11-01T07:00:45.987Z',seconds:3600.864,version:2,status:'completed'}
const report={seconds:3600.864,days:1,completed:1,open:0,review:0,records:[duty],nextCursor:null,trainers:[{id:other,name:'Синтетический тренер'}],offices:[office],byTrainer:[{trainerId:other,seconds:3600.864,days:1,completed:1}],byOffice:[]}
function mount(){const c=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});return render(<QueryClientProvider client={c}><CorporateDutyStatistics/></QueryClientProvider>)}
beforeEach(()=>{vi.resetAllMocks();api.list.mockResolvedValue(report);api.audit.mockResolvedValue({current:duty,records:[]});api.command.mockResolvedValue(duty);api.zone.mockResolvedValue({timeZone:'Europe/Moscow',version:1});HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new Event('close'))}})
it('shows separate accepted totals and preserves selected trainer labels across empty metadata',async()=>{
 const user=userEvent.setup();mount();expect(await screen.findByText('1 ч 0 мин')).toBeVisible()
 await user.click(screen.getByText('Период, тренер и офис'));await user.selectOptions(screen.getByLabelText('Тренер дежурств'),other)
 api.list.mockResolvedValue({...report,trainers:[],offices:[],records:[]})
 await user.click(screen.getByRole('button',{name:'Сегодня'}));await screen.findByRole('heading',{name:'За этот период дежурств нет'})
 expect(screen.getByLabelText('Тренер дежурств')).toHaveValue(other);expect(screen.getByRole('option',{name:'Синтетический тренер'})).toBeInTheDocument()
 expect(api.list.mock.calls.at(-1)?.[2]).toBe(other)
})
it('requires a reason and confirmation and preserves exact unchanged instants',async()=>{
 const user=userEvent.setup();mount();await user.click(await screen.findByRole('button',{name:'Открыть запись'}))
 await user.click(screen.getByRole('button',{name:'Сохранить исправление'}));expect(await screen.findByRole('alert')).toHaveTextContent('Укажите причину');expect(api.command).not.toHaveBeenCalled()
 await user.type(screen.getByLabelText('Причина изменения'),'Проверили время')
 await user.click(screen.getByRole('button',{name:'Сохранить исправление'}));expect(api.command).not.toHaveBeenCalled()
 await user.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Подтвердить'}))
 await waitFor(()=>expect(api.command).toHaveBeenCalledWith(expect.objectContaining({action:'correct',version:2,reason:'Проверили время',startedAt:duty.startedAt,endedAt:duty.endedAt}),true))
})
it('shows reasoned long-shift confirmation and void/restore without deleting history',async()=>{
 const user=userEvent.setup();api.list.mockResolvedValue({...report,records:[{...duty,status:'review'}],review:1,seconds:0,days:0,completed:0});mount()
 await user.click(await screen.findByRole('button',{name:'Открыть запись'}));await user.type(screen.getByLabelText('Причина изменения'),'Реальная длительность')
 await user.click(screen.getByRole('button',{name:'Подтвердить длительность'}));await user.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Подтвердить'}))
 await waitFor(()=>expect(api.command).toHaveBeenCalledWith(expect.objectContaining({action:'confirm',reason:'Реальная длительность'}),true))
})
it('retains draft after conflict and loads the current audited record even outside the report period',async()=>{
 const user=userEvent.setup();api.command.mockRejectedValueOnce(new CorporateDutyError(409,'Конфликт'));api.audit.mockResolvedValue({current:{...duty,version:3},records:[]});mount()
 await user.click(await screen.findByRole('button',{name:'Открыть запись'}));await user.type(screen.getByLabelText('Причина изменения'),'Сохранить ввод')
 await user.click(screen.getByRole('button',{name:'Аннулировать дежурство'}));await user.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Аннулировать'}))
 await screen.findByText(/Конфликт/);expect(screen.getByLabelText('Причина изменения')).toHaveValue('Сохранить ввод')
 await user.click(screen.getByRole('button',{name:'Загрузить сохранённую запись'}));await user.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Загрузить запись'}))
 await waitFor(()=>expect(screen.getByLabelText('Причина изменения')).toHaveValue(''));expect(api.command).toHaveBeenCalledTimes(1)
})
it('keeps a timezone unset until explicit selection and saves the office version independently',async()=>{
 const user=userEvent.setup();api.list.mockResolvedValue({...report,offices:[{...office,timeZone:null,zoneVersion:0}]});mount()
 await screen.findByRole('button',{name:'Открыть запись'});await user.click(screen.getByText('Часовые пояса офисов'))
 await user.selectOptions(screen.getByLabelText('Офис для часового пояса'),id)
 expect(screen.getByLabelText('Часовой пояс')).toHaveValue('');expect(screen.getByRole('button',{name:'Сохранить часовой пояс'})).toBeDisabled()
 await user.selectOptions(screen.getByLabelText('Часовой пояс'),'Europe/Moscow');await user.click(screen.getByRole('button',{name:'Сохранить часовой пояс'}))
 await waitFor(()=>expect(api.zone).toHaveBeenCalledWith(id,'Europe/Moscow',0));expect(api.command).not.toHaveBeenCalled()
})

it('never borrows a new office version for an old open timezone draft',async()=>{
 const user=userEvent.setup();api.zone.mockRejectedValue(new CorporateDutyError(409,'Часовой пояс изменился'));mount()
 await screen.findByRole('button',{name:'Открыть запись'});await user.click(screen.getByText('Часовые пояса офисов'))
 await user.selectOptions(screen.getByLabelText('Офис для часового пояса'),id);await user.selectOptions(screen.getByLabelText('Часовой пояс'),'UTC')
 api.list.mockResolvedValue({...report,offices:[{...office,timeZone:'Europe/Samara',zoneVersion:2}]})
 await user.click(screen.getByRole('button',{name:'Обновить'}));await waitFor(()=>expect(api.list).toHaveBeenCalledTimes(2))
 await user.click(screen.getByRole('button',{name:'Сохранить часовой пояс'}));await waitFor(()=>expect(api.zone).toHaveBeenCalledWith(id,'UTC',1))
 expect(screen.getByLabelText('Часовой пояс')).toHaveValue('UTC');expect(screen.getByRole('button',{name:'Сохранить часовой пояс'})).toBeDisabled()
})
it('blocks duplicate saved-record loading and closing until recovery finishes',async()=>{
 const user=userEvent.setup();let finish!:(v:{current:CorporateDuty;records:unknown[]})=>void
 const fresh={...duty,version:3}
 api.command.mockRejectedValue(new CorporateDutyError(503,'Ответ потерян'))
 api.audit.mockResolvedValueOnce({current:duty,records:[]}).mockImplementationOnce(()=>new Promise(r=>{finish=r})).mockResolvedValue({current:fresh,records:[]})
 mount();await user.click(await screen.findByRole('button',{name:'Открыть запись'}));await user.type(screen.getByLabelText('Причина изменения'),'Проверка')
 await user.click(screen.getByRole('button',{name:'Аннулировать дежурство'}));await user.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Аннулировать'}));await screen.findByText(/Ответ потерян/)
 await user.click(screen.getByRole('button',{name:'Загрузить сохранённую запись'}));await user.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Загрузить запись'}))
 expect(screen.getByRole('button',{name:'Загрузить сохранённую запись'})).toBeDisabled();expect(screen.getByRole('button',{name:'Закрыть запись'})).toBeDisabled()
 await act(async()=>{finish({current:fresh,records:[]});await Promise.resolve()});await waitFor(()=>expect(screen.getByLabelText('Причина изменения')).toHaveValue(''))
})

it('applies date and time together in the shared picker using the office timezone',async()=>{
 const user=userEvent.setup();mount();await user.click(await screen.findByRole('button',{name:'Открыть запись'}))
 await user.click(screen.getByRole('button',{name:'Окончание дежурства'}))
 const dialog=screen.getByRole('dialog',{name:'Дата и время'})
 await user.click(within(dialog).getByRole('button',{name:formatLocalDate(localDate('2026-11-02'))}))
 fireEvent.change(within(dialog).getByLabelText('Время',{exact:true}),{target:{value:'08:30'}})
 await user.click(within(dialog).getByRole('button',{name:'Применить дату'}))
 expect(screen.getByRole('button',{name:'Окончание дежурства'})).toHaveTextContent('02.11.2026 · 08:30')
 await user.type(screen.getByLabelText('Причина изменения'),'Уточнили день и время')
 await user.click(screen.getByRole('button',{name:'Сохранить исправление'}));await user.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Подтвердить'}))
 await waitFor(()=>expect(api.command).toHaveBeenCalledWith(expect.objectContaining({startedAt:duty.startedAt,endedAt:'2026-11-02T05:30:00.000Z'}),true))
})
