import {participantsMigrationGuard,participantsOwnerFilter} from './lime-participants-skin.scope'
import {test,expect} from '@playwright/test'
import {writeFile,readFile} from 'node:fs/promises'
import {clientId,trainerId,limeClients,mockPilot,mockPublicTrainer,publicTrainerId} from './fit-lime-fixtures'
import {captureEditorSkin,settleEditorPaint,observeEditorImages} from './lime-editor-skin.probe'
const samples=[
 ...['list','archive','new','edit','detail','empty','error','add-menu','detail-menu','detail-expanded'].map(mode=>({role:'trainer' as const,mode})),
 ...['catalog','filters','public','catalog-empty','catalog-error','public-empty','public-error'].map(mode=>({role:'client' as const,mode})),
]
export function limeParticipantsSkinCases(){
 for(const sample of samples)for(const theme of ['light','dark']as const)test(`Participants Lime skin ${sample.role}-${sample.mode}-${theme}`,async({page},info)=>{
  observeEditorImages(page)
  await page.setViewportSize({width:sample.role==='trainer'&&theme==='dark'?1440:390,height:1000})
  await page.clock.setFixedTime(new Date('2026-11-16T09:00:00Z'))
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.addInitScript(({theme,actor})=>{localStorage.setItem('fit.appTheme',theme);localStorage.setItem('fit.clientLime.theme.'+actor,theme);localStorage.setItem('fit.clientLime.theme.',theme);localStorage.setItem('fit.installDismissed','true')},{theme,actor:trainerId})
  await page.route('**/v1/**',route=>route.abort())
  const fixture=await mockPilot(page,{role:sample.role,fitLime:sample.role==='trainer',clientLime:sample.role==='client',clientRecords:sample.mode==='archive'?limeClients.map(c=>({...c,archivedAt:'2026-10-01T00:00:00Z'})):limeClients,hasClients:sample.mode!=='empty',failClients:sample.mode==='error'})
  await mockPublicTrainer(page)
  if(sample.mode==='catalog-empty')await page.route('**/v1/trainers/catalog*',route=>route.fulfill({json:{items:[],totalCount:0,nextOffset:null}}))
  if(sample.mode==='catalog-error')await page.route('**/v1/trainers/catalog*',route=>route.fulfill({status:503,json:{error:'unavailable'}}))
  if(sample.mode==='public-empty')await page.route(`**/v1/trainers/${publicTrainerId}/public-profile`,route=>route.fulfill({json:{publicId:publicTrainerId,published:null}}))
  if(sample.mode==='public-error')await page.route(`**/v1/trainers/${publicTrainerId}/public-profile`,route=>route.fulfill({status:503,json:{error:'unavailable'}}))
  await page.route('http://127.0.0.1:5173/assets/startup-photo-983c93dc4df8.jpg',async route=>route.fulfill({contentType:'image/jpeg',body:await readFile('public/assets/startup-photo-983c93dc4df8.jpg')}))
  const paths:Record<string,string>={list:'/clients',archive:'/clients/archive',new:'/clients/new',edit:`/clients/${clientId}/edit`,detail:`/clients/${clientId}`,empty:'/clients',error:'/clients',catalog:'/me/trainers',filters:'/me/trainers',public:`/trainers/${publicTrainerId}`,'add-menu':'/clients','detail-menu':`/clients/${clientId}`,'detail-expanded':`/clients/${clientId}`,'catalog-empty':'/me/trainers','catalog-error':'/me/trainers','public-empty':`/trainers/${publicTrainerId}`,'public-error':`/trainers/${publicTrainerId}`} 
  const errors:string[]=[],writes:unknown[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/v1/')&&!['GET','OPTIONS'].includes(r.method()))writes.push({path:new URL(r.url()).pathname,method:r.method(),body:r.postDataJSON()as unknown})})
  await page.goto(paths[sample.mode]!)
  await expect(page.locator('.phone-frame')).toBeVisible()
  if(sample.role==='client'){if(theme==='light')await expect(page.locator('.phone-frame')).toHaveClass(/theme-light/);else await expect(page.locator('.phone-frame')).not.toHaveClass(/theme-light/)}
  if(sample.mode.endsWith('error'))await expect(page.getByRole('alert')).toBeVisible()
  else await expect(page.locator('.state-panel').filter({hasText:'Загрузка'})).toHaveCount(0)
  if(['list','archive'].includes(sample.mode))await expect(page.getByRole('link',{name:/Алексей Смирнов/})).toBeVisible()
  if(['new','edit'].includes(sample.mode))await expect(page.getByLabel('Имя',{exact:true})).toBeVisible()
  if(sample.mode==='detail')await expect(page.getByRole('heading',{name:'Алексей Смирнов',exact:true})).toBeVisible()
  if(['catalog','filters','public'].includes(sample.mode))await expect(page.getByRole('heading',{name:'Тестовый тренер',exact:true})).toBeVisible()
  const states:unknown[]=[]
  async function capture(state:string){
   if(sample.mode==='filters')await page.mouse.move(0,0)
   await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images).map(i=>i.decode().catch(()=>undefined)));await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))})
   await settleEditorPaint(page,'.phone-frame',{selector:'.phone-frame',families:[],knownGuards:[],migrationGuard:':where(:not(.mc58-unused))',ownerFilter:'.mc58-unused',ownerSelectors:[]})
   const dom=await page.locator('.phone-frame').evaluate(root=>root.outerHTML)
   const data=await captureEditorSkin(page,'*',[],[],true)
   expect(data.length).toBeGreaterThan(10)
   const matches=await page.evaluate(()=>{const result:{selector:string;properties:{property:string;value:string;important:string}[]}[]=[];function walk(rules:CSSRuleList){for(const rule of Array.from(rules)){if(rule instanceof CSSStyleRule){try{if(Array.from(document.querySelectorAll(rule.selectorText)).some(n=>n.closest('.phone-frame')))result.push({selector:rule.selectorText,properties:Array.from(rule.style).map(property=>({property,value:rule.style.getPropertyValue(property),important:rule.style.getPropertyPriority(property)}))})}catch{/* Unsupported pseudo selectors are inventoried separately. */}}else if('cssRules'in rule)walk((rule as CSSGroupingRule).cssRules)}}for(const sheet of Array.from(document.styleSheets)){try{walk(sheet.cssRules)}catch{/* Cross-origin sheets cannot be read. */}}return result})
   await page.screenshot({path:info.outputPath(state+'.png'),animations:'allow',caret:'initial',fullPage:false})
   expect(await captureEditorSkin(page,'*',[],[],true)).toEqual(data)
   expect(await page.locator('.phone-frame').evaluate(root=>root.outerHTML)).toBe(dom)
   states.push({state,dom,data,matches})
  }
  await capture('initial')
  if(sample.mode==='add-menu'){await page.getByRole('button',{name:'Добавить',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await capture('add-menu');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0)}
  if(sample.mode==='detail-menu'){await page.getByRole('button',{name:'Действия с профилем спортсмена',exact:true}).click();await expect(page.getByRole('menu')).toBeVisible();await capture('detail-menu');await page.keyboard.press('Escape')}
  if(sample.mode==='detail-expanded'){await page.getByText('Статистика, замеры и питание',{exact:true}).click();await capture('detail-expanded')}
  if(sample.mode==='list'){const search=page.getByRole('searchbox',{name:'Поиск клиента'});await search.fill('Алексей');await expect(page.getByRole('link',{name:/Алексей Смирнов/})).toBeVisible();await capture('search');await page.getByRole('button',{name:'Очистить поиск',exact:true}).click();await expect(search).toHaveValue('')}
  if(sample.mode==='filters'){await page.getByRole('button',{name:'Фильтры',exact:true}).click();const sheet=page.getByRole('dialog',{name:'Фильтры тренеров'});await expect(sheet).toBeVisible();await sheet.getByLabel('Город',{exact:true}).fill('Москва');await capture('filters');await sheet.getByRole('button',{name:'Показать тренеров'}).click();await expect(sheet).toHaveCount(0);await capture('filtered')}
  if(sample.mode==='new'){await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.getByText('Введите имя',{exact:true})).toBeVisible();await capture('validation');await page.getByRole('textbox',{name:'Имя Введите имя',exact:true}).fill('Новый спортсмен');await capture('input')}
  if(sample.mode==='error'){fixture.setClientsFailure(false);await page.getByRole('button',{name:'Повторить',exact:true}).click();await expect(page.getByRole('link',{name:/Алексей Смирнов/})).toBeVisible();await capture('recovered')}
  expect(errors).toEqual([])
  if(process.env.FIT_PARTICIPANTS_SKIN_BASELINE!=='1'){
   const normalize=(s:string)=>s.replace(/,\s*/g,',').replace(/"/g,"'")
   for(const state of states as {matches:{selector:string}[]}[]){
    expect(state.matches.filter(r=>normalize(r.selector).includes(normalize(participantsMigrationGuard)))).toEqual([])
    expect(state.matches.some(r=>normalize(r.selector).includes(normalize(':where('+participantsOwnerFilter+')')))).toBe(true)
   }
  }
  await writeFile(info.outputPath('participants.json'),JSON.stringify({sample,theme,states,writes,errors}))
 })
}
