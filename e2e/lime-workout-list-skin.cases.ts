import {expect,test} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {mockPilot,coachGestureWorkout,clientId,trainerId,type MockWorkout} from './fit-lime-fixtures'
import {probeEditorSkin,assertEditorOwnership,observeEditorImages} from './lime-editor-skin.probe'
import {workoutListContract} from './lime-workout-list-skin.contract'

// Separate navigation, query lifecycle and pagination cases keep each native
// collector bounded. All data is synthetic and every workout write is rejected.
export function limeWorkoutListSkinCases(){
 const samples=[
  {role:'client',theme:'light',width:390,mode:'current-list',lime:true},
  {role:'client',theme:'dark',width:430,mode:'history-list',lime:true},
  {role:'client',theme:'dark',width:375,mode:'current-calendar',lime:true},
  {role:'client',theme:'light',width:430,mode:'history-calendar',lime:true},
  {role:'client',theme:'light',width:375,mode:'history-list',lime:true},
  {role:'client',theme:'light',width:1440,mode:'history-copy-actions',lime:true},
  {role:'client',theme:'dark',width:1440,mode:'current-list',lime:true},
  {role:'client',theme:'light',width:390,mode:'current-empty',lime:true},
  {role:'client',theme:'dark',width:390,mode:'history-empty',lime:true},
  {role:'client',theme:'dark',width:430,mode:'list-error',lime:true},
  {role:'client',theme:'light',width:375,mode:'history-list-error',lime:true},
  {role:'client',theme:'light',width:390,mode:'history-month-error',lime:true},
  {role:'client',theme:'dark',width:430,mode:'current-month-error',lime:true},
  {role:'trainer',theme:'dark',width:390,mode:'list',lime:true},
  {role:'trainer',theme:'light',width:430,mode:'history-calendar',lime:true},
  {role:'trainer',theme:'dark',width:1440,mode:'list',lime:true},
  {role:'trainer',theme:'dark',width:375,mode:'empty',lime:true},
  {role:'trainer',theme:'dark',width:390,mode:'list-error',lime:true},
  {role:'trainer',theme:'dark',width:430,mode:'history-month-error',lime:true},
  {role:'client',theme:'light',width:390,mode:'presets-control',lime:true},
  {role:'client',theme:'dark',width:375,mode:'profile-bootstrap-control',lime:true},
  {role:'trainer',theme:'dark',width:390,mode:'templates-control',lime:true},
  {role:'client',theme:'dark',width:390,mode:'current-list',lime:false},
  {role:'trainer',theme:'dark',width:390,mode:'list',lime:false},
  {role:'client',theme:'light',width:390,mode:'pagination',lime:true},
  {role:'trainer',theme:'dark',width:430,mode:'pagination',lime:true},
 ] as const
 for(const sample of samples)test('Workout list Lime skin ownership '+Object.values(sample).join('-'),async({page},info)=>{
  observeEditorImages(page)
  const actor=sample.lime?(sample.role==='client'?'c11e0000-6010-4000-8000-000000000001':'c0ac0000-6010-4000-8000-000000000001'):'10000000-0000-4000-8000-000000000001'
  const preserved=sample.mode.endsWith('-control'),calendarMode=sample.mode.includes('calendar')||sample.mode.includes('month-error'),planned=sample.mode.startsWith('current'),history=sample.mode.startsWith('history')||sample.mode==='pagination'
  await page.setViewportSize({width:sample.width,height:sample.width===1440?1000:844})
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.addInitScript(({actor,theme})=>{
   const NativeDate=Date,fixed=NativeDate.parse('2026-11-12T09:00:00Z')
   window.Date=new Proxy(NativeDate,{construct:(t,a,n)=>Reflect.construct(t,a.length?a:[fixed],n) as Date,apply:()=>new NativeDate(fixed).toString(),get:(t,k,r)=>k==='now'?()=>fixed:Reflect.get(t,k,r) as unknown})
   localStorage.setItem('fit.appTheme',theme);localStorage.setItem('fit.clientLime.theme.'+actor,theme)
   const key='fit.coachmarks-seen.'+actor,seen=JSON.parse(localStorage.getItem(key)??'[]') as string[]
   localStorage.setItem(key,JSON.stringify([...seen,'trainer-workout-history-calendar-2026-09']))
  },{actor,theme:sample.theme})
  const row=(i:number,date:string,status:string):MockWorkout=>{
   const w=coachGestureWorkout(false,3)
   Object.assign(w,{id:`10000000-0000-4000-8000-${String(5200+i).padStart(12,'0')}`,clientId,trainerId:sample.role==='trainer'?actor:trainerId,createdBy:i%2?actor:trainerId,workoutDate:date,status,
    title:i===3?'Длинное название тренировки для проверки сохранения места для статуса, автора и личного рекорда':'Тренировка MC52 '+i,
    startTime:'10:00',endTime:'11:00',notes:'План и исходная заметка',startedAt:status==='planned'?null:date+'T07:00:00Z',completedAt:status==='done'?date+'T08:00:00Z':null,
    actualDurationSec:status==='done'?3600:null,activeCaloriesKcal:status==='done'?180:null,
    sessionRpe:status==='done'?8:null,wellbeing:status==='done'?'normal':null,discomfort:status==='done',
    clientComment:status==='done'?'Ощущения после тренировки: нагрузка сохранена, есть небольшой дискомфорт.':null,
    trainerReview:status==='done'?'Ответ тренера с длинным текстом: продолжаем по плану и сохраняем технику.':null,
    feedbackSubmittedAt:status==='done'?date+'T08:05:00Z':null,hasPr:i===3})
   w.exercises=w.exercises.map((e,j)=>({...e,name:j===0?'Приседания с длинным названием исходного упражнения':e.name,trainerComment:'Сохраняйте технику и темп',sets:e.sets.map(s=>({...s,fact:status==='done'?{weightKg:40,reps:10,rpe:8}:{},confirmedAt:status==='done'?date+'T08:00:00Z':null}))}))
   return w
  }
  const workouts=sample.mode.includes('empty')?[]:sample.mode==='pagination'?Array.from({length:26},(_,i)=>row(i,'2026-11-10','done')):[row(0,'2026-11-14','planned'),row(1,'2026-11-12','in_progress'),row(2,'2026-11-11','planned'),row(3,'2026-11-10','done'),row(4,'2026-11-10','done'),row(5,'2026-11-09','cancelled'),row(6,'2026-11-08','in_progress'),row(7,'2026-10-31','done')]
  // A completed workout today exercises the history calendar's actual
  // today+has-workout button, separately from a planned current-day marker.
  if(calendarMode&&!planned)workouts.push(row(8,'2026-11-12','done'))
  const backend=await mockPilot(page,{role:sample.role,profileId:actor,clientLime:sample.lime&&sample.role==='client',fitLime:sample.lime&&sample.role==='trainer',workouts})
  const original=JSON.stringify(backend.getWorkouts()),errors:string[]=[],failed:{method:string;path:string;error:string|null}[]=[],responses:{method:string;path:string;status:number}[]=[],consoleErrors:{path:string;text:string}[]=[],writes:{method:string;path:string;body:unknown}[]=[],reads:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('requestfailed',r=>failed.push({method:r.method(),path:new URL(r.url()).pathname,error:r.failure()?.errorText??null}))
  page.on('response',r=>{if(r.status()>=400)responses.push({method:r.request().method(),path:new URL(r.url()).pathname,status:r.status()})})
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push({path:new URL(m.location().url||page.url()).pathname,text:m.text()})})
  page.on('request',r=>{const u=new URL(r.url());if(u.pathname==='/v1/training-data')reads.push(u.pathname+u.search);if(['POST','PUT','PATCH','DELETE'].includes(r.method())&&u.pathname.startsWith('/v1/workouts'))writes.push({method:r.method(),path:u.pathname,body:r.postDataJSON()})})
  await page.route('**/v1/favorite-workouts',r=>r.fulfill({json:{favorites:[]}}))
  await page.route('**/v1/workout-templates',r=>r.fulfill({json:{templates:[]}}))
  await page.route('**/v1/push-notifications/status',r=>r.fulfill({json:{status:{subscribed:false,preferences:{workout_reminder:true,workout_scheduled:true,chat_message:true}}}}))
  let release=()=>{},held=0,fail=sample.mode.endsWith('error'),failureCount=0
  const gate=new Promise<void>(resolve=>{release=resolve})
  if(fail)await page.route('**/v1/training-data*',async r=>{
   const u=new URL(r.request().url()),p=u.searchParams
   const target=r.request().method()==='GET'&&p.get('scope')==='workouts'&&(sample.mode.includes('month-error')?p.has('from')&&p.has('to'):history?p.get('to')==='2026-11-12'&&!p.has('from'):p.get('from')==='2026-11-12'&&!p.has('to'))
   if(!target)return r.fallback()
   if(fail){held++;await gate;failureCount++;return r.fulfill({status:503,headers:{'x-request-id':'mc52-fixture-load'},json:{error:'unavailable'}})}
   return r.fallback()
  })
  if(sample.mode==='pagination')await page.route('**/v1/training-data*',async r=>{const p=new URL(r.request().url()).searchParams;if(r.request().method()==='GET'&&p.get('scope')==='workouts'&&p.get('offset')==='20'){held++;await gate}return r.fallback()})
  if(sample.mode==='profile-bootstrap-control')await page.route('**/v1/clients',async r=>{if(r.request().method()!=='GET')return r.fallback();held++;await gate;return r.fallback()})
  const clientPath='/me/workouts'+(sample.mode==='presets-control'?'?tab=presets':history?'?tab=history'+(calendarMode?'&view=calendar&month=2026-11':''):calendarMode?'?tab=current&plannedView=calendar&plannedMonth=2026-11':'')
  const path=sample.mode==='templates-control'?'/schedule/templates':sample.role==='client'?clientPath:`/clients/${clientId}/workouts${calendarMode?'?view=calendar&month=2026-11':''}`
  await page.goto(path)
  const selector=sample.mode==='templates-control'?'.workout-templates-page,.tab-bar':workoutListContract.selector
  const scope=page.locator(sample.role==='client'?'.client-workouts-page':'.trainer-client-workouts-page')
  const states:(Awaited<ReturnType<typeof probeEditorSkin>>&{state:string;url:string})[]=[]
  const probe=async(state:string,keepPointer=false)=>{if(!keepPointer)await page.mouse.move(0,0);states.push({...await probeEditorSkin(page,info.outputPath('list-'+state+'.png'),selector,workoutListContract),state,url:new URL(page.url()).pathname+new URL(page.url()).search})}
  if(sample.mode==='profile-bootstrap-control'){
   await expect.poll(()=>held).toBeGreaterThan(0);await expect(scope.locator('.skeleton-card').first()).toBeVisible();await probe('profile-loading');release();await expect(page.getByRole('tab',{name:'Актуальное',exact:true})).toBeVisible()
  }else{
   if(sample.role==='client')await expect(page.getByRole('tab',{name:sample.mode==='presets-control'?'Готовые тренировки':history?'История':'Актуальное',exact:true})).toHaveAttribute('aria-selected','true')
   if(sample.lime){await expect(page.locator(sample.role==='client'?'.phone-frame.fit-client-lime':'.phone-frame.fit-lime-shell')).toBeVisible();if(sample.role==='client')await expect(page.locator('.client-screen-reference')).toBeVisible()}
   else await expect(page.locator('.phone-frame.fit-client-lime,.phone-frame.fit-lime-shell')).toHaveCount(0)
   if(sample.role==='trainer'&&sample.lime)await expect(page.locator('.phone-frame')).not.toHaveClass(/theme-light/)
   if(fail){
    await expect.poll(()=>held).toBeGreaterThan(0)
    if(calendarMode)await expect(scope.locator('.client-history-calendar[aria-busy="true"]')).toBeVisible()
    else await expect(scope.locator('.skeleton-card').first()).toBeVisible()
    await probe('loading');release()
    const retry=scope.getByRole('button',{name:'Повторить',exact:true});await expect(retry).toBeVisible();await probe('load-error')
    fail=false;await retry.click()
    if(calendarMode){await expect(scope.locator('.client-history-calendar')).not.toHaveAttribute('aria-busy','true');await expect(scope.locator('.client-history-calendar-day.has-workout').first()).toBeVisible()}
    else await expect(scope.locator(history?'.workout-chronicle-card':'.client-workout-card').first()).toBeVisible()
    await expect(retry).toHaveCount(0);await probe('recovered');expect(failureCount).toBe(2)
   }else if(sample.mode==='presets-control'){
    await expect(scope.getByRole('heading',{name:'Избранное',exact:true})).toBeVisible();await probe('preserved-presets')
   }else if(sample.mode==='templates-control'){
    await expect(page.getByRole('heading',{name:'Шаблоны тренировок',exact:true})).toBeVisible();await probe('preserved-templates')
   }else if(sample.mode.includes('empty')){
    await expect(scope.getByRole('heading',{name:sample.role==='trainer'?'Тренировка для клиента':history?'Пока нет результатов':'Новая тренировка',exact:true})).toBeVisible();await probe('empty')
   }else if(calendarMode){
    const calendar=scope.locator('.client-history-calendar');await expect(calendar).toBeVisible();await expect(calendar).not.toHaveAttribute('aria-busy','true');await expect(calendar.locator('.has-workout').first()).toBeVisible();await probe('calendar')
    const next=calendar.getByRole('button',{name:'Следующий месяц',exact:true});if(planned)await expect(next).toBeEnabled();else await expect(next).toBeDisabled()
    const day=calendar.getByRole('button',{name:planned?'14 ноября 2026 г., 1 тренировка':'10 ноября 2026 г., 2 тренировки',exact:true});await day.click();await expect(day).toHaveAttribute('aria-pressed','true')
    const selection=calendar.locator('.client-history-calendar-selection');await expect(selection).toBeVisible()
    if(planned){await expect(selection.locator('.client-workout-card')).toHaveCount(1);await expect(selection.locator('.workout-chronicle-card')).toHaveCount(0)}
    else{await expect(selection.locator('.workout-chronicle-card')).toHaveCount(2);await expect(selection.locator('.workout-chronicle-copy')).toHaveCount(0);if(sample.role==='trainer')await expect(selection.locator('.calendar-day-details.coach-chronicle-card')).toHaveCount(2);else await expect(selection.locator('.calendar-day-details')).toHaveCount(0)}
    await probe('selected-day');await calendar.getByRole('button',{name:'Предыдущий месяц',exact:true}).click();await expect(calendar.locator('h3')).toHaveText('Октябрь 2026');await expect(calendar).not.toHaveAttribute('aria-busy','true')
    await expect(selection).toHaveCount(0);await expect(next).toBeEnabled();await probe('previous-month')
   }else if(sample.mode==='history-copy-actions'){
    await expect(scope.locator('.workout-chronicle-card')).toHaveCount(5)
    const copy=scope.locator('.workout-chronicle-copy').first(),url=page.url()
    await expect(copy).toHaveAttribute('href',/\/workouts\/new\?copy=/)
    await copy.hover();expect(await copy.evaluate(n=>n.matches(':hover'))).toBe(true);await probe('copy-hover',true)
    await page.mouse.down();expect(await copy.evaluate(n=>n.matches(':active'))).toBe(true);await probe('copy-pressed',true)
    // Cancel the native pointer gesture outside the link. Navigation handlers
    // remain installed; neither DOM nor CSSOM nor selection is patched.
    await page.mouse.move(0,0);await page.mouse.up();expect(page.url()).toBe(url)
    await copy.focus();await page.keyboard.press(info.project.name.includes('webkit')?'Alt+Tab':'Tab');await page.keyboard.press(info.project.name.includes('webkit')?'Alt+Shift+Tab':'Shift+Tab');await expect(copy).toBeFocused();expect(await copy.evaluate(n=>n.matches(':focus-visible'))).toBe(true);await probe('copy-focus-visible');expect(page.url()).toBe(url)
   }else if(sample.mode==='pagination'){
    await expect(scope.locator('.workout-chronicle-card')).toHaveCount(20);const more=scope.locator('button.wide.secondary');await expect(more).toHaveAccessibleName('Показать ещё');await expect(more).toBeVisible();await probe('first-page')
    await more.click();await expect.poll(()=>held).toBe(1);await expect(more).toBeDisabled();await expect(more).toHaveAccessibleName('Загружаем…');await expect(scope.locator('.workout-chronicle-card')).toHaveCount(20);await probe('next-page-pending')
    release();await expect(scope.locator('.workout-chronicle-card')).toHaveCount(26);await expect(more).toHaveCount(0);await probe('last-page')
   }else{
    await expect(scope.locator('.client-workout-card,.workout-chronicle-card').first()).toBeVisible()
    if(sample.role==='client'&&planned){await expect(scope.locator('.client-workout-card')).toHaveCount(2);await expect(scope.locator('.past-workout-plan-card')).toHaveCount(1);await expect(scope.locator('.workout-chronicle-card')).toHaveCount(0)}
    else{await expect(scope.locator('.workout-chronicle-card')).toHaveCount(5);if(sample.role==='trainer'){await expect(scope.locator('.coach-chronicle-card')).toHaveCount(5);await expect(scope.locator('.past-workout-plan-card')).toHaveCount(1)}else if(sample.lime)await expect(scope.locator('.compact-client-history')).toHaveCount(3)}
    await probe('list')
    if(sample.width===1440){const card=scope.locator('.client-workout-card,.workout-chronicle-card').first();await card.hover();expect(await card.evaluate(n=>n.matches(':hover'))).toBe(true);await probe('card-hover',true)}
    else if(history||sample.role==='trainer'){
     const copy=scope.locator('.workout-chronicle-copy').first();await expect(copy).toHaveAttribute('href',/\/workouts\/new\?copy=/);await copy.focus();await page.keyboard.press(info.project.name.includes('webkit')?'Alt+Tab':'Tab');await page.keyboard.press(info.project.name.includes('webkit')?'Alt+Shift+Tab':'Shift+Tab');await expect(copy).toBeFocused();expect(await copy.evaluate(n=>n.matches(':focus-visible'))).toBe(true);await probe('copy-keyboard-focus')
    }
   }
  }
  await writeFile(info.outputPath('workout-list-skin.json'),JSON.stringify({sample,path,states,reads,writes,failureCount,sourceHistoryUnchanged:JSON.stringify(backend.getWorkouts())===original,diagnostics:{errors,failed,responses,consoleErrors}}))
  if(sample.mode==='history-copy-actions'){
   const focused=states.at(-1)!.before.find(n=>n.tag==='A'&&n.class==='workout-chronicle-copy'&&n.interaction.focusVisible)
   expect(focused).toBeDefined()
   // Accepted later Lime owner (fit-lime-components.css) wins the old
   // copy-specific outline at equal specificity; the client layer owns color.
   expect(focused!.style).toMatchObject({'outline-width':'2px','outline-style':'solid','outline-offset':'3px'})
   expect(focused!.style['outline-color']).toBeTruthy()
   expect(focused!.style['outline-color']).not.toBe('rgba(0, 0, 0, 0)')
  }
  expect(errors).toEqual([]);expect(failed).toEqual([]);expect(writes).toEqual([]);expect(JSON.stringify(backend.getWorkouts())).toBe(original)
  // The existing query policy retries one transient GET; both failures are
  // required, scoped to this held list/month request, before manual recovery.
  const intentional=sample.mode.endsWith('error')?Array.from({length:2},()=>({method:'GET',path:'/v1/training-data',status:503})):[]
  expect(responses).toEqual(intentional)
  expect(consoleErrors.filter(e=>!intentional.some(x=>x.path===e.path)||!e.text.startsWith('Failed to load resource:'))).toEqual([])
  for(const state of states){if(preserved)expect(state.owners).toEqual([]);else assertEditorOwnership(state,sample.lime,workoutListContract)}
 })
}
