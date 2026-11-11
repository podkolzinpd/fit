import {captureLimeErrorSemantics,expectLimeErrorSemantics} from './lime-error-semantics'
import {expect,test} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {mockPilot,mockClientStreamingVoice,coachGestureWorkout,workoutId,clientId,trainerId} from './fit-lime-fixtures'
import {probeEditorSkin,assertEditorOwnership,observeEditorImages} from './lime-editor-skin.probe'

// Reuse the real form and page-scoped repository fixture. Shared editor behavior
// is exercised by the existing plan/date/metric/drag suites, not duplicated here.
export function limeEditorSkinCases(){
 const samples=[
  {role:'client',theme:'dark',width:390,mode:'plan',lime:true,compact:false},
  {role:'client',theme:'light',width:430,mode:'plan',lime:true,compact:true},
  {role:'trainer',theme:'dark',width:390,mode:'plan',lime:true,compact:false},
  {role:'trainer',theme:'light',width:430,mode:'group',lime:true,compact:true},
  {role:'trainer',theme:'dark',width:1440,mode:'plan',lime:true,compact:false},
  {role:'client',theme:'light',width:390,mode:'done',lime:true,compact:false},
  {role:'trainer',theme:'dark',width:430,mode:'done',lime:true,compact:true},
  {role:'client',theme:'dark',width:375,mode:'empty',lime:true,compact:false},
  {role:'trainer',theme:'light',width:375,mode:'empty',lime:true,compact:true},
  {role:'client',theme:'dark',width:390,mode:'plan',lime:false,compact:false},
  {role:'trainer',theme:'dark',width:390,mode:'plan',lime:false,compact:false},
  {role:'trainer',theme:'dark',width:390,mode:'template',lime:true,compact:false},
  {role:'client',theme:'light',width:390,mode:'today',lime:true,compact:false},
  {role:'trainer',theme:'dark',width:430,mode:'today',lime:true,compact:true},
  {role:'client',theme:'light',width:390,mode:'date',lime:true,compact:false},
  {role:'trainer',theme:'dark',width:390,mode:'date',lime:true,compact:false},
  {role:'client',theme:'dark',width:390,mode:'settings',lime:true,compact:false},
  {role:'trainer',theme:'light',width:430,mode:'settings',lime:true,compact:true},
  {role:'client',theme:'light',width:430,mode:'running-settings',lime:true,compact:true},
  {role:'trainer',theme:'dark',width:390,mode:'running-settings',lime:true,compact:false},
  {role:'trainer',theme:'dark',width:390,mode:'template-sheet',lime:true,compact:false},
  {role:'client',theme:'light',width:430,mode:'exit',lime:true,compact:true},
  {role:'trainer',theme:'dark',width:390,mode:'exit',lime:true,compact:false},
  {role:'trainer',theme:'light',width:375,mode:'client-picker',lime:true,compact:true},
  {role:'client',theme:'light',width:430,mode:'save',lime:true,compact:true},
  {role:'trainer',theme:'dark',width:390,mode:'save',lime:true,compact:false},
  {role:'client',theme:'light',width:430,mode:'clarify',lime:true,compact:true},
  {role:'trainer',theme:'dark',width:390,mode:'clarify',lime:true,compact:false},
 ] as const
 for(const sample of samples)test('Editor Lime skin ownership '+Object.values(sample).join('-'),async({page},info)=>{
  observeEditorImages(page)
  const id=sample.role==='client'?'c11e0000-6010-4000-8000-000000000001':'c0ac0000-6010-4000-8000-000000000001'
  const errors:string[]=[],failed:string[]=[],responses:{status:number;path:string}[]=[],consoleErrors:{text:string;path:string}[]=[],writes:{path:string;body:unknown}[]=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(new URL(r.url()).pathname))
  page.on('response',r=>{if(r.status()>=400)responses.push({status:r.status(),path:new URL(r.url()).pathname})})
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push({text:m.text(),path:new URL(m.location().url||page.url()).pathname})})
  page.on('request',r=>{if(['POST','PUT','DELETE','PATCH'].includes(r.method())&&new URL(r.url()).pathname.startsWith('/v1/workout'))writes.push({path:new URL(r.url()).pathname,body:r.postDataJSON()})})
  await page.setViewportSize({width:sample.width,height:sample.width===1440?1000:844});await page.emulateMedia({reducedMotion:'reduce'})
  await page.addInitScript(({id,sample})=>{
   const NativeDate=Date,fixed=NativeDate.parse('2026-09-24T12:00:00Z')
   window.Date=new Proxy(NativeDate,{construct:(t,args,n)=>Reflect.construct(t,args.length?args:[fixed],n) as Date,apply:()=>new NativeDate(fixed).toString(),get:(t,k,r)=>k==='now'?()=>fixed:Reflect.get(t,k,r) as unknown})
   localStorage.setItem('fit.appTheme',sample.theme);localStorage.setItem('fit.clientLime.theme.'+id,sample.theme)
   localStorage.setItem('fit.workoutTimeWheel',String(sample.mode==='done'));localStorage.setItem('fit.rpeDisplay.'+id,'true');localStorage.setItem('fit.restDisplay.'+id,'true')
   localStorage.setItem('fit.clientLiveDensity.'+id,sample.compact?'compact':'original');localStorage.setItem('fit.coachLiveDensity.'+id,sample.compact?'compact':'original')
  },{id,sample})
  const source=coachGestureWorkout(sample.mode==='group',3)
  Object.assign(source,{createdBy:id,trainerId:sample.role==='trainer'?id:trainerId,status:sample.mode==='done'?'done':'planned',startedAt:sample.mode==='done'?'2026-09-24T10:00:00Z':null,completedAt:sample.mode==='done'?'2026-09-24T11:00:00Z':null,title:'План: длинное название тренировки без потери исходных значений',notes:'Прежняя заметка к тренировке — сохранить при повторном вводе.'})
  if(sample.mode!=='group'){
   source.exercises[1]={...source.exercises[1]!,ref:'plank',name:'Планка с длинным названием упражнения',inputKind:'duration',sets:source.exercises[1]!.sets.map(s=>({...s,weightKg:undefined,reps:undefined,durationSec:90}))}
   source.exercises[2]={...source.exercises[2]!,ref:'running',name:'Бег',inputKind:'distance',sets:source.exercises[2]!.sets.map(s=>({...s,weightKg:undefined,reps:undefined,durationSec:600,distanceKm:1.5}))}
  }
  source.exercises.forEach(e=>{e.trainerComment='Прежний комментарий к технике';e.sets.forEach(s=>{if(sample.mode==='done')Object.assign(s,{fact:{weightKg:s.weightKg,reps:s.reps,durationSec:s.durationSec,distanceKm:s.distanceKm,rpe:7},confirmedAt:'2026-09-24T10:05:00Z'})})})
  await mockPilot(page,{role:sample.role,profileId:id,fitLime:sample.lime,clientLime:sample.role==='client'&&sample.lime,workouts:[source],scheduleDensity:sample.compact?'compact':'comfortable'})
  await page.route('**/v1/push-notifications/status',r=>r.fulfill({json:{status:{subscribed:false,preferences:{workout_reminder:true,workout_scheduled:true,chat_message:true}}}}))
  await page.route('**/v1/exercise-media/sign-batch',r=>{const {paths}=r.request().postDataJSON() as {paths:string[]};return r.fulfill({json:{signedUrls:paths.map(path=>({path,signedUrl:new URL('/exercises/vital/air-bike-sprint.jpg',page.url()).href}))}})})
  if(sample.mode==='today')await page.addInitScript(({id,source,clientId,role})=>{localStorage.setItem('fit.today-draft.'+id+(role==='client'?'.plan.client-mc518':''),JSON.stringify({screen:'review',text:'Приседания 3 по 8',choices:{},items:source.exercises.map(e=>({line:e.name,exercise:{source:e.source,ref:e.ref,name:e.name,muscleGroup:e.muscleGroup,inputKind:e.inputKind},sets:e.sets,hasValues:true})),notes:source.notes,workoutDate:'2026-09-24',clientId,recordMode:'planned',startTime:'10:00',trainingFormat:'self'}));if(role==='client')localStorage.setItem('fit.client-today-drafts.'+id,JSON.stringify(['mc518']))},{id,source,clientId,role:sample.role})
  let releaseTemplates=()=>{},templateCalls=0
  const templatesGate=new Promise<void>(resolve=>{releaseTemplates=resolve})
  if(sample.mode==='template-sheet')await page.route('**/v1/workout-templates',async route=>{templateCalls++;if(templateCalls<=2){if(templateCalls===1)await templatesGate;return route.fulfill({status:503,json:{error:'fixture_template_unavailable'}})}return route.fulfill({json:{templates:[{id:'10000000-0000-4000-8000-000000000077',trainerId:id,name:'Шаблон с длинным названием и исходными параметрами',notes:'Прежний шаблон',exercises:[source.exercises[0]],version:1,createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'}]}})})
  let parseCalls=0,releaseParse=()=>{},releaseVoiceParse=()=>{};const parseGate=new Promise<void>(resolve=>{releaseParse=resolve}),voiceParseGate=new Promise<void>(resolve=>{releaseVoiceParse=resolve});const parseCandidates:{ref:string;name:string}[]=[],parseRequests:{text:string;catalogSize:number;candidateRefs:string[]}[]=[]
  if(sample.mode==='clarify')await mockClientStreamingVoice(page,'Движение MC518VOICE 1 по 10 25 кг')
  if(sample.mode==='clarify')await page.route('**/v1/assistant/yandex/parse-workout',async route=>{
   parseCalls++;const body=route.request().postDataJSON() as {text:string;systemCatalog:{ref:string;name:string;inputKind:string}[]};const candidates=body.systemCatalog.filter(e=>e.inputKind==='strength').slice(0,2);expect(candidates).toHaveLength(2);if(!parseCandidates.length)parseCandidates.push(...candidates.map(e=>({ref:e.ref,name:e.name})));parseRequests.push({text:body.text,catalogSize:body.systemCatalog.length,candidateRefs:candidates.map(e=>e.ref)})
   if(parseCalls===1){await parseGate;return route.fulfill({status:503,headers:{'x-fit-request-id':'10000000-0000-4000-8000-000000005518'},json:{error:'fixture_parser_unavailable'}})}
   if(parseCalls===3){await voiceParseGate;return route.fulfill({json:{items:[],unmatched:body.text.split('\n').map((sourceText,position)=>({sourceText,position,reason:'not-found',suggestedExerciseRefs:[],sets:[]}))}})}
   expect(parseCalls).toBe(2);return route.fulfill({json:{items:[],unmatched:body.text.split('\n').map((sourceText,position)=>({sourceText,position,reason:'ambiguous',suggestedExerciseRefs:candidates.map(e=>e.ref),sets:[{weightKg:80,reps:8}]}))}})
  })
  const path=sample.mode==='template'?'/schedule/templates/new/editor':sample.mode==='today'?(sample.role==='client'?'/me?view=review&draft=mc518':'/today?view=review'):(sample.mode==='empty'||sample.mode==='clarify')?'/workouts/new?date=2026-09-24&clientId='+clientId:sample.mode==='client-picker'?'/workouts/new?date=2026-09-24':sample.mode==='exit'?'/workouts/new?copy='+workoutId:'/workouts/'+workoutId+'/edit'
  await page.goto(path)
  const frame=page.locator('.phone-frame');await expect(frame).toHaveClass(/workout-create-edit-identity/)
  if(sample.lime)await expect(frame).toHaveClass(/fit-lime-shell/);else await expect(frame).not.toHaveClass(/fit-lime-shell/)
  if(sample.lime&&sample.role==='client'){await expect(frame).toHaveClass(/client-workout-reference/);if(sample.mode!=='today')await expect(page.locator('.client-reference-form')).toHaveClass(/client-editor-refined/);else await expect(page.locator('.today-review')).toHaveClass(/client-editor-refined/)}
  if(sample.lime&&sample.role==='trainer')await expect(frame).not.toHaveClass(/theme-light/)
  if(!sample.lime)await expect(frame).not.toHaveClass(/coach-workout-reference|client-workout-reference/)
  const rootClasses=await frame.getAttribute('class')
  const pageSelector=sample.mode==='template'?'.workout-template-editor-page':sample.mode==='today'?'.today-review':'.workout-form-page'
  await expect(page.locator(pageSelector)).toBeVisible();await page.evaluate(()=>document.fonts.ready)
  if(sample.mode==='today')await expect(page.locator('.today-exercise')).toHaveCount(3)
  let hoverDanger:Awaited<ReturnType<typeof captureLimeErrorSemantics>>|undefined
  const voiceRecordingPoints:unknown[]=[]
  const states:Array<{state:string}&Awaited<ReturnType<typeof probeEditorSkin>>>=[]
  const probe=async(name:string)=>{if(sample.mode==='save')await page.mouse.move(1,1);await page.mouse.move(0,0);states.push({state:name,...await probeEditorSkin(page,info.outputPath('editor-'+name+'.png'),sample.mode==='template'?pageSelector:undefined)})}
  const rawInitial=await page.locator('.content').evaluate(n=>({y:n.scrollTop,height:n.scrollHeight,client:n.clientHeight}))
  await probe('initial')
  if((['plan','group','done'] as readonly string[]).includes(sample.mode)){
   const details=page.locator('details.coach-plan-options,details.workout-notes,details.exercise-options');for(const d of await details.all())if(await d.isVisible()&&!await d.getAttribute('open'))await d.locator(':scope > summary').click()
   await probe('options')
   const first=page.locator('.planned-exercise').first(),weight=first.getByLabel(sample.mode==='done'?'Фактический вес, подход 1':'Вес, подход 1',{exact:true})
   if(await weight.count()){await weight.fill('27.5');await weight.press('Tab');await expect(weight).toHaveValue('27.5')}
   await probe('input')
   if(sample.mode==='done'&&sample.role==='client'){
    const trigger=page.locator('.workout-duration-trigger').first();await trigger.click();await expect(page.locator('.workout-duration-sheet')).toBeVisible();await probe('duration-wheel');await page.getByRole('button',{name:'Закрыть выбор времени',exact:true}).click()
   }
   await page.locator('.content').evaluate(n=>{n.scrollTop=n.scrollHeight});await probe('bottom')
  }
  if(sample.role==='trainer'&&sample.mode==='done'){
   // Completed editing deliberately keeps the non-reference X control. Real
   // hover/keyboard states audit legacy dynamic paint, not only static frames.
   const dynamicProbe=async(name:string)=>states.push({state:name,...await probeEditorSkin(page,info.outputPath('editor-'+name+'.png'))})
   const remove=page.locator('button.planned-set-remove').first();await remove.hover();expect(await remove.evaluate(n=>n.matches(':hover'))).toBe(true);await dynamicProbe('hover-remove');expect(await remove.evaluate(n=>n.matches(':hover'))).toBe(true);hoverDanger=await captureLimeErrorSemantics(remove)
   await page.mouse.move(0,0);const toggle=page.locator('.compact-editor-exercise-toggle').first();await toggle.focus()
   await page.keyboard.press(info.project.name.includes('webkit')?'Alt+Tab':'Tab');await page.keyboard.press(info.project.name.includes('webkit')?'Alt+Shift+Tab':'Shift+Tab');await expect(toggle).toBeFocused();expect(await toggle.evaluate(n=>n.matches(':focus-visible'))).toBe(true);await dynamicProbe('keyboard-toggle')
   const title=page.getByRole('textbox',{name:'Название тренировки',exact:true});await title.focus();await expect(title).toBeFocused();await dynamicProbe('keyboard-title')
   const unit=page.locator('select.run-distance-unit').first();await unit.focus();await expect(unit).toBeFocused();await dynamicProbe('keyboard-unit')
  }
  if(sample.mode==='clarify'){
   const entry=page.locator('.quick-workout-entry');await expect(entry).toBeVisible();if(sample.role==='trainer')await entry.getByRole('button',{name:'Ввести текстом',exact:true}).click()
   const text=entry.getByLabel('Запись тренировки',{exact:true}),transcript='1. Круговая\n- Движение MC518A 3 по 8 80 кг\n- Движение MC518B 3 по 8 80 кг\n2. Круговая\n- Движение MC518C 3 по 8 80 кг\n- Движение MC518D 3 по 8 80 кг'
   if(sample.role==='trainer'&&info.project.name.includes('chromium')){
    // A real multiline keyboard path complements the retained bulk-fill scroll
    // observation; never normalize viewport or suppress the native resize RAF.
    const lines=transcript.split('\n');for(let index=0;index<lines.length;index++){await text.pressSequentially(lines[index]!);if(index<lines.length-1)await text.press('Enter')}
   }else await text.fill(transcript)
   await expect(text).toHaveValue(transcript);await probe('parse-input');const parse=entry.locator('.quick-workout-add');await expect(parse).toHaveText('Разобрать тренировку');await parse.click();await expect(parse).toBeDisabled();await expect(parse).toHaveText('Разбираю тренировку…');await expect.poll(()=>parseCalls).toBe(1);await probe('parse-pending');releaseParse()
   const clarification=entry.locator('.quick-workout-clarification');await expect(clarification).toContainText('Не нашли упражнение');await expect(text).toHaveValue(transcript);await probe('parse-fallback')
   await text.fill(transcript+' ');await expect(parse).toHaveText('Разобрать тренировку');await parse.click();await expect(entry.locator('.quick-workout-candidates')).toHaveCount(4);await expect(entry.locator('.quick-workout-candidates .selected')).toHaveCount(0);await expect(entry.locator('.quick-workout-structure')).toBeVisible();await expect(entry.locator('.quick-workout-structure section + section')).toHaveCount(1);await probe('parse-ambiguous')
   await entry.locator('.quick-workout-candidates').first().locator('button').first().click();await expect(entry.locator('.quick-workout-candidates')).toHaveCount(3);await expect(entry.locator('.quick-workout-candidates .selected')).toHaveCount(0);await expect(parse).toHaveText('Добавить в план (1)');await expect(parse).toBeDisabled();await probe('parse-partial')
   for(let remaining=3;remaining>0;remaining--){await entry.locator('.quick-workout-candidates').first().locator('button').nth(remaining%2).click();await expect(entry.locator('.quick-workout-candidates')).toHaveCount(remaining-1);await expect(entry.locator('.quick-workout-candidates .selected')).toHaveCount(0)}await expect(entry.locator('.quick-workout-candidates')).toHaveCount(0);await expect(parse).toHaveText('Добавить в план (4)');await expect(parse).toBeEnabled();await probe('parse-resolved')
   await parse.click();const list=page.locator('.workout-form-exercises');await expect(list).toContainText(parseCandidates[0]!.name);await expect(list).toContainText(parseCandidates[1]!.name);const values=await list.locator('input.planned-set-input').evaluateAll(nodes=>nodes.map(n=>(n as HTMLInputElement).value));expect(values.filter(v=>v==='80')).toHaveLength(4);expect(values.filter(v=>v==='8')).toHaveLength(4);await probe('parse-added');expect(parseCalls).toBe(2);expect(writes).toEqual([])
   if(sample.role==='client')await page.locator('.quick-workout-expand').click();await expect(text).toHaveValue('');await entry.getByRole('button',{name:'Надиктовать тренировку',exact:true}).click();const stop=entry.getByRole('button',{name:/^Остановить/});await expect(stop).toBeVisible();await expect(entry.locator('.voice-input-status[role="alert"]')).toContainText('Сейчас распознаю:');await text.focus();await expect(text).toBeFocused();await expect(text).toHaveValue('');const selectionBefore=await text.evaluate((n:HTMLTextAreaElement)=>({value:n.value,start:n.selectionStart,end:n.selectionEnd,direction:n.selectionDirection,focused:document.activeElement===n}))
   const recording=await stop.evaluate(n=>{const css=getComputedStyle(n),rect=n.getBoundingClientRect(),field=n.closest('.quick-workout-entry')!.querySelector('textarea')!;const properties=['color','background-color','font-family','font-size','font-weight','border-top-width','border-top-color','border-top-style','border-right-width','border-right-color','border-right-style','border-bottom-width','border-bottom-color','border-bottom-style','border-left-width','border-left-color','border-left-style','border-radius','box-shadow'];return{label:n.textContent,rect:[rect.x,rect.y,rect.width,rect.height],paint:Object.fromEntries(properties.map(p=>[p,css.getPropertyValue(p)])),tokens:{pink:css.getPropertyValue('--lime-pink'),onAccent:css.getPropertyValue('--lime-text-on-accent')},acceptedRecordingOwner:n.matches('.phone-frame.fit-lime-shell.workout-create-edit-identity .voice-input-button.recording'),field:{value:field.value,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection,focused:document.activeElement===field}}})
   expect(recording.label).toMatch(/^Остановить · \d+:\d{2}$/);expect(recording.acceptedRecordingOwner).toBe(true);expect(recording.field).toEqual(selectionBefore);expect(recording.paint['font-size']).toBe(sample.role==='client'?'14px':'12px');voiceRecordingPoints.push(recording);await expect(text).toBeFocused();expect(await text.evaluate((n:HTMLTextAreaElement)=>({value:n.value,start:n.selectionStart,end:n.selectionEnd,direction:n.selectionDirection,focused:document.activeElement===n}))).toEqual(selectionBefore);await stop.click()
   const status=entry.locator('.voice-input > .voice-input-status[role="status"]');await expect(status).toContainText('Текст добавлен');await expect.poll(()=>parseCalls).toBe(3);await expect(entry.getByText('Текст распознан. Обрабатываем упражнения…',{exact:true})).toBeVisible();await probe('voice-success-pending')
   await status.getByRole('button',{name:'Отменить',exact:true}).click();await expect(status).toHaveCount(0);await expect(text).toHaveValue('');releaseVoiceParse();await expect(entry.getByText('Текст распознан. Обрабатываем упражнения…',{exact:true})).toHaveCount(0);await expect(entry.locator('.quick-workout-preview')).toHaveCount(0);await expect(list.locator('input.planned-set-input')).toHaveCount(values.length);await probe('voice-undo');expect(parseCalls).toBe(3);expect(writes).toEqual([])
  }
  if(sample.mode==='empty'){
   const choose=page.getByRole('button',{name:'Выбрать упражнения',exact:true});if(await choose.count()){await choose.click();await expect(page.locator('.exercise-picker')).toBeVisible();await probe('catalog-empty-editor');await page.getByRole('button',{name:'Закрыть',exact:true}).click()}
  }
  if(sample.mode==='date'){
   const trigger=page.getByRole('button',{name:sample.role==='client'?'Выбрать дату и время':'Выбрать дату',exact:true});await trigger.click()
   const dialog=page.getByRole('dialog',{name:sample.role==='client'?'Дата и время':'Дата',exact:true});await expect(dialog).toBeVisible();await probe('date-open')
   await page.getByRole('button',{name:'Закрыть календарь',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused()
  }
  if(sample.mode==='settings'||sample.mode==='running-settings'){
   const exercise=page.locator('.planned-exercise').nth(sample.mode==='running-settings'?2:0)
   if(sample.mode==='settings')await exercise.getByLabel('Вес, подход 1',{exact:true}).click()
   await exercise.getByRole('button',{name:'Ещё действия',exact:true}).click();await expect(page.getByRole('menu')).toBeVisible();if(sample.mode==='settings'){if(sample.role==='trainer'){await expect(page.getByRole('menuitem',{name:'Удалить подход 1',exact:true})).toBeEnabled();await expect(page.getByRole('menuitem',{name:'Удалить упражнение',exact:true})).toBeEnabled()}else{await expect(page.getByRole('menuitem',{name:/^Удалить подход/})).toHaveCount(0);await expect(page.getByRole('menuitem',{name:'Удалить',exact:true})).toBeEnabled()}}await probe('exercise-menu')
   await page.getByRole('menuitem',{name:'Настройки упражнения',exact:true}).click();const dialog=page.locator('.exercise-settings-sheet');await expect(dialog).toBeVisible();await probe('exercise-settings')
   if(sample.mode==='running-settings')await expect(dialog.locator('.running-preset-actions')).toBeVisible()
   await dialog.getByRole('button',{name:'Готово',exact:true}).click();await expect(dialog).not.toBeVisible()
  }
  if(sample.mode==='client-picker'){
   const trigger=page.locator('.coach-plan-client');await expect(trigger).toBeEnabled();await trigger.click();const dialog=page.getByRole('dialog',{name:'Выбор клиента',exact:true});await expect(dialog).toBeVisible();await probe('clients-list')
   await dialog.getByRole('textbox',{name:'Поиск клиента',exact:true}).fill('Несуществующий спортсмен');await expect(dialog).toContainText('Никого не нашли');await probe('clients-search-empty')
   await dialog.getByRole('button',{name:'Клиент',exact:true}).click();await expect(dialog.getByRole('textbox',{name:'Имя нового клиента',exact:true})).toBeVisible();await probe('clients-create')
   await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(dialog).not.toBeVisible()
  }
  if(sample.mode==='exit'){
   await page.getByRole('textbox',{name:'Название тренировки',exact:true}).fill('Несохранённый план для проверки отмены')
   await page.getByRole('button',{name:'Назад',exact:true}).click();const dialog=page.getByRole('alertdialog');await expect(dialog).toBeVisible();await probe('exit-confirm')
   await dialog.getByRole('button',{name:'Отмена',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByRole('textbox',{name:'Название тренировки',exact:true})).toHaveValue('Несохранённый план для проверки отмены')
  }
  if(sample.mode==='template-sheet'){
   await page.getByRole('button',{name:'Добавить шаблон',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Добавить шаблон тренировки',exact:true});await expect(dialog).toBeVisible();await expect(dialog).toContainText('Загрузка');await probe('templates-loading');releaseTemplates()
   await expect(dialog.getByRole('button',{name:'Повторить',exact:true})).toBeVisible();await probe('templates-error');await dialog.getByRole('button',{name:'Повторить',exact:true}).click();await expect(dialog.locator('.workout-template-picker-item')).toHaveCount(1);await probe('templates-list')
   const search=dialog.getByRole('searchbox',{name:'Поиск по названию шаблона',exact:true});await search.fill('Несуществующий шаблон');await expect(dialog).toContainText('Ничего не найдено');await probe('templates-search-empty');await dialog.getByRole('button',{name:'Очистить поиск',exact:true}).click()
   await dialog.locator('.workout-template-picker-item').click();await expect(dialog).not.toBeVisible();await expect(page.locator('.planned-exercise')).toHaveCount(4);expect(templateCalls).toBe(3)
  }
  if(sample.mode==='save'){
   if(sample.role==='trainer'){const options=page.locator('details.coach-plan-options');await options.locator(':scope > summary').click();await expect(options).toHaveAttribute('open','')}
   const weight=page.locator('.planned-exercise').first().getByLabel('Вес, подход 1',{exact:true}),save=page.locator(sample.role==='trainer'?'.coach-plan-save':'.workout-action-row .workout-cta')
   await expect(save).toHaveAccessibleName('Сохранить план')
   await weight.fill('-1');await save.click();expect(await weight.evaluate((n:HTMLInputElement)=>n.checkValidity())).toBe(false);expect(writes).toHaveLength(0);await probe('save-validation')
   await weight.fill('27.5');expect(await weight.evaluate((n:HTMLInputElement)=>n.checkValidity())).toBe(true)
   let release=()=>{},calls=0;const gate=new Promise<void>(resolve=>{release=resolve})
   await page.route('**/v1/workouts/'+workoutId,async route=>{if(route.request().method()!=='PUT')return route.fallback();calls++;if(calls===1){await gate;return route.fulfill({status:503,headers:{'x-fit-request-id':'10000000-0000-4000-8000-000000005518'},json:{error:'fixture_form_save_unavailable'}})}return route.fallback()})
   await save.click();await expect(save).toBeDisabled();await expect(save).toHaveAttribute('aria-busy','true');await expect.poll(()=>calls).toBe(1)
   if(sample.role==='trainer'){const prep=page.locator('select[name=prepSeconds]');await expect(prep).toBeVisible();await expect(prep).toBeDisabled();await expect(page.locator('.workout-form fieldset').first()).toHaveAttribute('disabled','');await expect(page.locator('.workout-form fieldset').first()).toHaveJSProperty('disabled',true)}
   const box=await save.boundingBox();expect(box).not.toBeNull();await page.touchscreen.tap(box!.x+box!.width/2,box!.y+box!.height/2);expect(calls).toBe(1);await probe('save-pending');release()
   await expect(save).toBeEnabled();await expect(page.getByRole('alert')).toContainText('Не удалось сохранить тренировку');await expect(weight).toHaveValue('27.5');await probe('save-error')
   await save.click();await expect(page).toHaveURL(new RegExp('/workouts/'+workoutId+'$'));expect(calls).toBe(2);expect(writes).toHaveLength(2);expect(writes[1]!.body).toEqual(writes[0]!.body)
   expect((writes[0]!.body as {exercises:{sets:{weightKg:number}[]}[]}).exercises[0]!.sets[0]!.weightKg).toBe(27.5)
  }
  const rawFinal=await page.locator('.content').evaluate(n=>({y:n.scrollTop,height:n.scrollHeight,client:n.clientHeight}))
  await writeFile(info.outputPath('editor-skin.json'),JSON.stringify({sample,source,path,rootClasses,templateCalls,states,rawInitial,rawFinal,writes,...(sample.mode==='clarify'?{parseCalls,parseRequests,parseCandidates,voiceRecordingPoints}:{}),dynamicHover:hoverDanger,diagnostics:{errors,failed,responses,consoleErrors}},null,2))
  expect(errors).toEqual([]);expect(failed).toEqual([]);expect(responses).toEqual(sample.mode==='template-sheet'?[{status:503,path:'/v1/workout-templates'},{status:503,path:'/v1/workout-templates'}]:sample.mode==='save'?[{status:503,path:'/v1/workouts/'+workoutId}]:sample.mode==='clarify'?[{status:503,path:'/v1/assistant/yandex/parse-workout'}]:[]);expect(consoleErrors.filter(e=>!(((sample.mode==='template-sheet'&&e.path==='/v1/workout-templates')||(sample.mode==='save'&&e.path==='/v1/workouts/'+workoutId)||(sample.mode==='clarify'&&e.path==='/v1/assistant/yandex/parse-workout'))&&e.text.startsWith('Failed to load resource:')))).toEqual([]);if(sample.mode!=='save')expect(writes).toEqual([])
  if(hoverDanger)expectLimeErrorSemantics(hoverDanger)
  for(const state of states)assertEditorOwnership(state,sample.lime&&sample.mode!=='template')
 })
}
