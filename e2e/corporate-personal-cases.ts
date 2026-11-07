import { expect, test, type Page } from '@playwright/test'
import { mockPilot, trainerId, clientId } from './fit-lime-fixtures'
import { nativeAiUrl } from './native-ai-fixture'
import type { EmployeeCommand, EmployeeMark } from '../src/data/repositories/corporate-personal.repository'

const card = `/clients/${clientId}`, admin = '/admin?tab=statistics&kind=personal'
const otherTrainer = '20000000-0000-4000-8000-000000000001'
let unexpected: string[] = []
async function setup(page: Page, options: { allowed?: boolean; role?: 'trainer'|'client'; lost?: boolean; conflict?: boolean; denied?: boolean; failGate?: boolean; failStats?: boolean; failPage?: boolean; empty?: boolean; legacy?: boolean } = {}) {
  const origin = new URL(nativeAiUrl('/')).origin
  await page.route('**/*', route => {
    const req=route.request(),url=new URL(req.url())
    if (url.origin===origin && ['GET','HEAD'].includes(req.method()) && !/^\/(?:api|v1)\//.test(url.pathname)) return route.fallback()
    unexpected.push(`${req.method()} ${url.pathname}`);return route.abort('blockedbyclient')
  })
  await mockPilot(page,{role:options.role??'trainer',fitLime:!options.legacy,pilot:!options.legacy,workouts:[]})
  await page.routeWebSocket('**/*',socket=>socket.close())
  await page.route('**/v1/admin/access',route=>route.fulfill({json:{allowed:true}}))
  await page.route('**/v1/admin/bundle',route=>route.fulfill({json:{offices:[],trainers:[]}}))
  await page.route(/\/v1\/admin\/corporate-services(?:\?|$)/,route=>route.fulfill({json:{counts:{tour:0,consultation:0,instruction:0,intro:0},timeZone:'Europe/Moscow',offices:[],trainers:[]}}))
  let mark:EmployeeMark={marked:false,version:0,fromDate:null},lost=options.lost,conflict=options.conflict,failGate=options.failGate,failStats=options.failStats,failPage=options.failPage
  const commands=new Map<string,EmployeeMark>(),writes:EmployeeCommand[]=[],ranges:URLSearchParams[]=[]
  let markReads=0,gateReads=0
  await page.route(/\/v1\/(?:admin\/)?corporate-personal(?:\/|\?|$)/,async route=>{
    const url=new URL(route.request().url()),path=url.pathname
    if (path.endsWith('/access')) {
      gateReads++
      if(failGate){failGate=false;return route.fulfill({status:503,json:{error:'unavailable'}})}
      return route.fulfill({json:{allowed:options.allowed!==false}})
    }
    if(path==='/v1/admin/corporate-personal') {
      ranges.push(url.searchParams)
      if(failStats){failStats=false;return route.fulfill({status:503,json:{error:'unavailable'}})}
      if(failPage && url.searchParams.has('cursorId')){failPage=false;return route.fulfill({status:503,json:{error:'unavailable'}})}
      const date='2026-11-07',last=url.searchParams.has('cursorId'),filtered=url.searchParams.has('trainerId'),empty=options.empty
      const id=last?otherTrainer:clientId
      return route.fulfill({json:{count:empty?0:filtered?1:2,trainers:[{id:trainerId,name:'Тестовый тренер',count:1},{id:otherTrainer,name:'Второй тренер',count:1}],records:empty?[]:[{id,date,trainerId:filtered?otherTrainer:trainerId,trainerName:filtered?'Второй тренер':'Тестовый тренер',status:'done'}],nextCursor:!empty&&!last&&!filtered?{date,id}:null}})
    }
    if(route.request().method()==='GET'){markReads++;return route.fulfill({json:mark})}
    const command=route.request().postDataJSON() as EmployeeCommand;writes.push(command)
    if(options.denied)return route.fulfill({status:403,json:{error:'forbidden'}})
    if(commands.has(command.commandId))return route.fulfill({json:commands.get(command.commandId)})
    if(conflict){conflict=false;mark={marked:true,version:1,fromDate:'2026-11-07'};return route.fulfill({status:409,json:{error:'conflict'}})}
    mark={marked:command.marked,version:command.version+1,fromDate:command.marked?'2026-11-07':null};commands.set(command.commandId,mark)
    if(lost){lost=false;return route.abort('connectionreset')}
    return route.fulfill({json:mark})
  })
  return {writes,ranges,get mark(){return mark},replaceMark(value:EmployeeMark){mark=value},get markReads(){return markReads},get gateReads(){return gateReads}}
}
export function registerCorporatePersonalCases() {
  test.beforeEach(()=>{unexpected=[]})
  test.afterEach(()=>{expect(unexpected,'Real APIs are blocked; application calls must be mocked').toEqual([])})
  test('mark uses a confirmed gate and only server date; unmark preserves ordinary client actions',async({page})=>{
    const f=await setup(page);await page.goto(nativeAiUrl(card))
    const toggle=page.getByRole('switch',{name:'Сотрудник Яндекса'})
    await expect(toggle).not.toBeChecked();await toggle.click();await expect(toggle).toBeChecked()
    await expect(page.locator('.corporate-employee-mark')).toContainText('07.11')
    expect(f.writes).toHaveLength(1);expect(Object.keys(f.writes[0]!).sort()).toEqual(['commandId','marked','version'])
    await toggle.click();await expect(toggle).not.toBeChecked();expect(f.mark.version).toBe(2)
    await expect(page.getByRole('heading',{name:'Алексей Смирнов',exact:true})).toBeVisible()
  })
  test('business permission is independent of the trainer visual pilot',async({page})=>{
    await setup(page,{legacy:true});await page.goto(nativeAiUrl(card));const toggle=page.getByRole('switch',{name:'Сотрудник Яндекса'});await toggle.click();await expect(page.locator('.corporate-employee-mark')).toContainText('07.11');await expect(toggle).toBeChecked()
  })
  test('lost acknowledgement retries the same command and a conflict requires saved version',async({page})=>{
    const f=await setup(page,{lost:true});await page.goto(nativeAiUrl(card));await page.getByRole('switch').click()
    await page.getByRole('button',{name:'Повторить сохранение'}).click();await expect(page.getByRole('switch')).toBeChecked()
    expect(f.writes).toHaveLength(2);expect(f.writes[0]).toEqual(f.writes[1]);expect(f.mark.version).toBe(1)
  })
  test('a replayed old acknowledgement cannot replace a newer mark read from the server',async({page})=>{
    const f=await setup(page,{lost:true});await page.goto(nativeAiUrl(card));await page.getByRole('switch').click()
    await expect(page.getByRole('button',{name:'Повторить сохранение'})).toBeVisible()
    f.replaceMark({marked:false,version:2,fromDate:null})
    const refreshed=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname.endsWith(`/corporate-personal/clients/${clientId}`))
    await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await (await refreshed).finished()
    await page.getByRole('button',{name:'Повторить сохранение'}).click()
    await expect(page.getByRole('alert')).toContainText('Отметка уже изменилась')
    await expect(page.getByRole('switch')).not.toBeChecked();await expect(page.getByRole('button',{name:'Повторить сохранение'})).toHaveCount(0)
    await page.getByRole('button',{name:'Загрузить сохранённую версию'}).click();await expect(page.getByRole('switch')).toBeEnabled()
    expect(f.writes).toHaveLength(2);expect(f.writes[0]).toEqual(f.writes[1]);expect(f.mark.version).toBe(2)
  })
  test('conflict readback never silently overwrites another saved mark',async({page})=>{
    const f=await setup(page,{conflict:true});await page.goto(nativeAiUrl(card));await page.getByRole('switch').click()
    await expect(page.getByRole('switch')).toBeDisabled();await expect(page.getByRole('button',{name:'Повторить сохранение'})).toHaveCount(0)
    await page.getByRole('button',{name:'Загрузить сохранённую версию'}).click();await expect(page.getByRole('switch')).toBeChecked();expect(f.writes).toHaveLength(1)
  })
  test('revoked permission retains saved state without automatic resend',async({page})=>{
    const f=await setup(page,{denied:true});await page.goto(nativeAiUrl(card));await page.getByRole('switch').click()
    await expect(page.getByRole('alert')).toContainText('Доступ');await expect(page.getByRole('switch')).not.toBeChecked()
    await expect(page.getByRole('button',{name:'Повторить сохранение'})).toHaveCount(0);expect(f.writes).toHaveLength(1)
  })
  test('gate OFF hides the mark and never reads client corporate data',async({page})=>{
    const f=await setup(page,{allowed:false});await page.goto(nativeAiUrl(card));await expect(page.getByRole('heading',{name:'Алексей Смирнов',exact:true})).toBeVisible()
    await expect.poll(()=>f.gateReads).toBeGreaterThan(0);await expect(page.getByRole('switch',{name:'Сотрудник Яндекса'})).toHaveCount(0);expect(f.markReads).toBe(0)
  })
  test('failed gate is recoverable and cannot become a positive permission',async({page})=>{
    await setup(page,{failGate:true});await page.goto(nativeAiUrl(card));await expect(page.getByRole('switch')).toHaveCount(0)
    await page.getByRole('button',{name:'Повторить проверку'}).click();await expect(page.getByRole('switch')).not.toBeChecked()
  })
  test('admin can switch between existing services and personal statistics from the current page',async({page})=>{
    await setup(page);await page.goto(nativeAiUrl('/admin'));await page.getByRole('button',{name:'Статистика',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Статистика услуг',exact:true})).toBeVisible();await page.getByRole('button',{name:'Персональные',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Персональные тренировки',exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get('kind')).toBe('personal')
    await page.getByRole('button',{name:'Услуги',exact:true}).click();await expect(page.getByRole('heading',{name:'Статистика услуг',exact:true})).toBeVisible();await expect(page.locator('.corporate-service-counts dd')).toHaveText(['0','0','0','0'])
  })
  test('admin pagination retains previous rows on failure, then trainer filter resets cursor',async({page})=>{
    const f=await setup(page,{failPage:true});await page.goto(nativeAiUrl(admin));const rows=page.getByLabel('Учтённые персональные тренировки').locator('li')
    await expect(rows).toHaveCount(1);await page.getByRole('button',{name:'Показать ещё'}).click();await expect(page.getByRole('alert')).toContainText('Уже загруженные записи сохранены');await expect(rows).toHaveCount(1)
    await page.getByRole('button',{name:'Повторить загрузку'}).click();await expect(rows).toHaveCount(2)
    expect(f.ranges[1]?.toString()).toBe(f.ranges[2]?.toString())
    await page.getByText('Период и тренер',{exact:true}).click();await page.getByRole('combobox',{name:'Тренер персональных тренировок'}).selectOption(otherTrainer)
    await expect(rows).toHaveCount(1);await expect(rows).toContainText('Второй тренер');expect(f.ranges.at(-1)?.has('cursorId')).toBe(false)
    expect(f.ranges.every(r=>!r.has('officeId'))).toBe(true)
  })
  test('admin unavailable is distinct from empty and a successful retry returns zero',async({page})=>{
    await setup(page,{failStats:true,empty:true});await page.goto(nativeAiUrl(admin));await expect(page.getByLabel('Проведено персональных тренировок')).toHaveCount(0)
    await page.getByRole('button',{name:'Повторить',exact:true}).click();await expect(page.getByText('За этот период тренировок нет')).toBeVisible();await expect(page.getByLabel('Проведено персональных тренировок')).toContainText('0')
  })
  for(const theme of ['dark','light'])for(const width of [320,390,430,1440])test(`personal ${theme} mark and statistics at ${width}`,async({page},info)=>{
    await setup(page);await page.addInitScript(value=>localStorage.setItem('fit.appTheme',value),theme)
      await page.setViewportSize({width,height:width>700?1000:844});await page.goto(nativeAiUrl(card))
      const toggle=page.getByRole('switch',{name:'Сотрудник Яндекса'});await expect(toggle).toBeVisible()
      const hit=page.locator('.corporate-employee-mark .switch-row')
      expect((await hit.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await hit.scrollIntoViewIfNeeded();expect(await hit.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))})).toBe(true)
      const wasChecked=await toggle.isChecked();await hit.click({position:{x:20,y:25}});await expect(toggle).toBeChecked({checked:!wasChecked})
      await expect(page.locator('.corporate-employee-mark')).toContainText(wasChecked?'Старые занятия не добавятся':'07.11')
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
      await page.screenshot({path:info.outputPath(`personal-mark-${theme}-${width}.png`),fullPage:true,animations:'disabled'})
      await page.goto(nativeAiUrl(admin));await expect(page.getByLabel('Проведено персональных тренировок')).toBeVisible()
      const summary=page.getByText('Период и тренер',{exact:true});expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);await summary.click()
      expect((await page.getByRole('combobox',{name:'Тренер персональных тренировок'}).boundingBox())!.height).toBeGreaterThanOrEqual(44)
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
      await page.screenshot({path:info.outputPath(`personal-statistics-${theme}-${width}.png`),fullPage:true,animations:'disabled'})
      await page.getByLabel('Учтённые персональные тренировки').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`personal-details-${theme}-${width}.png`),fullPage:true,animations:'disabled'})
  })
}
