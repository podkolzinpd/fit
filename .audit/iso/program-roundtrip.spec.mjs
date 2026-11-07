import {test,expect} from './source/node_modules/@playwright/test/index.mjs'
import {writeFileSync,appendFileSync} from 'node:fs'
const api=process.env.FIT_AUDIT_API_ORIGIN
const events=[]
function record(event,data={}){const entry={event,at:new Date().toISOString(),...data};events.push(entry);appendFileSync(new URL('./browser-events.jsonl',import.meta.url),JSON.stringify(entry)+'\n')}
async function fixture(path,body){const r=await fetch(api+'/__fixtures/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});expect(r.ok).toBeTruthy();return r.json()}
async function signIn(context,key,role){
 await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort('blockedbyclient'));
 const session=await fixture('session',{key,role});
 for(const path of ['/v1/auth/yandex/session','/v1/legal/acceptance']){
  let ready=false;
  for(let attempt=1;attempt<=3&&!ready;attempt++){
   const started=Date.now();try{const rr=await fetch(api+path,{headers:{'x-fit-session':session.token},signal:AbortSignal.timeout(30000)});record('native_auth_readiness',{role,path,attempt,status:rr.status,durationMs:Date.now()-started});expect(rr.ok).toBeTruthy();await rr.json();ready=true}catch(error){record('native_auth_readiness_error',{role,path,attempt,category:error.name,durationMs:Date.now()-started});if(attempt===3)throw error}
  }
 }
 await context.addInitScript(s=>localStorage.setItem('fit.yandexAppSession.v1',JSON.stringify({token:s.token,expiresAt:s.expiresAt})),session);
 const page=await context.newPage();await page.goto('/auth');
 const onboarding=page.getByRole('button',{name:'Понятно',exact:true}),retry=page.getByRole('button',{name:'Повторить проверку',exact:true});
 for(let attempt=1;attempt<=3;attempt++){
  await expect(onboarding.or(retry)).toBeVisible({timeout:60000});
  if(await onboarding.isVisible())return {page,session};
  record('native_auth_ui_retry',{role,attempt});await retry.click();
 }
 await expect(onboarding).toBeVisible({timeout:60000});return {page,session}
}

async function read(session,path,method='GET',body){const r=await fetch(api+path,{method,headers:{'x-fit-session':session.token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});expect(r.ok,`${method} ${path}: ${r.status}`).toBeTruthy();return r.json()}
test('native program creation assignment client execution trainer results',async({browser},info)=>{
 await fixture('reset',{})
 const trainerContext=await browser.newContext({viewport:{width:390,height:844}})
 const clientContext=await browser.newContext({viewport:{width:390,height:844}})
 try{
 const trainer=await signIn(trainerContext,'trainer','trainer');const client=await signIn(clientContext,'client','client')
 const t=trainer.page,c=client.page
 const hint=c.locator('.coachmark-bubble').getByRole('button',{name:'Понятно',exact:true}).first();
 await c.addLocatorHandler(hint,async()=>{await hint.click();record('client_coachmark_dismissed',{method:'visible UI Понятно button'})});
 const clientOnboarding=c.getByRole('button',{name:'Понятно',exact:true});await expect(clientOnboarding).toBeVisible({timeout:60000});await clientOnboarding.click()
 const before=(await read(trainer.session,'/v1/training-data?clientId=11111111-1111-4111-8111-111111111111')).workouts
 expect(before).toHaveLength(0)
 record('fixture_ready')
 await t.goto('/assistant')
 const onboarding=t.getByRole('button',{name:'Понятно',exact:true});await expect(onboarding).toBeVisible({timeout:60000});await onboarding.click()
 const composer=t.getByRole('textbox',{name:'Сообщение ассистенту'})
 await expect(composer).toBeEnabled({timeout:60000})
 await composer.fill('Составь программу для Анны Смирновой на 1 неделю: общая форма, два занятия в неделю по вторникам (день недели 2) и субботам (день недели 6), начать 2026-11-07, по 60 минут; новичок, полностью оборудованный зал, ограничений нет, предпочтений нет, другой нагрузки нет, мне 31 год, это все тренировки.')
 const firstTurn=t.waitForResponse(r=>r.url().endsWith('/v1/assistant/turn')&&r.request().method()==='POST',{timeout:600000})
 await t.getByRole('button',{name:'Отправить сообщение',exact:true}).click()
 const first=await firstTurn;const body=await first.json();writeFileSync(new URL('./first-response.json',import.meta.url),JSON.stringify({status:first.status(),body},null,2));expect(first.ok()).toBeTruthy();record('creation_brief',{actionTool:body.action?.tool,step:body.action?.payload?.step,ready:body.action?.payload?.readyToGenerate,brief:body.action?.payload?.briefState,askedFields:body.action?.payload?.askedFields});writeFileSync(new URL('./first-turn.json',import.meta.url),JSON.stringify(body,null,2)+'\n')
 let current=body;
 const answers={weeks:'1 неделя',scope:'Программа на 1 неделю',weekdays:'Вторник и суббота, номера дней недели 2 и 6',adult:'Мне 31 год, я совершеннолетняя',startDate:'Дата начала 2026-11-07',historyComplete:'Это все тренировки',continuationPlan:'Начать с нуля, предыдущих тренировок нет',frequency:'Два занятия в неделю',durationMin:'60 минут',equipment:'Полностью оборудованный зал',limitations:'Нет ограничений',preferences:'Нет предпочтений',otherActivity:'Нет другой нагрузки'};
 for(let q=0;q<4 && current.action?.payload?.step==='brief' && !current.action?.payload?.readyToGenerate;q++){
  const fields=current.action.payload.askedFields??[];const text=fields.map(k=>answers[k]).filter(Boolean).join('; ') || 'Программа на 1 неделю, два занятия в неделю по вторникам и субботам (дни 2 и 6), начать 2026-11-07; общая форма, по 60 минут; я новичок, полностью оборудованный зал, ограничений нет, предпочтений нет, другой нагрузки нет, мне 31 год.';
  await composer.fill(text);const reply=t.waitForResponse(r=>r.url().endsWith('/v1/assistant/turn')&&r.request().method()==='POST',{timeout:600000});await t.getByRole('button',{name:'Отправить сообщение',exact:true}).click();const rr=await reply;current=await rr.json();record('quiz_answer',{fields,text,httpStatus:rr.status(),ready:current.action?.payload?.readyToGenerate,brief:current.action?.payload?.briefState,askedFields:current.action?.payload?.askedFields});expect(rr.ok()).toBeTruthy();
 }
 const confirmedBrief=current.action?.payload?.briefState;
 if(JSON.stringify(confirmedBrief?.weekdays)!==JSON.stringify([2,6])){
  await composer.fill('Уточняю дни: вторник — день 2; суббота — день 6. Дни недели 2,6. Два занятия в неделю. Программа на 1 неделю, дата начала 2026-11-07.');
  const correction=t.waitForResponse(r=>r.url().endsWith('/v1/assistant/turn')&&r.request().method()==='POST',{timeout:600000});await t.getByRole('button',{name:'Отправить сообщение',exact:true}).click();const cr=await correction;current=await cr.json();record('weekday_correction',{httpStatus:cr.status(),briefState:current.action?.payload?.briefState});expect(cr.ok()).toBeTruthy();
 }
 expect(current.action?.payload?.briefState?.weekdays).toEqual([2,6]);expect(current.action?.payload?.briefState?.weeks).toBe(1);expect(current.action?.payload?.briefState?.startDate).toBe('2026-11-07');
 await t.screenshot({path:info.outputPath('01-program-brief.png'),fullPage:true})
 await expect(t.getByRole('button',{name:'Подтвердить и составить',exact:true})).toBeVisible()
 const generation=t.waitForResponse(r=>r.url().endsWith('/v1/assistant/turn')&&r.request().method()==='POST',{timeout:600000})
 await t.getByRole('button',{name:'Подтвердить и составить',exact:true}).click()
 const generatedResponse=await generation;const generated=await generatedResponse.json();writeFileSync(new URL('./generation-response.json',import.meta.url),JSON.stringify({status:generatedResponse.status(),body:generated},null,2));expect(generatedResponse.ok()).toBeTruthy()
 const draft=generated.action?.payload;expect(draft?.canonicalWorkouts).toHaveLength(2);expect(draft.step).toBe('confirm')
 record('creation_confirmed',{programId:draft.programId,dates:draft.canonicalWorkouts.map(w=>w.workoutDate),sessions:2,externalGeneration:'real-yandexgpt-via-approved-workflow-rpc'})
 await expect(t.getByRole('button',{name:'Добавить в расписание',exact:true})).toBeVisible()
 await t.screenshot({path:info.outputPath('02-program-created.png'),fullPage:true})
 const applyPromise=t.waitForResponse(r=>/\/v1\/assistant\/actions\/[^/]+\/apply$/.test(r.url())&&r.request().method()==='POST')
 await t.getByRole('button',{name:'Добавить в расписание',exact:true}).click()
 const apply=await applyPromise;expect(apply.ok()).toBeTruthy();record('ui_apply',{httpStatus:apply.status()})
 await expect(t.getByText('Программа добавлена в расписание: 2 тренировок.',{exact:true})).toBeVisible()
 await t.reload();
 const savedReceipt=t.getByText('Программа добавлена в расписание: 2 тренировок.',{exact:true});
 const history=t.getByRole('button',{name:/^История /});
 await expect(savedReceipt.or(history)).toBeVisible();
 if(!await savedReceipt.isVisible()){
  await history.click();
  const savedConversation=t.locator('#assistant-session-history button');await expect(savedConversation).toHaveCount(1);await savedConversation.click();
 }
 await expect(savedReceipt).toBeVisible();record('saved_conversation_restored',{programId:draft.programId,method:'reload then existing conversation via history'})
 const planned=(await read(trainer.session,'/v1/training-data?clientId=11111111-1111-4111-8111-111111111111')).workouts.sort((a,b)=>a.workoutDate.localeCompare(b.workoutDate))
 expect(planned).toHaveLength(2);expect(planned.map(w=>w.workoutDate)).toEqual(draft.canonicalWorkouts.map(w=>w.workoutDate).sort());expect(planned.map(w=>w.status)).toEqual(['planned','planned'])
 for(const w of planned){expect(w.exercises.length).toBeGreaterThanOrEqual(3);expect(w.exercises.flatMap(e=>e.sets).length).toBeGreaterThan(0)}
 const clientPlans=(await read(client.session,'/v1/training-data?clientId=11111111-1111-4111-8111-111111111111')).workouts
 expect(clientPlans.map(w=>w.id).sort()).toEqual(planned.map(w=>w.id).sort())
 record('assigned_persisted',{workoutIds:planned.map(w=>w.id),dates:planned.map(w=>w.workoutDate),workouts:2,setsPerWorkout:planned.map(w=>w.exercises.flatMap(e=>e.sets).length),actorReadback:'trainer+client'})
 await t.screenshot({path:info.outputPath('03-program-assigned.png'),fullPage:true})
 for(const [index,w] of planned.entries()){
  await c.goto('/workouts/'+w.id)
  await expect(c.getByRole('button',{name:/^(Начать тренировку|Начать сегодня)$/})).toBeVisible()
  await c.getByRole('button',{name:/^(Начать тренировку|Начать сегодня)$/}).click()
  await expect(c).toHaveURL(/\/live$/)
  await c.keyboard.press('Escape')
  const reps=c.getByLabel('Фактические повторы',{exact:true}).first()
  if(await reps.isVisible()){await reps.fill(String(9+index));await reps.press('Tab')}
  const total=w.exercises.flatMap(e=>e.sets).length;for(let set=0;set<total;set++){
   const confirm=c.locator('.live-set:not(.confirmed) .live-set-check:visible:not(:disabled)').first()
   await expect(confirm).toBeVisible();await confirm.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));await confirm.click()
   await expect.poll(async()=>{const data=await read(client.session,'/v1/training-data?workoutId='+w.id);return data.workouts[0].exercises.flatMap(e=>e.sets).filter(s=>s.confirmedAt).length}).toBe(set+1)
  }
  await c.screenshot({path:info.outputPath(`04-client-workout-${index+1}-confirmed.png`),fullPage:true})
  await c.getByRole('button',{name:'Завершить тренировку',exact:true}).click()
  const without=c.getByRole('button',{name:'Завершить без оценки',exact:true});if(await without.isVisible())await without.click()
  await expect(c).toHaveURL(new RegExp('/workouts/'+w.id+'$'))
  await expect(c.getByRole('region',{name:'Тренировка завершена'})).toBeVisible()
  const completed=(await read(client.session,'/v1/training-data?workoutId='+w.id)).workouts[0]
  expect(completed.status).toBe('done');expect(completed.exercises.flatMap(e=>e.sets).filter(s=>s.confirmedAt)).toHaveLength(total)
  expect(completed.exercises.flatMap(e=>e.sets).every(s=>s.fact&&s.confirmedAt)).toBeTruthy()
  record('client_completed',{workoutId:w.id,confirmedSets:total,firstFactReps:9+index})
  await c.screenshot({path:info.outputPath(`05-client-workout-${index+1}-done.png`),fullPage:true})
  await t.goto('/workouts/'+w.id)
  await expect(t.locator('.completed-exercise-list')).toBeVisible();await expect(t.getByText('Проведена',{exact:true})).toBeVisible()
  const seen=(await read(trainer.session,'/v1/training-data?workoutId='+w.id)).workouts[0]
  expect(seen.id).toBe(completed.id);expect(seen.status).toBe('done');expect(seen.exercises.map(e=>({id:e.id,sets:e.sets.map(s=>({id:s.id,fact:s.fact,confirmedAt:s.confirmedAt}))}))).toEqual(completed.exercises.map(e=>({id:e.id,sets:e.sets.map(s=>({id:s.id,fact:s.fact,confirmedAt:s.confirmedAt}))})))
  record('trainer_verified',{workoutId:w.id,status:seen.status,confirmedSets:total,firstFactReps:seen.exercises[0].sets[0].fact.reps,allFactsEqualClient:true})
  await t.screenshot({path:info.outputPath(`06-trainer-workout-${index+1}-result.png`),fullPage:true})
 }
 const final=(await read(trainer.session,'/v1/training-data?clientId=11111111-1111-4111-8111-111111111111')).workouts
 expect(final).toHaveLength(2);expect(final.every(w=>w.status==='done')).toBeTruthy();record('roundtrip_passed',{programWorkouts:2,completedWorkouts:2,confirmedSets:final.flatMap(w=>w.exercises.flatMap(e=>e.sets)).length})
 writeFileSync(new URL('./program-result.json',import.meta.url),JSON.stringify({passed:true,events},null,2)+'\n')
 }finally{await trainerContext.close();await clientContext.close()}
})
