import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { PrivateAnalyticsPage } from './PrivateAnalyticsPage'
import { csv, initialFilters, type AnalyticsFilters } from './analytics-model'
const write=vi.hoisted(()=>vi.fn())
vi.mock('../../app/auth-context',()=>({useAuth:()=>({actor:{userId:'test'}})}))
vi.mock('../../app/theme',()=>({useAppTheme:()=> 'light'}))
vi.mock('../../data/yandex-app-session-transport',()=>({yandexAppSessionTransport:()=>({apiBaseUrl:'https://example.test',sessionToken:'test'})}))
vi.mock('../../data/queries/yandex-main.queries',()=>({createYandexMainQueries:()=>({write})}))
afterEach(()=>{vi.resetAllMocks();window.history.replaceState(null,'','/')})
const result={retentionMeasured:false,revision:'synthetic',computedAt:'2026-11-07T09:00:00Z',observationStartedAt:'2026-11-07T00:00:00Z',total:2,
  rows:[{id:'t1',person_id:'t1',person:'Тренер Один',role:'trainer',actions:12},{id:'t2',person_id:'t2',person:'Тренер Два',role:'trainer',actions:2}],
  summary:{accounts:2,new:1,active:2,workouts:3,nutritionUsers:1,received:1500},trend:[{date:'2026-11-01',actions:14,users:2,registrations:1}],features:[]}
function show(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><PrivateAnalyticsPage/></QueryClientProvider>)}
it('denies access and hides cached records after revocation',async()=>{
  write.mockResolvedValueOnce(Response.json(result)).mockResolvedValueOnce(new Response(null,{status:403}))
  show();expect(await screen.findByRole('button',{name:'Тренер Один'})).toBeVisible()
  await userEvent.click(screen.getByRole('button',{name:'Обновить'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет доступа')
  expect(screen.queryByRole('button',{name:'Тренер Один'})).not.toBeInTheDocument()
})
it('sends typed server sorting, filters and a person drilldown; preserves the previous slice',async()=>{
  write.mockImplementation((_path:string,_method:string,filters:AnalyticsFilters)=>Promise.resolve(Response.json({...result,rows:filters.person?[{id:'a',person_id:'t1',person:'Тренер Один',feature:'workouts',action:'created'}]:result.rows})))
  show();await screen.findByRole('button',{name:'Тренер Один'})
  const table=screen.getByRole('table',{name:'Люди'})
  await userEvent.click(within(table).getByRole('button',{name:/Действия/}))
  await waitFor(()=>expect(write).toHaveBeenLastCalledWith('/v1/private-analytics/explore','POST',expect.objectContaining({sort:'actions',direction:'asc'})))
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'Роль'}),'trainer')
  await userEvent.click(screen.getByRole('button',{name:'Применить'}))
  await waitFor(()=>expect(write).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),expect.objectContaining({role:'trainer'})))
  await userEvent.click(screen.getByRole('button',{name:'Тренер Один'}))
  await waitFor(()=>expect(write).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),expect.objectContaining({section:'activities',person:'t1',role:''})))
  expect(window.location.search).not.toContain('t1')
  await userEvent.click(screen.getByRole('button',{name:'Назад к предыдущему срезу'}))
  await waitFor(()=>expect(write).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),expect.objectContaining({section:'people',person:'',role:'trainer'})))
})
it('new-account card requests the matching cohort rather than all people',async()=>{
  write.mockImplementation(()=>Promise.resolve(Response.json(result)))
  show();await screen.findByRole('table')
  await userEvent.click(screen.getByRole('button',{name:/Новых аккаунтов за период/}))
  await waitFor(()=>expect(write).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),expect.objectContaining({cohort:'new',section:'people'})))
})
it('exports CSV with quoted multiline cells and formula protection',()=>{
  const output=csv([{id:'1',name:'=HYPERLINK("bad")',actions:12},{id:'2',name:'строка\nвторая',actions:2}],['name','actions'])
  expect(output).toContain('"\'=HYPERLINK(""bad"")"')
  expect(output).toContain('"строка\nвторая"')
  expect(output).toContain('"12"')
})

it('uses one explicit people cohort across summary navigation and feature sections',async()=>{
  write.mockResolvedValue(Response.json(result))
  show();await screen.findByRole('table',{name:'Люди'})
  expect(screen.getByRole('combobox',{name:'Кого анализируем'})).toHaveValue('active')
  expect(screen.getByRole('complementary',{name:'Как читать выборку'})).toBeVisible()
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'Кого анализируем'}),'accounts')
  await userEvent.click(screen.getByRole('button',{name:'Применить'}))
  await waitFor(()=>expect(write).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),expect.objectContaining({cohort:'accounts'})))
  expect(initialFilters().cohort).toBe('accounts')
  await userEvent.click(screen.getByRole('button',{name:'Питание'}))
  await waitFor(()=>expect(write).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),expect.objectContaining({section:'nutrition',cohort:'accounts'})))
})

it('shows section-specific metrics without repeating people cards or unrelated charts',async()=>{
  write.mockImplementation(()=>Promise.resolve(Response.json({...result,summary:{...result.summary,nutritionDays:4,nutritionViews:1,opening:200,due:800,overdue:300}})))
  show();await screen.findByRole('table',{name:'Люди'})
  const cards=()=>within(screen.getByRole('region',{name:'Показатели раздела'}))
  expect(cards().getByText('Аккаунтов в выбранной группе')).toBeVisible()
  for(const [tab,metric] of [['Питание','Авторов дневника питания'],['Поступления','Поступления за период, ₽'],['Абонементы и долги','Долг сейчас, ₽'],['Топ упражнений','Упражнений в рейтинге'],['Обратная связь','Сообщений обратной связи']]){
    await userEvent.click(screen.getByRole('button',{name:tab}))
    await waitFor(()=>expect(cards().getByText(metric!)).toBeVisible())
    expect(cards().queryByText('Аккаунтов в выбранной группе')).not.toBeInTheDocument()
    expect(screen.queryByRole('region',{name:'Динамика'})).not.toBeInTheDocument()
  }
})

it('opens referral report with period totals and hides unrelated people filters', async()=>{
  write.mockImplementation(async()=>new Response(JSON.stringify({...result,total:1,rows:[{id:'source',name:'Сотрудница',code:'staff-001',clicks:4,registrations:1,conversion:25,active:true}],summary:{clicks:4,registrations:1,conversion:25}}),{status:200}))
  show()
  await userEvent.click(screen.getByRole('button',{name:'Реферальные ссылки'}))
  await waitFor(()=>expect(write).toHaveBeenLastCalledWith('/v1/private-analytics/explore','POST',expect.objectContaining({section:'referrals'})))
  expect(await screen.findByText('staff-001')).toBeInTheDocument()
  expect(screen.queryByLabelText('Кого анализируем')).not.toBeInTheDocument()
  expect(screen.getByRole('region',{name:'Динамика реферальных событий'})).toBeInTheDocument()
})
