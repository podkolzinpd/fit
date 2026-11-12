import {expect,test,type Request} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import type {FavoriteWorkoutTemplate,WorkoutTemplate,WorkoutExerciseDraft} from '../src/shared/domain'
import {mockPilot,coachGestureWorkout,clientId,workoutId} from './fit-lime-fixtures'
import {probeEditorSkin,assertEditorOwnership,observeEditorImages} from './lime-editor-skin.probe'
import {librarySkinContract} from './lime-library-skin.contract'

// Paint/state coverage complements the existing reliability/draft/CRUD tests.
// Every backend mutation below is page-scoped and synthetic.
export function limeLibrarySkinCases(){
 const samples=[
  {role:'client',theme:'light',width:390,mode:'favorites',lime:true},
  {role:'client',theme:'dark',width:430,mode:'favorite-limit',lime:true},
  {role:'client',theme:'dark',width:375,mode:'favorite-states',lime:true},
  {role:'client',theme:'light',width:390,mode:'favorite-editor',lime:true},
  {role:'client',theme:'dark',width:430,mode:'favorite-save',lime:true},
  {role:'client',theme:'light',width:375,mode:'favorite-conflict',lime:true},
  {role:'trainer',theme:'dark',width:390,mode:'templates',lime:true},
  {role:'trainer',theme:'light',width:430,mode:'template-copy',lime:true},
  {role:'trainer',theme:'dark',width:375,mode:'template-states',lime:true},
  {role:'trainer',theme:'dark',width:1440,mode:'templates',lime:true},
  {role:'trainer',theme:'dark',width:390,mode:'source',lime:true},
  {role:'trainer',theme:'light',width:1440,mode:'source',lime:true},
  {role:'trainer',theme:'dark',width:430,mode:'template-editor',lime:true},
  {role:'trainer',theme:'light',width:390,mode:'template-save',lime:true},
  {role:'trainer',theme:'dark',width:375,mode:'template-empty',lime:true},
  {role:'client',theme:'dark',width:390,mode:'current-control',lime:true},
  {role:'trainer',theme:'dark',width:390,mode:'editor-control',lime:true},
  {role:'client',theme:'dark',width:390,mode:'favorites-off',lime:false},
  {role:'trainer',theme:'dark',width:390,mode:'templates-off',lime:false},
 ] as const
 for(const sample of samples)test('Library Lime skin ownership '+Object.values(sample).join('-'),async({page},info)=>{
  observeEditorImages(page)
  const actor=sample.lime?(sample.role==='client'?'c11e0000-6010-4000-8000-000000000001':'c0ac0000-6010-4000-8000-000000000001'):'10000000-0000-4000-8000-000000000001'
  await page.setViewportSize({width:sample.width,height:sample.width===1440?1000:844});await page.emulateMedia({reducedMotion:'reduce'})
  await page.addInitScript(({actor,theme})=>{const NativeDate=Date,fixed=NativeDate.parse('2026-11-11T09:00:00Z');window.Date=new Proxy(NativeDate,{construct:(t,a,n)=>Reflect.construct(t,a.length?a:[fixed],n) as Date,apply:()=>new NativeDate(fixed).toString(),get:(t,k,r)=>k==='now'?()=>fixed:Reflect.get(t,k,r) as unknown});localStorage.setItem('fit.appTheme',theme);localStorage.setItem('fit.clientLime.theme.'+actor,theme);localStorage.setItem('fit.rpeDisplay.'+actor,'true');localStorage.setItem('fit.restDisplay.'+actor,'true')},{actor,theme:sample.theme})
  const source=coachGestureWorkout(false,3);source.createdBy=actor;if(sample.role==='trainer')source.trainerId=actor
  const exercises:WorkoutExerciseDraft[]=source.exercises.map((e,index)=>({...e,position:index,sets:[{position:0,weightKg:20+index,reps:10},{position:1,weightKg:25+index,reps:8}]}))
  exercises[1]={...exercises[1]!,ref:'plank',name:'Планка с длинным названием для проверки переноса строки',inputKind:'duration',sets:[{position:0,durationSec:90}]}
  exercises[2]={...exercises[2]!,ref:'running',name:'Бег',inputKind:'distance',sets:[{position:0,durationSec:600,distanceKm:1.5}]}
  if(sample.mode==='favorite-editor'||sample.mode==='template-editor'){
   const groupId='10000000-0000-4000-8000-000000005530',duration=structuredClone(exercises[1]!)
   const group={blockId:groupId,blockType:'group' as const,blockPreset:'set' as const,blockRounds:2,restBetweenExercisesSec:15,restBetweenRoundsSec:90,restBetweenSetsSec:75}
   exercises[0]={...exercises[0]!,...group};exercises[1]={...source.exercises[1]!,position:1,...group,sets:[{position:0,weightKg:22,reps:10},{position:1,weightKg:27,reps:8}]};exercises.push({...duration,position:3,blockId:'10000000-0000-4000-8000-000000005531',blockType:'single',blockRounds:1})
  }
  const favoriteId='10000000-0000-4000-8000-000000005519',templateId='10000000-0000-4000-8000-000000005520'
  let favorites:FavoriteWorkoutTemplate[]=Array.from({length:sample.mode==='favorite-limit'?10:1},(_,i)=>({id:i?`10000000-0000-4000-8000-${String(5519+i).padStart(12,'0')}`:favoriteId,title:i?'Сохранённая тренировка '+i:'Силовая тренировка с длинным названием без потери исходных упражнений',version:1,createdAt:'2026-11-01T09:00:00Z',exercises:structuredClone(exercises)}))
  const templates:WorkoutTemplate[]=[{id:templateId,trainerId:actor,name:'Корпус и сила · длинное название исходного шаблона',notes:'Исходная заметка тренера',version:1,createdAt:'2026-11-01T09:00:00Z',updatedAt:'2026-11-10T09:00:00Z',exercises:structuredClone(exercises)}]
  const backend=await mockPilot(page,{role:sample.role,profileId:actor,clientLime:sample.lime&&sample.role==='client',fitLime:sample.lime&&sample.role==='trainer',workouts:[source],clientRecords:[{id:clientId,fullName:'Спортсмен MC519',archivedAt:null,version:1}]})
  const originalHistory=JSON.stringify(backend.getWorkouts()),writes:{method:string;path:string;body:unknown}[]=[],workoutWrites:string[]=[],errors:string[]=[],failed:{path:string;method:string;error:string|null;responseStatus:number|null}[]=[],responses:{path:string;method:string;status:number}[]=[],consoleErrors:{path:string;text:string}[]=[]
  const responseStatuses=new WeakMap<Request,number>()
  page.on('request',r=>{if(['POST','PUT','PATCH','DELETE'].includes(r.method())&&new URL(r.url()).pathname.startsWith('/v1/workouts'))workoutWrites.push(new URL(r.url()).pathname)})
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push({path:new URL(r.url()).pathname,method:r.method(),error:r.failure()?.errorText??null,responseStatus:responseStatuses.get(r)??null}));page.on('response',r=>{responseStatuses.set(r.request(),r.status());if(r.status()>=400)responses.push({path:new URL(r.url()).pathname,method:r.request().method(),status:r.status()})});page.on('console',m=>{if(m.type()==='error')consoleErrors.push({path:new URL(m.location().url||page.url()).pathname,text:m.text()})})
  await page.route('**/v1/push-notifications/status',r=>r.fulfill({json:{status:{subscribed:false,preferences:{workout_reminder:true,workout_scheduled:true,chat_message:true}}}}))
  await page.route('**/v1/exercise-media/sign-batch',r=>{const {paths}=r.request().postDataJSON() as {paths:string[]};return r.fulfill({json:{signedUrls:paths.map(path=>({path,signedUrl:new URL('/exercises/vital/air-bike-sprint.jpg',page.url()).href}))}})})
  let releaseList=()=>{},releaseMutation=()=>{},releaseParse=()=>{},parseCalls=0;const parseGate=new Promise<void>(resolve=>{releaseParse=resolve}),parseCandidates:{ref:string;name:string}[]=[],parseRequests:{text:string;candidateRefs:string[]}[]=[]
  if(sample.mode==='template-empty')await page.route('**/v1/assistant/yandex/parse-workout',async route=>{const body=route.request().postDataJSON() as {text:string;systemCatalog:{ref:string;name:string;inputKind:string}[]};const candidates=body.systemCatalog.filter(e=>e.inputKind==='strength').slice(0,2);expect(candidates).toHaveLength(2);parseCalls++;parseRequests.push({text:body.text,candidateRefs:candidates.map(e=>e.ref)});if(!parseCandidates.length)parseCandidates.push(...candidates.map(e=>({ref:e.ref,name:e.name})));if(parseCalls===1){await parseGate;return route.fulfill({status:503,json:{error:'fixture_template_parse_unavailable'}})}expect(parseCalls).toBe(2);return route.fulfill({json:{items:[],unmatched:[{sourceText:body.text,position:0,reason:'ambiguous',suggestedExerciseRefs:candidates.map(e=>e.ref),sets:[{weightKg:80,reps:8}]}]}})})
  let failList=sample.mode==='favorite-states'||sample.mode==='template-states',favoritePut=0,favoriteDelete=0,templatePut=0,listRequests=0
  const listGate=new Promise<void>(resolve=>{releaseList=resolve}),mutationGate=new Promise<void>(resolve=>{releaseMutation=resolve})
  const record=(r:import('@playwright/test').Route)=>{const req=r.request();writes.push({method:req.method(),path:new URL(req.url()).pathname,body:req.method()==='DELETE'?null:req.postDataJSON()})}
  await page.route('**/v1/favorite-workouts',async r=>{if(r.request().method()!=='GET')return r.fallback();if(sample.mode==='favorite-states')listRequests++;if(sample.mode==='favorite-states'&&failList){await listGate;return r.fulfill({status:503,json:{error:'fixture_favorites_unavailable'}})}return r.fulfill({json:{favorites:sample.mode==='favorite-states'?[]:favorites}})})
  await page.route('**/v1/favorite-workouts/*',async r=>{
   const method=r.request().method();if(method==='PUT'){record(r);favoritePut++;const b=r.request().postDataJSON() as {title:string;expectedVersion:number;exercises?:WorkoutExerciseDraft[]}
    if((sample.mode==='favorites'||sample.mode==='favorite-save'||sample.mode==='favorite-conflict')&&favoritePut===1){await mutationGate;if(sample.mode==='favorite-conflict'){favorites[0]!.version=2;return r.fulfill({status:409,json:{error:'version_conflict'}})}return r.fulfill({status:503,json:{error:'fixture_favorite_save'}})}
    if(sample.mode==='favorites'&&favoritePut===2){favorites[0]!.version=2;return r.fulfill({status:409,json:{error:'version_conflict'}})}
    expect(b.expectedVersion).toBe(favorites[0]!.version);favorites[0]={...favorites[0]!,title:b.title,version:b.expectedVersion+1,...(b.exercises?{exercises:b.exercises}:{})};return r.fulfill({json:favorites[0]})
   }if(method==='DELETE'){record(r);favoriteDelete++;if(favoriteDelete===1){await mutationGate;return r.fulfill({status:503,json:{error:'fixture_favorite_delete'}})}favorites=favorites.filter(f=>!r.request().url().endsWith(f.id));return r.fulfill({status:204,headers:{'access-control-allow-origin':'*'}})}return r.fallback()
  })
  await page.route('**/v1/workout-templates',async r=>{
   if(r.request().method()==='GET'){if(sample.mode==='template-states')listRequests++;if(sample.mode==='template-states'&&failList){await listGate;return r.fulfill({status:503,json:{error:'fixture_templates_unavailable'}})}return r.fulfill({json:{templates:sample.mode==='template-states'?[]:templates}})}
   if(r.request().method()==='POST'){record(r);templatePut++;const b=r.request().postDataJSON() as {draft:WorkoutTemplate;expectedVersion:number|null};if(sample.mode==='template-copy'&&templatePut===1){await mutationGate;return r.fulfill({status:503,json:{error:'fixture_template_copy'}})}const copy={...templates[0]!,...b.draft,version:1};templates.push(copy);return r.fulfill({json:{template:copy}})}return r.fallback()
  })
  await page.route('**/v1/workout-templates/*',async r=>{if(r.request().method()==='GET')return r.fulfill({json:{template:templates[0]}});record(r);templatePut++;if(sample.mode==='template-save'&&templatePut===1){await mutationGate;return r.fulfill({status:503,json:{error:'fixture_template_save'}})}if(r.request().method()==='DELETE')return r.fulfill({json:{template:{id:templateId,version:2}}});const b=r.request().postDataJSON() as {draft:WorkoutTemplate;expectedVersion:number};expect(b.expectedVersion).toBe(templates[0]!.version);templates[0]={...templates[0]!,...b.draft,version:b.expectedVersion+1};return r.fulfill({json:{template:templates[0]}})})
  const favoriteEditor=sample.mode.startsWith('favorite-')&&['favorite-editor','favorite-save','favorite-conflict'].includes(sample.mode),templateEditor=['template-editor','template-save','template-empty'].includes(sample.mode),preserved=sample.mode.endsWith('-control')
  const path=sample.mode==='current-control'?'/me/workouts':sample.mode==='editor-control'?'/workouts/'+workoutId+'/edit':favoriteEditor?'/me/workouts/favorites/'+favoriteId+'/edit':templateEditor?(sample.mode==='template-empty'?'/schedule/templates/new/editor':'/schedule/templates/'+templateId+'/edit'):sample.mode==='source'?'/schedule/templates/from-workout':sample.role==='client'?'/me/workouts?tab=presets':'/schedule/templates'
  await page.goto(path)
  const selector=favoriteEditor?'.favorite-workout-editor-page':templateEditor?'.workout-template-editor-page':sample.mode==='source'?'.workout-template-source-page':sample.mode==='editor-control'?'.workout-form-page':sample.role==='client'?'.client-workouts-page':'.workout-templates-page'
  await expect(page.locator(selector)).toBeVisible();const frame=page.locator('.phone-frame')
  if(sample.lime){await expect(frame).toHaveClass(sample.role==='client'?/fit-client-lime/:/fit-lime-shell/)}else await expect(frame).not.toHaveClass(/fit-lime-shell|fit-client-lime/)
  if(sample.lime&&sample.role==='trainer')await expect(frame).not.toHaveClass(/theme-light/)
  if(favoriteEditor&&sample.lime)await expect(page.locator('.favorite-workout-editor-page')).toHaveClass(/client-editor-refined/)
  if(templateEditor)await expect(page.locator('.workout-template-editor-page')).not.toHaveClass(/workout-editor-reference/)
  const states:Array<{state:string}&Awaited<ReturnType<typeof probeEditorSkin>>>=[]
  const probe=async(state:string,keepPointer=false)=>{if(!keepPointer)await page.mouse.move(0,0);states.push({state,...await probeEditorSkin(page,info.outputPath('library-'+state+'.png'),selector+',.sheet-overlay,.modal-overlay,.overflow-list',librarySkinContract)})}
  if(sample.mode==='favorite-states'||sample.mode==='template-states'){await expect.poll(()=>listRequests).toBeGreaterThan(0);await expect(page.locator(selector).getByRole('status',{name:'Загрузка',exact:true}).first()).toBeVisible()}
  else if(favoriteEditor||templateEditor){await expect(page.getByLabel(favoriteEditor?'Название':'Название шаблона',{exact:true})).toBeVisible()}
  else if(sample.mode==='source'){await expect(page.locator('.template-source-workout')).toHaveCount(1);await writeFile(info.outputPath('source-options.json'),JSON.stringify(await page.locator('select').evaluateAll(nodes=>nodes.filter((n):n is HTMLSelectElement=>n instanceof HTMLSelectElement).map(n=>({outerHTML:n.outerHTML,options:Array.from(n.options).map(o=>({value:o.value,attribute:o.getAttribute('value'),text:o.textContent}))}))),null,2));await expect(page.getByRole('combobox',{name:'Клиент',exact:true}).locator('option[value="'+clientId+'"]')).toHaveCount(1)}
  else if(sample.mode==='current-control')await expect(page.locator('.client-workouts-view-toggle')).toBeVisible()
  else if(sample.mode==='editor-control')await expect(page.locator('form.workout-form')).toBeVisible()
  else await expect(page.locator(sample.role==='client'?'.favorite-workout-card':'.template-card').first()).toBeVisible()
  await probe('initial')
  if(sample.mode==='favorite-states'||sample.mode==='template-states'){releaseList();await expect(page.locator(selector).getByRole('button',{name:'Повторить',exact:true}).first()).toBeVisible();await probe('load-error');failList=false;await page.locator(selector).getByRole('button',{name:'Повторить',exact:true}).first().click();await expect(page.locator(selector)).toContainText(sample.role==='client'?'Пока нет сохранённых тренировок':'Создайте первый шаблон');await probe('empty')}
  if(['favorites','favorite-limit','favorites-off'].includes(sample.mode)){
   const card=page.locator('.favorite-workout-card').first();await expect(card).toBeVisible();await card.getByRole('button',{name:/Действия с тренировкой/}).click();await probe('card-menu')
   if(sample.mode==='favorites'){
    await page.getByRole('menuitem',{name:'Переименовать',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Переименовать тренировку',exact:true}),title=dialog.getByLabel('Название',{exact:true}),save=dialog.locator('button[type="submit"]');await expect(save).toHaveAccessibleName('Сохранить');await title.fill('Новое имя MC519');await probe('rename-input');await save.click();await expect(save).toBeDisabled();await expect(save).toHaveAccessibleName('Сохраняем…');await expect(title).toBeDisabled();await probe('rename-pending');releaseMutation();await expect(save).toBeEnabled();await expect(dialog.getByRole('alert')).toBeVisible();await expect(title).toHaveValue('Новое имя MC519');await probe('rename-error');await save.click();await expect(dialog.getByRole('button',{name:'Загрузить текущую версию',exact:true})).toBeVisible();await probe('rename-conflict');await dialog.getByRole('button',{name:'Загрузить текущую версию',exact:true}).click();await expect(save).toBeEnabled();await expect(title).toHaveValue('Новое имя MC519');await probe('rename-recovered');await save.click();await expect(dialog).not.toBeVisible();await expect(card).toContainText('Новое имя MC519');expect(favoritePut).toBe(3)
   }else if(sample.mode==='favorite-limit'){
    await expect(page.locator('.favorite-workouts-limit-note')).toBeVisible();await page.getByRole('menuitem',{name:'Удалить',exact:true}).click();const dialog=page.getByRole('alertdialog');await probe('delete-confirm');await dialog.getByRole('button',{name:'Отмена',exact:true}).click();await expect(page.locator('.favorite-workout-card')).toHaveCount(10);await card.getByRole('button',{name:/Действия с тренировкой/}).click();await page.getByRole('menuitem',{name:'Удалить',exact:true}).click();await dialog.getByRole('button',{name:'Удалить',exact:true}).click();await expect.poll(()=>favoriteDelete).toBe(1);await probe('delete-pending');releaseMutation();await expect(page.getByRole('button',{name:'Повторить удаление',exact:true})).toBeVisible();await probe('delete-error');const completedDelete=page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/favorite-workouts/'+favoriteId&&r.request().method()==='DELETE'&&r.status()===204);await page.getByRole('button',{name:'Повторить удаление',exact:true}).click();expect((await completedDelete).status()).toBe(204);await expect(page.locator('.favorite-workout-card')).toHaveCount(9);expect(favoriteDelete).toBe(2)
   }else await page.keyboard.press('Escape')
  }
  if(['templates','template-copy','templates-off'].includes(sample.mode)){
   const search=page.getByRole('searchbox',{name:'Поиск по названию шаблона',exact:true});if(sample.width===1440){await search.focus();await expect(search).toBeFocused();await probe('search-focus')}await search.fill('Нет совпадений MC519');await expect(page.getByText('Ничего не найдено',{exact:true})).toBeVisible();await probe('search-empty');await page.getByRole('button',{name:'Очистить поиск',exact:true}).click();await expect(search).toBeFocused();await expect(page.locator('.template-card')).toHaveCount(1);await page.locator('.template-card').getByRole('button',{name:/Действия с шаблоном/}).click();await probe('template-menu');if(sample.width===1440&&sample.lime){const remove=page.getByRole('menuitem',{name:'Удалить',exact:true});await remove.hover();expect(await remove.evaluate(n=>n.matches(':hover'))).toBe(true);await probe('template-menu-hover',true)}
   if(sample.mode==='template-copy'){await page.getByRole('menuitem',{name:'Создать копию',exact:true}).click();await expect.poll(()=>templatePut).toBe(1);await probe('copy-pending');releaseMutation();await expect(page.getByRole('alert')).toBeVisible();await probe('copy-error');await page.locator('.template-card').first().getByRole('button',{name:/Действия с шаблоном/}).click();await page.getByRole('menuitem',{name:'Создать копию',exact:true}).click();await expect(page.locator('.template-card')).toHaveCount(2);expect(writes[1]!.body).toEqual(writes[0]!.body)}else{await page.getByRole('menuitem',{name:'Удалить',exact:true}).click();const dialog=page.getByRole('alertdialog');await probe('template-delete-confirm');await dialog.getByRole('button',{name:'Отмена',exact:true}).click();await expect(page.locator('.template-card')).toHaveCount(1)}
  }
  if(sample.mode==='source'){const select=page.getByRole('combobox',{name:'Клиент',exact:true});await select.focus();await probe('source-filter-focus');await select.selectOption(clientId);await expect(select).toHaveValue(clientId);await expect(page.locator('.template-source-workout')).toHaveCount(1);await probe('source-filtered')}
  if(favoriteEditor||templateEditor){
   const title=page.getByLabel(favoriteEditor?'Название':'Название шаблона',{exact:true});await title.fill('Название MC519 с сохранением текущих значений');if(sample.mode.endsWith('-editor')){await expect(title).toBeFocused();await probe('title-focus')}await title.press('Tab')
   if(sample.mode==='template-empty'){await page.getByRole('button',{name:'Ввести текстом',exact:true}).click();const text=page.getByLabel('Запись тренировки',{exact:true});await text.fill('Присед 3 по 8 80 кг');await probe('empty-text');await page.locator('.trainer-plan-methods').getByRole('button',{name:'Выбрать упражнения',exact:true}).click();await expect(page.locator('.exercise-picker')).toBeVisible();await probe('empty-catalog');await page.locator('.exercise-picker').getByRole('button',{name:'Закрыть',exact:true}).click();const entry=page.locator('.quick-workout-entry'),parse=entry.locator('.quick-workout-add');await expect(text).toHaveValue('Присед 3 по 8 80 кг');await parse.click();await expect(parse).toBeDisabled();await expect(parse).toHaveText('Разбираю тренировку…');await expect.poll(()=>parseCalls).toBe(1);await probe('parse-pending');releaseParse();await expect(entry.locator('.quick-workout-clarification')).toBeVisible();await expect(text).toHaveValue('Присед 3 по 8 80 кг');await probe('parse-error');await text.fill('Движение MC519 2 по 8 80 кг');await parse.click();await expect(entry.locator('.quick-workout-candidates')).toHaveCount(1);await expect(entry.locator('.quick-workout-candidates button')).toHaveCount(2);await probe('parse-ambiguous');await entry.locator('.quick-workout-candidates button').first().click();await expect(entry.locator('.quick-workout-candidates')).toHaveCount(0);await expect(parse).toHaveText('Добавить в план (1)');await expect(parse).toBeEnabled();await probe('parse-preview');await parse.click();await expect(page.locator('.workout-form-exercises')).toContainText(parseCandidates[0]!.name);await expect(page.getByLabel('Вес, подход 1',{exact:true})).toHaveValue('80');await expect(page.getByLabel('Повторы, подход 1',{exact:true})).toHaveValue('8');await probe('parse-added');expect(parseCalls).toBe(2)}
   else{
    for(const toggle of await page.locator('.compact-editor-exercise-toggle').all())if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();const weight=page.getByLabel('Вес, подход 1',{exact:true}).first();await weight.fill('27.5');await weight.press('Tab');await expect(weight).toHaveValue('27.5');await probe('fields');if(sample.mode==='template-save'){const remove=page.locator('button.planned-set-remove').first();await remove.hover();expect(await remove.evaluate(n=>n.matches(':hover'))).toBe(true);await probe('set-remove-hover',true)}
    if(sample.mode.endsWith('-editor')){
     const block=page.locator('.exercise-block');await expect(block).toHaveCount(1);await expect(block.getByLabel('Кругов',{exact:true})).toHaveValue('2');await expect(block.locator('.planned-round')).toHaveCount(2)
     const options=block.locator('.block-options');if(await options.evaluate(n=>n instanceof HTMLDetailsElement&&!n.open))await options.locator(':scope > summary').click();await expect(block.getByLabel('Отдых между упражнениями, с',{exact:true})).toHaveValue('15');await expect(block.getByLabel('Отдых между кругами, с',{exact:true})).toHaveValue('90');await probe('group-rest');await weight.focus();await expect(weight).toBeFocused();await probe('weight-focus');const add=page.locator('.planned-exercise .set-add-row > .secondary').last();await add.hover();expect(await add.evaluate(n=>n.matches(':hover'))).toBe(true);await probe('set-add-hover',true);const toggle=page.locator('.compact-editor-exercise-toggle').last();await toggle.hover();await probe('exercise-toggle-hover',true);await toggle.focus();await page.keyboard.press(info.project.name.includes('webkit')?'Alt+Tab':'Tab');await page.keyboard.press(info.project.name.includes('webkit')?'Alt+Shift+Tab':'Shift+Tab');await expect(toggle).toBeFocused();expect(await toggle.evaluate(n=>n.matches(':focus-visible'))).toBe(true);await probe('exercise-toggle-focus')
    }
    if(sample.mode.endsWith('-editor')){const rpeExercise=page.locator('.planned-exercise').last();await rpeExercise.getByRole('button',{name:'Ещё действия',exact:true}).click();await page.getByRole('menuitem',{name:'Указать RPE',exact:true}).click();const rpe=rpeExercise.getByLabel('Целевой RPE, подход 1',{exact:true});await rpe.selectOption('7');await expect(rpe).toHaveValue('7');await probe('rpe');const exercise=page.locator('.planned-exercise').filter({has:page.locator('.compact-editor-exercise-title strong').filter({hasText:'Бег'})});await expect(exercise).toHaveCount(1);await exercise.getByRole('button',{name:'Ещё действия',exact:true}).click();await probe('exercise-menu');await page.getByRole('menuitem',{name:'Настройки упражнения',exact:true}).click();await expect(page.locator('.exercise-settings-sheet')).toBeVisible();await probe('exercise-settings');await page.locator('.exercise-settings-sheet').getByRole('button',{name:'Готово',exact:true}).click();const unit=exercise.getByRole('combobox',{name:'Единица расстояния, подход 1',exact:true});await unit.focus();await expect(unit).toBeFocused();await probe('distance-unit-focus');await exercise.getByRole('button',{name:'Ещё действия',exact:true}).click();await page.getByRole('menuitem',{name:'Заменить',exact:true}).click();await expect(page.locator('.exercise-picker')).toBeVisible();await probe('replace-catalog');await page.locator('.exercise-picker').getByRole('button',{name:'Закрыть',exact:true}).click()}
    else{
     const save=page.locator('form.workout-form button[type="submit"]');await expect(save).toHaveAccessibleName(favoriteEditor?'Сохранить изменения':'Сохранить шаблон');await save.click();await expect(save).toBeDisabled();await expect(save).toHaveAccessibleName('Сохраняем…');await expect(weight).toBeDisabled();await probe('save-pending');releaseMutation();await expect(save).toBeEnabled();await expect(page.getByRole('alert')).toBeVisible();await expect(weight).toHaveValue('27.5');await probe('save-error')
     if(sample.mode==='favorite-conflict'){await page.getByRole('button',{name:'Загрузить текущую версию',exact:true}).click();const dialog=page.getByRole('alertdialog');await probe('reload-confirm');await dialog.getByRole('button',{name:'Отмена',exact:true}).click();await expect(weight).toHaveValue('27.5')}else{await save.click();await expect(page).toHaveURL(sample.role==='client'?/\/me\/workouts\?tab=presets$/:/\/schedule\/templates$/);expect(writes[1]!.body).toEqual(writes[0]!.body)}
    }
   }
  }
  await writeFile(info.outputPath('library-skin.json'),JSON.stringify({sample,path,states,writes,workoutWrites,sourceHistoryUnchanged:JSON.stringify(backend.getWorkouts())===originalHistory,parseCalls,parseRequests,parseCandidates,diagnostics:{errors,failed,responses,consoleErrors}},null,2))
  expect(errors).toEqual([])
  if(failed.length){
   // An independent actual-query/native-fetch HTTP204 counterfactual reproduces
   // Chromium's ERR_ABORTED on an unread successful zero-byte response. Only
   // this one paired Request/status204 after the proved deletion is accepted;
   // other paths, statuses, errors and extra failures remain rejected.
   expect(sample.mode).toBe('favorite-limit')
   expect(failed).toEqual([{path:'/v1/favorite-workouts/'+favoriteId,method:'DELETE',error:'net::ERR_ABORTED',responseStatus:204}])
   expect(favoriteDelete).toBe(2)
   await expect(page.locator('.favorite-workout-card')).toHaveCount(9)
  }else expect(failed).toEqual([])
  expect(workoutWrites).toEqual([]);expect(JSON.stringify(backend.getWorkouts())).toBe(originalHistory)
  const intentional: {path:string;method:string;status:number}[]=[]
  const favoritePath='/v1/favorite-workouts/'+favoriteId,templatePath='/v1/workout-templates/'+templateId
  if(sample.mode==='favorites')intentional.push({path:favoritePath,method:'PUT',status:503},{path:favoritePath,method:'PUT',status:409})
  if(sample.mode==='favorite-limit')intentional.push({path:favoritePath,method:'DELETE',status:503})
  if(sample.mode==='favorite-states')intentional.push({path:'/v1/favorite-workouts',method:'GET',status:503})
  if(sample.mode==='template-states')intentional.push({path:'/v1/workout-templates',method:'GET',status:503})
  if(sample.mode==='favorite-save'||sample.mode==='favorite-conflict')intentional.push({path:favoritePath,method:'PUT',status:sample.mode==='favorite-save'?503:409})
  if(sample.mode==='template-copy')intentional.push({path:'/v1/workout-templates',method:'POST',status:503})
  if(sample.mode==='template-empty')intentional.push({path:'/v1/assistant/yandex/parse-workout',method:'POST',status:503})
  if(sample.mode==='template-save')intentional.push({path:templatePath,method:'PUT',status:503})
  expect(responses.filter(r=>!intentional.some(x=>x.path===r.path&&x.method===r.method&&x.status===r.status))).toEqual([])
  for(const x of intentional)expect(responses.some(r=>r.path===x.path&&r.method===x.method&&r.status===x.status)).toBe(true)
  expect(consoleErrors.filter(e=>!intentional.some(x=>x.path===e.path)||!e.text.startsWith('Failed to load resource:'))).toEqual([])
  for(const state of states){if(preserved){expect(state.owners).toEqual([])}else assertEditorOwnership(state,sample.lime,librarySkinContract)}
 })
}
