import {expect,test,type Page} from '@playwright/test'
import {mockPilot,trainerId} from './fit-lime-fixtures'
import {nativeAiUrl} from './native-ai-fixture'
import type {CorporateDuty,DutyCommand} from '../src/data/repositories/corporate-duties.repository'
const root='/profile/yandex-services?kind=duties',admin='/admin?tab=statistics&kind=duties'
const id='30000000-0000-4000-8000-000000000001',officeId='40000000-0000-4000-8000-000000000001',otherOffice='40000000-0000-4000-8000-000000000002'
const office={id:officeId,name:'Тестовый офис',city:'Москва',timeZone:'Europe/Moscow',zoneVersion:0,archived:false}
const base:CorporateDuty={id,trainerId,officeId,officeName:office.name,officeCity:office.city,timeZone:office.timeZone,startedAt:'2026-11-07T19:00:00Z',endedAt:'2026-11-07T23:00:00Z',seconds:14400,version:2,status:'completed'}
let unexpected:string[]=[]
async function setup(page:Page,o:{allowed?:boolean;active?:boolean;revoked?:boolean;noZone?:boolean;multiple?:boolean;lost?:boolean;conflict?:boolean;services?:boolean;role?:'client'|'trainer';review?:boolean;empty?:boolean;failHistory?:boolean;failGate?:boolean;legacy?:boolean;longName?:boolean;failNext?:boolean}={}){
 const origin=new URL(nativeAiUrl('/')).origin
 await page.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===origin&&['GET','HEAD'].includes(r.method())&&!/^\/(?:v1|api)\//.test(u.pathname))return route.fallback();unexpected.push(`${r.method()} ${u.pathname}`);return route.abort('blockedbyclient')})
 await mockPilot(page,{role:o.role??'trainer',fitLime:!o.legacy,pilot:!o.legacy,workouts:[]})
 await page.routeWebSocket('**/*',socket=>socket.close())
 await page.route('**/v1/admin/access',route=>route.fulfill({json:{allowed:o.role!=='client'}}))
 await page.route('**/v1/admin/bundle',route=>route.fulfill({json:{offices:[],trainers:[]}}))
 await page.route('**/v1/corporate-services/access',route=>route.fulfill({json:{allowed:o.services===true}}))
 let current:CorporateDuty|null=o.active?{...base,endedAt:null,seconds:null,version:1,status:'open'}:null
 let row:CorporateDuty={...base,startedAt:o.review?'2026-11-06T19:00:00Z':base.startedAt,status:o.review?'review':'completed',seconds:o.review?90000:base.seconds,endedAt:o.review?'2026-11-07T20:00:00Z':base.endedAt}
 let lost=o.lost,conflict=o.conflict,failHistory=o.failHistory,failGate=o.failGate,failNext=o.failNext
 let zone:string|null=o.noZone?null:office.timeZone,zoneVersion=0
 const writes:DutyCommand[]=[],queries:URLSearchParams[]=[],zoneWrites:unknown[]=[],commands=new Map<string,CorporateDuty>()
 const offices=()=>[{...office,timeZone:zone,zoneVersion,name:o.longName?'Очень длинное название проверочного офиса с дополнительным пояснением':office.name},...(o.multiple?[{...office,id:otherOffice,name:'Второй офис'}]:[])]
 await page.route(/\/v1\/(?:admin\/)?corporate-dut(?:ies|y-offices)(?:\/|\?|$)/,async route=>{
  const request=route.request(),u=new URL(request.url()),path=u.pathname
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST'}})
  if(path.endsWith('/access')){
   if(failGate){failGate=false;return route.fulfill({status:503,json:{error:'unavailable'}})}
   return route.fulfill({json:{allowed:o.allowed!==false&&!o.revoked,hasHistory:o.active||o.revoked||false,active:current,offices:o.revoked?[]:offices()}})
  }
  if(path.endsWith('/audit'))return route.fulfill({json:{current:row,records:[{id:2,actor_id:trainerId,actorName:'Тестовый администратор',occurred_at:'2026-11-08T06:00:00Z',action:'correct',reason:'Проверили по журналу',before_data:null,after_data:{started_at:row.startedAt,ended_at:row.endedAt,office_name:row.officeName,office_city:row.officeCity,time_zone:row.timeZone,voided:row.status==='void',long_confirmed:false,version:row.version}}]}})
  if(path.endsWith('/corporate-duty-offices')){const value=request.postDataJSON() as {timeZone:string;version:number};zoneWrites.push(value);zone=value.timeZone;zoneVersion=value.version+1;return route.fulfill({json:{timeZone:zone,version:zoneVersion}})}
  if(request.method()==='GET'){
   queries.push(u.searchParams)
   if(failHistory){failHistory=false;return route.fulfill({status:503,json:{error:'unavailable'}})}
   if(failNext&&u.searchParams.has('cursorId')){failNext=false;return route.fulfill({status:503,json:{error:'unavailable'}})}
   const isAdmin=path.includes('/admin/'),last=u.searchParams.has('cursorId')
   return route.fulfill({json:{seconds:o.review?0:14400,days:o.review?0:2,completed:o.review?0:1,open:current?1:0,review:o.review?1:0,
    records:o.empty||last?[]:isAdmin?[row]:current?[current]:[row],nextCursor:o.failNext&&!last?{at:row.startedAt,id:row.id}:null,
    trainers:isAdmin?[{id:trainerId,name:'Тестовый тренер'}]:[],offices:isAdmin?offices():[],
    byTrainer:isAdmin&&!o.review?[{trainerId,seconds:14400,days:2,completed:1}]:[],byOffice:[]}})
  }
  const value=request.postDataJSON() as DutyCommand;writes.push(value)
  if(commands.has(value.commandId))return route.fulfill({json:commands.get(value.commandId)})
  if(conflict){conflict=false;current={...base,endedAt:null,seconds:null,version:1,status:'open'};return route.fulfill({status:409,json:{error:'corporate_conflict'}})}
  if(value.action==='start')current={...base,id:value.id,officeId:value.officeId!,endedAt:null,seconds:null,version:1,status:'open'}
  else if(value.action==='stop'){row={...current!,endedAt:'2026-11-08T08:00:00Z',seconds:46800,version:value.version+1,status:'completed'};current=null}
  else{row={...row,version:value.version+1,status:value.action==='void'?'void':'completed',...(value.startedAt?{startedAt:value.startedAt,endedAt:value.endedAt!}: {})}}
  const receipt=value.action==='start'?current!:row;commands.set(value.commandId,receipt)
  if(lost){lost=false;return route.abort('connectionreset')}
  return route.fulfill({json:receipt})
 })
 return{writes,queries,zoneWrites,replaceCurrent:(value:CorporateDuty|null)=>{current=value},get row(){return row}}
}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)}
export function registerCorporateDutyCases(){
 test.beforeEach(()=>{unexpected=[]})
 test.afterEach(()=>{expect(unexpected,'Only synthetic APIs; real API/WS/external requests denied').toEqual([])})
 test('single office server start, reload restores active duty, then versioned stop',async({page})=>{
  const f=await setup(page);await page.goto(nativeAiUrl(root));await page.getByRole('button',{name:'Начать дежурство'}).click()
  await expect(page.getByText('Дежурство открыто',{exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'Закончить дежурство'})).toBeVisible()
  await page.getByRole('button',{name:'Закончить дежурство'}).click();await expect(page.getByRole('button',{name:'Начать дежурство'})).toBeVisible()
  expect(f.writes.map(x=>x.action)).toEqual(['start','stop']);expect(Object.keys(f.writes[0]!).sort()).toEqual(['action','commandId','id','officeId','version']);expect(f.writes[1]).not.toHaveProperty('endedAt')
 })
 test('only the independent duty capability opens the common profile entry',async({page})=>{
  await setup(page,{services:false});await page.goto(nativeAiUrl('/profile'));await page.getByRole('link',{name:'Работа в Яндексе'}).click();await expect(page.getByRole('button',{name:'Начать дежурство'})).toBeVisible()
 })
 test('a duty gate failure stays closed and an explicit retry recovers access without writes',async({page})=>{
  const f=await setup(page,{failGate:true});await page.goto(nativeAiUrl(root));await expect(page.getByRole('button',{name:'Начать дежурство'})).toHaveCount(0);await page.getByRole('button',{name:'Повторить',exact:true}).click();await expect(page.getByRole('button',{name:'Начать дежурство'})).toBeVisible();expect(f.writes).toHaveLength(0)
 })
 test('both denied capabilities hide the common profile entry',async({page})=>{
  await setup(page,{services:false,allowed:false});await page.goto(nativeAiUrl('/profile'));await expect(page.getByRole('link',{name:'Работа в Яндексе'})).toHaveCount(0)
 })
 test('an athlete direct route never displays duty start or trainer data',async({page})=>{
  await setup(page,{role:'client'});await page.goto(nativeAiUrl(root));await expect(page.getByRole('heading',{name:'Сегодня',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Начать дежурство'})).toHaveCount(0)
 })
 test('multiple offices require a deliberate choice',async({page})=>{
  const f=await setup(page,{multiple:true});await page.goto(nativeAiUrl(root));await expect(page.getByRole('button',{name:'Начать дежурство'})).toBeDisabled()
  await page.getByLabel('Офис дежурства').selectOption(otherOffice);await page.getByRole('button',{name:'Начать дежурство'}).click();await expect(page.getByRole('button',{name:'Закончить дежурство'})).toBeVisible();expect(f.writes[0]?.officeId).toBe(otherOffice)
 })
 test('missing office timezone cannot silently default to account timezone',async({page})=>{
  const f=await setup(page,{noZone:true});await page.goto(nativeAiUrl(root));await expect(page.getByText(/должен указать часовой пояс/)).toBeVisible();await expect(page.getByRole('button',{name:'Начать дежурство'})).toBeDisabled();expect(f.writes).toHaveLength(0)
 })
 test('revoked capability still permits finishing the saved active duty',async({page})=>{
  const f=await setup(page,{active:true,revoked:true});await page.goto(nativeAiUrl(root));await page.getByRole('button',{name:'Закончить дежурство'}).click();await expect(page.getByText(/Новые дежурства недоступны/)).toBeVisible();expect(f.writes[0]?.action).toBe('stop')
 })
 test('lost acknowledgement retries exactly the same intent without double start',async({page})=>{
  const f=await setup(page,{lost:true});await page.goto(nativeAiUrl(root));await page.getByRole('button',{name:'Начать дежурство'}).click();await page.getByRole('button',{name:'Повторить тот же запрос'}).click();await expect(page.getByRole('button',{name:'Закончить дежурство'})).toBeVisible();expect(f.writes).toHaveLength(2);expect(f.writes[0]).toEqual(f.writes[1])
 })
 test('a conflict requires current server state and never retries stale intent',async({page})=>{
  const f=await setup(page,{conflict:true});await page.goto(nativeAiUrl(root));await page.getByRole('button',{name:'Начать дежурство'}).click();await expect(page.getByRole('button',{name:'Повторить тот же запрос'})).toHaveCount(0);await page.getByRole('button',{name:'Проверить сохранённое состояние'}).click();await expect(page.getByRole('button',{name:'Закончить дежурство'})).toBeVisible();expect(f.writes).toHaveLength(1)
 })
 test('history failure retries and keeps current start available',async({page})=>{
  await setup(page,{failHistory:true});await page.goto(nativeAiUrl(root));await expect(page.getByRole('button',{name:'Начать дежурство'})).toBeEnabled();await page.getByRole('button',{name:'Повторить',exact:true}).click();await expect(page.getByRole('list')).toContainText('Завершено')
 })
 test('history page failure preserves loaded rows and retries the same cursor',async({page})=>{
  const f=await setup(page,{failNext:true});await page.goto(nativeAiUrl(root));await page.getByRole('button',{name:'Показать ещё'}).click();await expect(page.getByRole('list')).toContainText('Тестовый офис');await page.getByRole('button',{name:'Повторить загрузку'}).click();await expect(page.getByRole('button',{name:'Показать ещё'})).toHaveCount(0);const q=f.queries.filter(q=>q.has('cursorId'));expect(q).toHaveLength(2);expect(q[0]!.toString()).toBe(q[1]!.toString())
 })
 test('admin totals and details use stored office dates and separate review intervals',async({page})=>{
  await setup(page,{review:true});await page.goto(nativeAiUrl(admin));await expect(page.getByLabel('Итоги дежурств')).toContainText('0 ч 0 мин');await expect(page.getByText('Открытых: 0 · Требуют проверки: 1')).toBeVisible();await expect(page.getByLabel('Детали дежурств')).toContainText('Europe/Moscow');await expect(page.getByLabel('Детали дежурств')).toContainText('Требует проверки')
 })
 test('admin correction requires reason and explicit confirmation, then preserves audit',async({page})=>{
  const f=await setup(page);await page.goto(nativeAiUrl(admin));await page.getByRole('button',{name:'Открыть запись'}).click();await page.getByRole('button',{name:'Сохранить исправление'}).click();await expect(page.getByRole('alert')).toContainText('Укажите причину')
  await page.getByLabel('Причина изменения').fill('Уточнили по журналу');await page.getByRole('button',{name:'Сохранить исправление'}).click();expect(f.writes).toHaveLength(0);await page.getByRole('alertdialog').getByRole('button',{name:'Подтвердить',exact:true}).click();await expect(page.getByLabel('Запись дежурства')).toHaveCount(0);expect(f.writes[0]).toMatchObject({action:'correct',reason:'Уточнили по журналу',version:2})
 })
 test('admin can void and restore a retained duty without deleting its history',async({page})=>{
  const f=await setup(page);await page.goto(nativeAiUrl(admin));await page.getByRole('button',{name:'Открыть запись'}).click();await page.getByLabel('Причина изменения').fill('Ошибочная смена');await page.getByRole('button',{name:'Аннулировать дежурство'}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Аннулировать',exact:true}).click();await expect(page.getByLabel('Детали дежурств')).toContainText('Аннулировано')
  await page.getByRole('button',{name:'Открыть запись'}).click();await page.getByLabel('Причина изменения').fill('Восстановили');await page.getByRole('button',{name:'Восстановить с исправлением'}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Подтвердить',exact:true}).click();await expect(page.getByLabel('Запись дежурства')).toHaveCount(0);expect(f.writes.map(w=>w.action)).toEqual(['void','restore'])
 })
 test('admin recovers a committed lost void from audited current state without another write',async({page})=>{
  const f=await setup(page,{lost:true});await page.goto(nativeAiUrl(admin));await page.getByRole('button',{name:'Открыть запись'}).click();await page.getByLabel('Причина изменения').fill('Проверили время');await page.getByRole('button',{name:'Аннулировать дежурство'}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Аннулировать',exact:true}).click()
  await expect(page.getByLabel('Причина изменения')).toHaveValue('Проверили время');await page.getByRole('button',{name:'Загрузить сохранённую запись'}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Загрузить запись'}).click()
  await expect(page.getByRole('button',{name:'Восстановить с исправлением'})).toBeVisible();expect(f.writes).toHaveLength(1);await expect(page.getByLabel('Причина изменения')).toHaveValue('')
 })
 test('admin explicitly confirms a real long shift and sees the authenticated audit author',async({page})=>{
  const f=await setup(page,{review:true});await page.goto(nativeAiUrl(admin));await page.getByRole('button',{name:'Открыть запись'}).click();await page.getByText('История изменений',{exact:true}).click();await expect(page.getByText(/Исправлено · Тестовый администратор/)).toBeVisible();await page.getByLabel('Причина изменения').fill('Подтверждено по журналу');await page.getByRole('button',{name:'Начало дежурства',exact:true}).click();await page.getByRole('dialog',{name:'Дата и время',exact:true}).getByLabel('Время',{exact:true}).fill('23:00');await page.getByRole('dialog',{name:'Дата и время',exact:true}).getByRole('button',{name:'Применить дату'}).click();await page.getByRole('button',{name:'Подтвердить длительность'}).click();await expect(page.getByRole('alert')).toContainText('Сначала сохраните исправление времени');expect(f.writes).toHaveLength(0);await page.getByRole('button',{name:'Начало дежурства',exact:true}).click();await page.getByRole('dialog',{name:'Дата и время',exact:true}).getByLabel('Время',{exact:true}).fill('22:00');await page.getByRole('dialog',{name:'Дата и время',exact:true}).getByRole('button',{name:'Применить дату'}).click();await page.getByRole('button',{name:'Подтвердить длительность'}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Подтвердить',exact:true}).click();await expect(page.getByLabel('Запись дежурства')).toHaveCount(0);expect(f.writes[0]?.action).toBe('confirm')
 })
 test('admin office timezone stays empty until explicit selection and does not rewrite duties',async({page})=>{
  const f=await setup(page,{noZone:true});await page.goto(nativeAiUrl(admin));await page.getByText('Часовые пояса офисов',{exact:true}).click();await page.getByLabel('Офис для часового пояса').selectOption(officeId);await expect(page.getByLabel('Часовой пояс',{exact:true})).toHaveValue('');await page.getByLabel('Часовой пояс',{exact:true}).selectOption('Europe/Moscow');await page.getByRole('button',{name:'Сохранить часовой пояс'}).click();await expect(page.getByText('Часовой пояс сохранён.')).toBeVisible();expect(f.zoneWrites).toEqual([{officeId,timeZone:'Europe/Moscow',version:0}]);expect(f.writes).toHaveLength(0)
 })
 for(const theme of ['light','dark'] as const)for(const width of [320,1440])test(`duty trainer and admin readable ${theme} ${width}`,async({page})=>{
  await setup(page,{longName:true,legacy:theme==='light'});await page.addInitScript(theme=>localStorage.setItem('fit.appTheme',theme),theme);await page.setViewportSize({width,height:900});await page.goto(nativeAiUrl(root));await expect(page.getByRole('button',{name:'Начать дежурство'})).toBeVisible();await noOverflow(page)
  const start=page.getByRole('button',{name:'Начать дежурство'});expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(44);await page.screenshot({path:test.info().outputPath('duty-trainer.png'),fullPage:true})
  await page.goto(nativeAiUrl(admin));await expect(page.getByLabel('Итоги дежурств')).toBeVisible();await noOverflow(page)
  await expect(page.locator('.corporate-admin-shell.theme-light')).toHaveCount(theme==='light'?1:0)
  const selected=page.locator('.corporate-duty-statistics .corporate-service-quick-periods [aria-pressed=true]');await expect(selected).toHaveCount(1)
  const contrast=()=>selected.evaluate(el=>{const lum=(c:string)=>{const v=c.match(/[\d.]+/g)!.slice(0,3).map(Number).map(n=>{n/=255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4});return v[0]!*0.2126+v[1]!*0.7152+v[2]!*0.0722};const s=getComputedStyle(el),a=lum(s.color),b=lum(s.backgroundColor);return(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)})
  await selected.hover();await expect.poll(contrast).toBeGreaterThanOrEqual(4.5);await page.mouse.move(0,0);await expect.poll(contrast).toBeGreaterThanOrEqual(4.5)
  await page.screenshot({path:test.info().outputPath('duty-admin.png'),fullPage:true});await page.getByRole('button',{name:'Открыть запись'}).click();await page.getByLabel('Запись дежурства',{exact:true}).screenshot({path:test.info().outputPath('duty-admin-editor.png')})
 })
}
