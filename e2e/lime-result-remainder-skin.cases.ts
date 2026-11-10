import {test,expect} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {mockPilot,coachGestureWorkout,workoutId,clientId,trainerId} from './fit-lime-fixtures'
import {probeResultRemainderSkin,assertResultRemainderOwnership} from './lime-result-remainder-skin.probe'

// Axes have distinct consumers: client report/revisit vs trainer review/summary;
// narrow partial/empty, desktop long/group wrapping, real off and planned guards.
export function limeResultRemainderSkinCases(){
 const samples=[
  {role:'client',theme:'light',width:390,lime:true,mode:'full',compact:false},
  {role:'client',theme:'dark',width:430,lime:true,mode:'partial',compact:true},
  {role:'client',theme:'light',width:375,lime:true,mode:'empty',compact:true},
  {role:'client',theme:'dark',width:1440,lime:true,mode:'long',compact:false},
  {role:'client',theme:'dark',width:390,lime:true,mode:'history',compact:false},
  {role:'trainer',theme:'light',width:390,lime:true,mode:'full',compact:false},
  {role:'trainer',theme:'dark',width:430,lime:true,mode:'question',compact:true},
  {role:'trainer',theme:'dark',width:375,lime:true,mode:'empty',compact:true},
  {role:'client',theme:'dark',width:390,lime:false,mode:'full',compact:false},
  {role:'trainer',theme:'dark',width:390,lime:false,mode:'full',compact:false},
  {role:'client',theme:'light',width:390,lime:true,mode:'planned',compact:false},
  {role:'trainer',theme:'dark',width:390,lime:true,mode:'planned',compact:false},
 ] as const
 for(const sample of samples)test('Done Lime result remainder skin ownership '+Object.values(sample).join('-'),async({page,browserName},info)=>{
  const errors:string[]=[],failed:string[]=[],responses:{status:number;path:string}[]=[],consoleErrors:{text:string;path:string}[]=[],writes:{path:string;body:unknown}[]=[],viewportCalibration:{before:number;after:number}[]=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(new URL(r.url()).pathname))
  page.on('response',r=>{if(r.status()>=400)responses.push({status:r.status(),path:new URL(r.url()).pathname})})
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push({text:m.text(),path:new URL(m.location().url||page.url()).pathname})})
  page.on('request',r=>{if(['POST','PUT','DELETE','PATCH'].includes(r.method())&&new URL(r.url()).pathname.startsWith('/v1/workout'))writes.push({path:new URL(r.url()).pathname,body:r.postDataJSON()})})
  const id=sample.role==='client'?clientId:'c0ac0000-6010-4000-8000-000000000001'
  await page.setViewportSize({width:sample.width,height:844});await page.emulateMedia({reducedMotion:sample.mode==='long'?'no-preference':'reduce'})
  await page.addInitScript(({id,sample,workoutId})=>{
   // Fix the domain date only. Native timers, RAF and CSS animations keep their
   // own clock during the full-page stylesheet ablation/restore diagnostic.
   const NativeDate=Date,fixed=NativeDate.parse('2026-09-24T12:00:00Z')
   window.Date=new Proxy(NativeDate,{
    construct:(target,args,newTarget)=>Reflect.construct(target,args.length?args:[fixed],newTarget) as Date,
    apply:()=>new NativeDate(fixed).toString(),
    get:(target,key,receiver)=>key==='now'?()=>fixed:Reflect.get(target,key,receiver) as unknown,
   })

   localStorage.setItem('fit.appTheme',sample.theme);localStorage.setItem('fit.clientLime.theme.'+id,sample.theme)
   localStorage.setItem('fit.clientLiveDensity.'+id,sample.compact?'compact':'original');localStorage.setItem('fit.coachLiveDensity.'+id,sample.compact?'compact':'original')
   localStorage.setItem('fit.liveExerciseAnimation.'+id,'false')
   localStorage.setItem('fit.completion-celebrations.v1:'+id,JSON.stringify({entries:{[workoutId]:{phrase:1,icon:'star'}},recent:[1],lastIcon:'star'}))
  },{id,sample,workoutId})
  const source=coachGestureWorkout(false,3);source.startedAt='2026-09-24T10:00:00Z'
  source.trainerId=sample.role==='trainer'?id:trainerId;source.createdBy=source.trainerId
  if(sample.mode==='history'||sample.role==='trainer'&&sample.mode==='full')Object.assign(source,{activeCaloriesKcal:240,calorieEstimateBasis:'Фактические подходы и длительность'})
  source.notes='Прежняя инструкция: сохранить записанные факты и доступ к редактированию.'
  source.exercises=source.exercises.slice(0,3)
  if(sample.mode==='long')source.exercises[0]!.name='Очень длинное название упражнения с контролируемым опусканием и паузой в нижней точке'
  if(source.exercises.length>2){source.exercises[1]!.blockType='group';source.exercises[2]!.blockType='group';source.exercises[2]!.blockId=source.exercises[1]!.blockId;source.exercises[1]!.blockRounds=2;source.exercises[2]!.blockRounds=2}
  source.exercises.forEach((exercise,ei)=>exercise.sets.forEach((set,si)=>{if(sample.mode!=='empty'&&(sample.mode!=='partial'||ei===0&&si===0))Object.assign(set,{fact:{weightKg:20,reps:10},confirmedAt:'2026-09-24T11:00:00Z'})}))
  if(sample.role==='trainer'&&sample.mode==='empty')source.exercises=[]
  const savedFeedback=sample.mode!=='full'&&sample.mode!=='empty'&&sample.mode!=='planned'
  if(savedFeedback)Object.assign(source,{sessionRpe:8,wellbeing:'hard',discomfort:true,clientComment:'Плечо: дискомфорт после последнего подхода.',feedbackSubmittedAt:'2026-09-24T11:30:00Z'})
  if(sample.role==='client')Object.assign(source,{trainerReview:'Сохрани спокойный темп и прежнюю технику.',trainerReaction:'fire',trainerReviewedAt:'2026-09-24T11:40:00Z'})
  if(sample.mode==='question')Object.assign(source,{clientQuestion:'Можно заменить упражнение на следующей тренировке?',clientQuestionAskedAt:'2026-09-24T11:35:00Z'})
  if(sample.mode==='history'){source.status='done';source.completedAt='2026-09-24T11:00:00Z'}
  if(sample.mode==='planned')source.status='planned'
  const backend=await mockPilot(page,{role:sample.role,profileId:id,fitLime:sample.lime,clientLime:sample.role==='client'&&sample.lime,scheduleDensity:sample.compact?'compact':'comfortable',workouts:[source]})
  await page.route('**/v1/push-notifications/status',r=>r.fulfill({json:{status:{subscribed:false,preferences:{workout_reminder:true,workout_scheduled:true,chat_message:true}}}}))
  await page.route('**/v1/exercise-media/sign-batch',r=>{const {paths}=r.request().postDataJSON() as {paths:string[]};return r.fulfill({json:{signedUrls:paths.map(path=>({path,signedUrl:new URL('/exercises/vital/air-bike-sprint.jpg',page.url()).href}))}})})
  await page.route('**/v1/connections',r=>r.fulfill({json:{memberships:[{clientId,trainerId:source.trainerId,firstName:'Тренер',lastName:null,joinedAt:'2026-09-01T00:00:00Z',isRoot:true}],invitations:[]}}))
  await page.route('**/v1/workouts/'+workoutId+'/personal-records',r=>r.fulfill({json:{records:[]}}))
  await page.route('**/v1/workouts/'+workoutId+'/review',r=>{
   const command=r.request().postDataJSON() as {reaction:string;review:string;expectedVersion:number}
   const workout=backend.getWorkouts().find(w=>w.id===workoutId)!
   expect(command.expectedVersion).toBe(workout.version)
   Object.assign(workout,{trainerReaction:command.reaction,trainerReview:command.review,trainerReviewedAt:'2026-09-24T12:00:00Z',version:workout.version+1})
   return r.fulfill({json:{workout:{version:workout.version}}})
  })
  await page.goto('/workouts/'+workoutId+(sample.mode==='history'||sample.mode==='planned'?'':'/live'))
  if(sample.mode!=='history'&&sample.mode!=='planned'){
   await page.getByRole('button',{name:'Завершить тренировку',exact:true}).click()
   if(sample.role==='trainer'){
    const dialog=page.getByRole('dialog',{name:sample.lime?'Завершение тренировки':'Отметить проведённой',exact:true});await expect(dialog).toBeVisible()
    await dialog.getByRole('button',{name:sample.lime?'Завершить тренировку':'Подтвердить проведение',exact:true}).click()
   }else{await expect(page.locator('.finish-confirm,.workout-completion-report')).toBeVisible();if(await page.locator('.finish-confirm').isVisible())await page.locator('.finish-confirm button.primary').click()}
  }
  const frame=page.locator('.phone-frame');await expect(frame).toHaveClass(/workout-detail-history-identity/)
  if(sample.lime){await expect(frame).toHaveClass(/fit-lime-shell/);if(sample.role==='client')await expect(frame).toHaveClass(/fit-client-lime/);else await expect(frame).not.toHaveClass(/theme-light/)}else await expect(frame).not.toHaveClass(/fit-lime-shell|fit-client-lime/)
  if(sample.role==='trainer'||sample.mode==='history'||sample.mode==='planned')await expect(page.locator('.workout-completion-report')).toHaveCount(0)
  else await expect(page.locator('.workout-completion-report')).toBeVisible()
  await page.evaluate(()=>document.fonts.ready)
  await page.locator('.workout-completion-report-art img').evaluateAll(async images=>{await Promise.all(images.map(image=>(image as HTMLImageElement).decode()))})
  const facts=JSON.stringify(backend.getWorkouts().find(w=>w.id===workoutId)!.exercises)
  const states:Array<{state:string}&Awaited<ReturnType<typeof probeResultRemainderSkin>>>=[]
  const probe=async(name:string)=>{await page.mouse.move(0,0);states.push({state:name,...await probeResultRemainderSkin(page,info.outputPath('result-'+name+'.png'),sample.mode==='planned'?'.workout-detail-page':undefined)})}
  const details=page.locator('.workout-completion-recorded,.coach-workout-summary')
  if(await details.count()){
   const summary=details.locator(':scope > summary');await summary.focus();await expect(summary).toBeFocused();await probe('closed')
   await page.keyboard.press('Enter');await expect(details).toHaveAttribute('open','');await probe('open')
   const nested=page.locator('.completed-exercise-details > summary').first();if(await nested.count()){await nested.click();await expect(nested.locator('..')).toHaveAttribute('open','');await probe('exercise-facts')}
   await summary.focus();await page.keyboard.press('Space');await expect(details).not.toHaveAttribute('open','');await probe('collapsed')
  }else await probe('history')
  const feedback=page.locator('.workout-feedback')
  if(sample.role==='client'&&sample.mode==='full'&&sample.lime){
   await expect(feedback.getByRole('button',{name:'Сохранить самочувствие',exact:true})).toBeDisabled()
   const slider=feedback.getByRole('slider',{name:'Нагрузка по шкале RPE'});await slider.focus();await page.keyboard.press('End');await expect(slider).toHaveValue('10')
   await feedback.getByRole('button',{name:'Хорошо',exact:true}).click();await feedback.getByRole('button',{name:'Нет',exact:true}).click();await probe('feedback-good')
   await feedback.getByRole('button',{name:'Плохо',exact:true}).click();await feedback.getByRole('button',{name:'Да',exact:true}).click()
   const note=feedback.getByRole('textbox',{name:'Заметка к итогам тренировки'});await note.fill('Оставить прежний факт и обсудить плечо.');await probe('feedback-discomfort')
   let release=()=>{},calls=0;const gate=new Promise<void>(resolve=>{release=resolve})
   await page.route('**/v1/workouts/'+workoutId+'/feedback',async r=>{calls++;if(calls===1){await gate;return r.fulfill({status:503,json:{error:'fixture_feedback_unavailable'}})}return r.fallback()})
   const save=feedback.locator('button[type=submit]');await expect(save).toHaveAccessibleName('Сохранить самочувствие');await save.click();await expect(save).toBeDisabled();await probe('feedback-pending');release()
   await expect(feedback.locator('.error')).toBeVisible();await probe('feedback-error');await save.click()
   await expect(feedback.locator('.workout-feedback-confirmation')).toBeVisible();await expect.poll(()=>calls).toBe(2);await probe('feedback-saved')
   await feedback.getByRole('button',{name:'Изменить',exact:true}).click();await feedback.getByRole('textbox',{name:'Заметка к итогам тренировки'}).fill('Отменяемое изменение');await feedback.getByRole('button',{name:'Отмена',exact:true}).click()
   await expect(feedback).not.toContainText('Отменяемое изменение');await expect(feedback).toContainText('Оставить прежний факт и обсудить плечо.');await probe('feedback-cancelled')
  }
  if(sample.role==='trainer'&&sample.mode==='full'&&sample.lime){
   const review=page.locator('.coach-trainer-review');await review.getByRole('button',{name:'Добавить',exact:true}).click();await expect(review.getByRole('button',{name:'Отправить ответ',exact:true})).toBeDisabled()
   await review.getByRole('button',{name:'🔥',exact:true}).click();await review.getByRole('textbox',{name:'Отзыв тренера',exact:true}).fill('Результат сохранён. Продолжим с прежними фактами.');await page.keyboard.press(browserName==='webkit'?'Alt+Tab':'Tab');await expect(review.getByRole('button',{name:'Надиктовать заметку',exact:true})).toBeFocused()
   if(browserName==='webkit'){
    // The raw keyboard path can continue native scrolling during screenshot.
    // Calibrate this visual capture by exposing its actual focused control;
    // preserve raw coordinates and don't claim to fix that baseline behavior.
    const before=await page.locator('.content').evaluate(node=>node.scrollTop)
    await review.getByRole('button',{name:'Надиктовать заметку',exact:true}).evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}))
    viewportCalibration.push({before,after:await page.locator('.content').evaluate(node=>node.scrollTop)})
   }
   await probe('trainer-review-editor')
   await review.getByRole('button',{name:'Отмена',exact:true}).click();await expect(review.getByRole('button',{name:'Добавить',exact:true})).toBeVisible();await probe('trainer-review-cancelled')
   await review.getByRole('button',{name:'Добавить',exact:true}).click();await review.getByRole('button',{name:'🔥',exact:true}).click()
   await review.getByRole('textbox',{name:'Отзыв тренера',exact:true}).fill('Результат сохранён. Продолжим с прежними фактами.')
   await review.getByRole('button',{name:'Отправить ответ',exact:true}).click();await expect(review.getByRole('textbox')).toHaveCount(0)
   await expect(review).toContainText('Результат сохранён. Продолжим с прежними фактами.');await probe('trainer-review-sent')
   await page.reload();await expect(review).toContainText('Результат сохранён. Продолжим с прежними фактами.');await expect(review.getByRole('textbox')).toHaveCount(0);await probe('trainer-review-reloaded')
  }
  if(sample.mode==='question'){
   const question=page.locator('.workout-question');await question.getByRole('button',{name:'Ответить',exact:true}).click();await question.getByRole('button',{name:'🔥',exact:true}).click();await probe('trainer-question-editor');await question.getByRole('button',{name:'Отмена',exact:true}).click()
  }
  if(sample.mode!=='planned'){
   await page.locator('.content').evaluate(node=>{node.scrollTop=node.scrollHeight});await probe('bottom-actions')
   const edit=page.getByRole('link',{name:/^(Исправить результат|Изменить результат|Добавить результат)$/}).first()
   if(await edit.count()){
    if(await page.locator('.workout-completion-recorded').count()){await page.locator('.workout-completion-recorded > summary').click();await expect(page.locator('.workout-completion-recorded')).toHaveAttribute('open','')}
    await edit.scrollIntoViewIfNeeded();await edit.focus();await expect(edit).toBeFocused();await probe('edit-focus')
    await edit.click();await expect(page).toHaveURL('/workouts/'+workoutId+'/edit');await page.goBack();await expect(frame).toHaveClass(/workout-detail-history-identity/)
   }
  }
  expect(JSON.stringify(backend.getWorkouts().find(w=>w.id===workoutId)!.exercises)).toBe(facts)
  await writeFile(info.outputPath('result-remainder-skin.json'),JSON.stringify({sample,states,writes,viewportCalibration,errors,failed,responses,consoleErrors,factsUnchanged:true,rootClasses:await frame.getAttribute('class')},null,2))
  expect(errors).toEqual([]);expect(failed).toEqual([])
  if(sample.role==='client'&&sample.mode==='full'&&sample.lime){expect(responses).toEqual([{status:503,path:'/v1/workouts/'+workoutId+'/feedback'}]);for(const m of consoleErrors){expect(m.text.startsWith('Failed to load resource:')).toBe(true);expect(m.path).toBe('/v1/workouts/'+workoutId+'/feedback')}}else{expect(responses).toEqual([]);expect(consoleErrors).toEqual([])}
  for(const state of states)assertResultRemainderOwnership(state,sample.lime&&sample.mode!=='planned')
 })
}
