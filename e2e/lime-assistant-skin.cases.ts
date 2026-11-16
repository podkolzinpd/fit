import {expect,test,type Page} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {prepareAssistantSkin,assistantCanonicalWorkouts,type AssistantSkinSample} from './lime-assistant-skin.fixture'
import {probeEditorSkin,assertEditorOwnership,settleEditorPaint} from './lime-editor-skin.probe'
import {assistantContract} from './lime-assistant-skin.contract'
import {probeAssistantRecording} from './lime-assistant-skin.dynamic'

const samples:readonly AssistantSkinSample[]=[
 {role:'client',theme:'light',width:390,mode:'entry',lime:true},{role:'client',theme:'dark',width:430,mode:'entry',lime:true},{role:'trainer',theme:'light',width:390,mode:'entry',lime:true},{role:'trainer',theme:'dark',width:1440,mode:'entry',lime:true},
 {role:'client',theme:'dark',width:390,mode:'text-retry',lime:true},{role:'trainer',theme:'light',width:430,mode:'text-retry',lime:true},
 {role:'client',theme:'light',width:430,mode:'history',lime:true},{role:'trainer',theme:'dark',width:1440,mode:'history',lime:true},
 {role:'client',theme:'light',width:390,mode:'loading',lime:true},{role:'trainer',theme:'dark',width:430,mode:'loading',lime:true},
 {role:'client',theme:'light',width:390,mode:'load-error',lime:true},{role:'trainer',theme:'dark',width:430,mode:'messages-error',lime:true},{role:'client',theme:'dark',width:430,mode:'catalog-error',lime:true},
 {role:'client',theme:'dark',width:390,mode:'voice-request',lime:true},{role:'trainer',theme:'light',width:430,mode:'voice-record',lime:true},{role:'client',theme:'light',width:430,mode:'voice-record',lime:true},
 {role:'client',theme:'light',width:390,mode:'program-brief',lime:true},{role:'trainer',theme:'dark',width:1440,mode:'program-brief',lime:true},
 {role:'client',theme:'dark',width:430,mode:'program-edit',lime:true},{role:'trainer',theme:'light',width:390,mode:'program-edit',lime:true},
 {role:'client',theme:'light',width:390,mode:'program-save',lime:true},{role:'trainer',theme:'dark',width:430,mode:'program-save',lime:true},
 {role:'client',theme:'dark',width:430,mode:'program-feedback',lime:true},{role:'trainer',theme:'dark',width:1440,mode:'program-feedback',lime:true},
 {role:'client',theme:'light',width:390,mode:'entry',lime:false},{role:'trainer',theme:'dark',width:430,mode:'entry',lime:false},
 {role:'client',theme:'light',width:390,mode:'shared-voice',lime:true},{role:'trainer',theme:'dark',width:430,mode:'shared-voice',lime:true},
 {role:'client',theme:'dark',width:390,mode:'workout-restored',lime:true},{role:'trainer',theme:'light',width:430,mode:'workout-restored',lime:true},
]
// Reuse the native microphone/audio/transport double. Permission is a held
// external input, not an app phase/DOM override; app cancellation stays real.
async function holdMicrophone(page:Page){
 await page.evaluate(()=>{const devices=navigator.mediaDevices,get=devices.getUserMedia.bind(devices);Object.defineProperty(devices,'getUserMedia',{configurable:true,value:()=>new Promise<MediaStream>(resolve=>{Object.assign(window,{grantAssistantMicrophone:()=>{void get({audio:true}).then(resolve)}})})})})
}
// Observe natural frames only: text input may finish scrolling its caret
// after layout/fonts are already quiet. Preserve that native state in capture.
async function settleAssistantInput(page:Page,selector:string){
 await page.evaluate(async selector=>{
  const started=performance.now();let previous='',quiet=0,unchangedSince=started
  while(performance.now()-started<5000){
   await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
   const signature=JSON.stringify(Array.from(document.querySelectorAll(`${selector} input,${selector} textarea,${selector} select`)).map(node=>{
    const field=node as HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement,rect=field.getBoundingClientRect()
    return {value:field.value,focus:field===document.activeElement,scroll:[field.scrollLeft,field.scrollTop,field.scrollHeight,field.clientHeight],rect:[rect.x,rect.y,rect.width,rect.height],selection:field instanceof HTMLSelectElement?null:[field.selectionStart,field.selectionEnd,field.selectionDirection]}
   }))
   if(signature===previous)quiet++;else{quiet=0;unchangedSince=performance.now()}
   if(quiet>=4&&performance.now()-unchangedSince>=100)return
   previous=signature
  }
  throw Error('Assistant input state did not settle within 5000 ms')
 },selector)
}
// External viewport measurements model keyboard geometry; app listeners own
// all classes, layout and anchoring. This is not a physical keyboard claim.
async function keyboardPhase(page:Page,height:number|null){
 await page.evaluate(height=>{
  if(!visualViewport)throw Error('Native visualViewport is required')
  if(height===null)Reflect.deleteProperty(visualViewport,'height')
  else Object.defineProperty(visualViewport,'height',{configurable:true,value:height})
  visualViewport.dispatchEvent(new Event('resize'))
 },height)
}
export function limeAssistantSkinCases(){
 for(const sample of samples)test(`Assistant Lime skin ownership ${sample.role}-${sample.theme}-${sample.width}-${sample.mode}-${sample.lime}`,async({page},info)=>{
  const fixture=await prepareAssistantSkin(page,sample),shared=sample.mode==='shared-voice',programEnabled=process.env.VITE_ASSISTANT_PROGRAM_ENABLED==='true'
  const route=shared?(sample.role==='client'?'/me':'/today?view=compose'):'/assistant',selector=shared?'.phone-frame':assistantContract.selector
  const dynamicStates:Awaited<ReturnType<typeof probeAssistantRecording>>[]=[]
  const states:(Awaited<ReturnType<typeof probeEditorSkin>>&{state:string;url:string})[]=[]
  const probe=async(state:string)=>{await page.mouse.move(0,0);await settleEditorPaint(page,selector,assistantContract);await settleAssistantInput(page,selector);states.push({...await probeEditorSkin(page,info.outputPath('assistant-'+state+'.png'),selector,assistantContract),state,url:new URL(page.url()).pathname+new URL(page.url()).search})}
  const composer=page.getByRole('textbox',{name:'Сообщение ассистенту',exact:true}),send=page.getByRole('button',{name:'Отправить сообщение',exact:true}),context=page.getByRole('region',{name:'Текущий контекст ассистента'})
  await page.goto(route)
  if(shared){
   const voice=page.getByRole('button',{name:'Надиктовать тренировку',exact:true});await expect(voice).toBeVisible();await probe('shared-home')
   await page.evaluate(()=>Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>Promise.reject(new DOMException('Permission denied','NotAllowedError'))}))
   await voice.click();await expect(page.getByRole('alert').filter({hasText:'Нет доступа к микрофону'})).toBeVisible();await probe('shared-voice-error')
  }else{
   await expect(page.getByRole('heading',{name:'Ассистент',exact:true})).toHaveCount(1)
   if(sample.mode==='loading'){
    await expect.poll(()=>fixture.held().load).toBeGreaterThan(0);await expect(page.getByText('Загружаю сессию…',{exact:true})).toBeVisible();await probe('loading');fixture.releaseLoad();await expect(page.getByText('Сохранённая беседа. Здесь можно обсудить тренировку и восстановление.',{exact:true})).toBeVisible();await probe('loaded')
   }else if(sample.mode.endsWith('error')){
    const alert=page.getByRole('alert');await expect(alert).toBeVisible();await probe(sample.mode);fixture.recover();await alert.getByRole('button',{name:'Повторить',exact:true}).click();await expect(alert).toHaveCount(0);await expect(composer).toBeEnabled();await expect(page.getByText('Сохранённая беседа. Здесь можно обсудить тренировку и восстановление.',{exact:true})).toBeVisible();await probe('recovered')
   }else{
    await expect(composer).toBeEnabled();await expect(page.getByText('Загружаю сессию…',{exact:true})).toHaveCount(0)
    if(sample.mode==='entry'){
     await expect(page.getByRole('heading',{name:'Чем помочь?',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Составить программу',exact:true})).toHaveCount(programEnabled?1:0);await probe('first-entry')
     await page.getByRole('button',{name:'Где мой прогресс?',exact:true}).click();await expect(composer).toHaveValue('Где в приложении посмотреть мой прогресс?');await expect(composer).toBeFocused();expect(fixture.counts().turnAttempts).toBe(0)
     await composer.fill('Длинный текст первой строки\nВторая строка сохраняет место ввода\nТретья строка для проверки роста поля');await composer.press('Home');await composer.press('Shift+ArrowRight');await probe('entry-input')
     if(sample.lime&&sample.width===390){
      const before=await composer.evaluate(node=>{const field=node as HTMLTextAreaElement;return {value:field.value,selection:[field.selectionStart,field.selectionEnd,field.selectionDirection]}})
      await keyboardPhase(page,420);await expect(page.locator('html')).toHaveClass(/app-keyboard-open/);await expect(composer).toBeFocused();await probe('entry-keyboard-open')
      expect(await composer.evaluate(node=>{const field=node as HTMLTextAreaElement;return {value:field.value,selection:[field.selectionStart,field.selectionEnd,field.selectionDirection]}})).toEqual(before)
      const box=(await composer.boundingBox())!;expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(420)
      expect(await page.locator('.phone-frame .content').evaluate(node=>node.scrollTop)).toBe(0)
      await keyboardPhase(page,null);await expect(page.locator('html')).not.toHaveClass(/app-keyboard-open/);await expect(composer).toBeFocused();await probe('entry-keyboard-closed')
      expect(await composer.evaluate(node=>{const field=node as HTMLTextAreaElement;return {value:field.value,selection:[field.selectionStart,field.selectionEnd,field.selectionDirection]}})).toEqual(before)
      expect(await page.locator('.phone-frame .content').evaluate(node=>node.scrollTop)).toBe(0);expect(await page.evaluate(()=>scrollY)).toBe(0)
     }
    }else if(sample.mode==='text-retry'){
     await composer.fill('Запиши мою тренировку');await send.click();await expect.poll(()=>fixture.held().turn).toBe(1);await expect(composer).toBeDisabled();await expect(send).toBeDisabled();await probe('turn-pending');fixture.releaseTurn();await expect(page.getByRole('alert')).toContainText('Не удалось получить ответ');await expect(composer).toHaveValue('Запиши мою тренировку');await probe('turn-error');await page.getByRole('button',{name:'Повторить',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);const link=page.getByRole('link',{name:'Записать тренировку',exact:true});await expect(link).toBeVisible();await expect(context).toHaveCount(0);await probe('turn-recovered');const turns=fixture.writes.filter(w=>w.path==='/v1/assistant/turn');expect(turns).toHaveLength(2);expect(turns[0]!.body).toEqual(turns[1]!.body);await expect(page.locator('.assistant-message-user')).toHaveCount(1);await link.click();await expect(page).toHaveURL(sample.role==='client'?/\/me\?entry=workout$/:/\/today\?view=compose&entry=text$/)
    }else if(sample.mode==='history'){
     await page.getByRole('button',{name:'История 2',exact:true}).click();await expect(page.locator('.assistant-session-day')).toHaveCount(2);await probe('history-list');await page.getByRole('button',{name:'Результаты и сохранённые действия',exact:true}).click();await expect(composer).toBeDisabled();await expect(send).toBeDisabled();await expect(context).toHaveCount(0);await expect(page.locator('.assistant-workout-saved')).toBeVisible();await expect(page.getByRole('region',{name:'Сводка прогресса Алексей Смирнов'})).toHaveCount(1);await expect(page.getByRole('button',{name:'Сохранено в прогресс',exact:true})).toBeDisabled();await probe('history-receipts');await page.getByRole('button',{name:'Сегодня',exact:true}).click();await expect(composer).toBeEnabled();expect(fixture.counts().turnAttempts).toBe(0);await probe('return-today')
    }else if(sample.mode.startsWith('voice')){
     await composer.fill('Исходный текст');await holdMicrophone(page);await page.getByRole('button',{name:'Голосовой ввод',exact:true}).click();await expect(page.getByRole('button',{name:'Отменить запрос к микрофону',exact:true})).toBeVisible();await expect(composer).toBeDisabled();await probe('voice-requesting')
     if(sample.mode==='voice-request'){
      await page.getByRole('button',{name:'Отменить запрос к микрофону',exact:true}).click();await expect(composer).toBeEnabled();await expect(composer).toHaveValue('Исходный текст');await page.evaluate(()=>Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>Promise.reject(new DOMException('Permission denied','NotAllowedError'))}));await page.getByRole('button',{name:'Голосовой ввод',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Нет доступа к микрофону');await probe('voice-denied');await page.getByRole('button',{name:'Закрыть сообщение',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0)
     }else{
      await page.evaluate(()=>(window as unknown as {grantAssistantMicrophone():void}).grantAssistantMicrophone());await expect(page.getByRole('button',{name:/Завершить голосовой ввод/})).toBeVisible();await expect(composer).toHaveValue(/Исходный текст\nРаспознанный фрагмент/);dynamicStates.push(await probeAssistantRecording(page,info.outputPath('assistant-voice-recording.png'),process.env.FIT_ASSISTANT_SKIN_BASELINE==='1'));await page.getByRole('button',{name:/Завершить голосовой ввод/}).click();await expect(composer).toBeEnabled();await expect(composer).toHaveValue('Исходный текст\nРаспознанный фрагмент без повторения исходного текста');await probe('voice-finished')
     }
     expect(fixture.counts().turnAttempts).toBe(0)
    }else if(sample.mode.startsWith('program-')){
     await expect(context).toBeVisible();const add=page.getByRole('button',{name:'Добавить в расписание',exact:true})
     if(!programEnabled){await expect(context.getByText('Составление программ сейчас недоступно для этого аккаунта.',{exact:true})).toBeVisible();if(sample.mode!=='program-brief')await expect(add).toBeDisabled();await probe('program-disabled');expect(fixture.counts().applyAttempts).toBe(0)}
     else if(sample.mode==='program-brief'){
      await expect(page.getByRole('button',{name:'Одна тренировка',exact:true})).toBeEnabled();await probe('program-choices');await page.getByRole('button',{name:'Это все тренировки',exact:true}).click();await expect(page.getByRole('button',{name:'Подтвердить и составить',exact:true})).toBeEnabled();await expect(context.locator('details')).toHaveAttribute('open','');await probe('program-conditions');await context.getByRole('button',{name:'Отменить',exact:true}).click();await expect(context).toHaveCount(0);await expect(composer).toBeEnabled();const turns=fixture.writes.filter(w=>w.path==='/v1/assistant/turn');expect(turns.map(w=>(w.body as {message:string}).message)).toEqual(['Это все тренировки','Отменить']);expect(fixture.writes.filter(w=>w.path.endsWith('/cancel'))).toHaveLength(0)
     }else if(sample.mode==='program-edit'){
      await expect(add).toBeEnabled();await probe('program-overview');await page.locator('.assistant-program-sessions summary').click();const rows=page.locator('.assistant-program-sessions li');await expect(rows).toHaveCount(2);await rows.nth(1).getByRole('button',{name:'Изменить',exact:true}).click();const edit=page.getByRole('region',{name:'Изменение упражнения'});await expect(edit).toBeVisible();await expect(add).toBeDisabled();await edit.getByLabel('Подходы',{exact:true}).fill('2');await probe('program-edit-input');await edit.getByRole('button',{name:/Время упражнения:/}).click();const duration=page.getByRole('dialog',{name:'Время упражнения',exact:true});await expect(duration).toBeVisible();await probe('program-duration');await page.keyboard.press('Escape');await expect(duration).toHaveCount(0);await expect(edit.getByRole('button',{name:/Время упражнения:/})).toBeFocused();await edit.getByRole('button',{name:'Проверить изменение',exact:true}).click();await expect(composer).toBeEnabled();await expect(context.getByText('Изменение проверено.',{exact:true})).toBeVisible();await expect(edit).toHaveCount(0);await probe('program-edit-submitted');const turns=fixture.writes.filter(w=>w.path==='/v1/assistant/turn');expect(turns).toHaveLength(1);expect((turns[0]!.body as {message:string}).message).toBe('Измени упражнение 2 в занятии 2026-11-18; область: только это занятие; упражнение: Ходьба; подходы: 2; повторы: нет; секунды: 300; усилие: 4; отдых: 0.');expect(fixture.counts().applyAttempts).toBe(0);await context.getByRole('button',{name:'Отменить',exact:true}).click();await expect(context).toHaveCount(0);const cancellations=fixture.writes.filter(w=>w.path.endsWith('/cancel'));expect(cancellations).toHaveLength(1);expect(cancellations[0]!.body).toEqual({expectedVersion:1})
     }else if(sample.mode==='program-save'){
      await add.click();await expect.poll(()=>fixture.held().apply).toBe(1);await expect(page.getByRole('button',{name:'Добавляю…',exact:true})).toBeDisabled();await probe('program-save-pending');fixture.releaseApply();await expect(context.getByRole('alert')).toContainText('Не удалось сохранить программу');await probe('program-save-error');await add.click();await expect(context).toHaveCount(0);await expect(page.getByText('Программа добавлена в расписание: 1 тренировок.',{exact:true})).toBeVisible();await probe('program-saved');const saves=fixture.writes.filter(w=>w.path.endsWith('/apply'));expect(saves).toHaveLength(2);expect(saves[0]!.body).toEqual(saves[1]!.body);expect((saves[1]!.body as {input:{workouts:unknown}}).input.workouts).toEqual(assistantCanonicalWorkouts)
     }else{
      await page.getByRole('button',{name:'Оставить обратную связь',exact:true}).click();const feedback=page.getByRole('form',{name:'Как вам программа?'});await expect(feedback).toBeVisible();await expect(feedback.getByRole('button',{name:'Отправить отзыв'})).toBeDisabled();await feedback.getByRole('button',{name:'Что-то не так',exact:true}).click();const comment=page.getByRole('textbox',{name:'Комментарий к программе'});await comment.fill('Нужно уточнить длительность отдыха');await expect(comment).toBeFocused();await probe('program-feedback-input');await feedback.getByRole('button',{name:'Отправить отзыв',exact:true}).click();await expect.poll(()=>fixture.held().feedback).toBe(1);const selectedRating=feedback.getByRole('button',{name:'Что-то не так',exact:true});await expect(selectedRating).toHaveClass(/\bactive\b/);await expect(selectedRating).toHaveAttribute('aria-pressed','true');await expect(selectedRating).toBeDisabled();await expect(feedback.getByRole('button',{name:'Всё хорошо',exact:true})).toBeDisabled();await expect(feedback.getByRole('button',{name:'Отправляю…',exact:true})).toBeDisabled();await expect(comment).toHaveValue('Нужно уточнить длительность отдыха');await probe('program-feedback-pending');fixture.releaseFeedback();await expect(feedback.getByRole('alert')).toBeVisible();await expect(selectedRating).toBeEnabled();await expect(selectedRating).toHaveClass(/\bactive\b/);await expect(selectedRating).toHaveAttribute('aria-pressed','true');await expect(comment).toHaveValue('Нужно уточнить длительность отдыха');await expect(feedback.getByRole('button',{name:'Отправить отзыв',exact:true})).toBeEnabled();await probe('program-feedback-error');await feedback.getByRole('button',{name:'Отправить отзыв',exact:true}).click();await expect(page.getByText('Обратная связь отправлена',{exact:true})).toBeVisible();await probe('program-feedback-sent');const submissions=fixture.writes.filter(w=>w.path==='/v1/app-feedback');expect(submissions).toHaveLength(2);expect(submissions[0]!.body).toEqual(submissions[1]!.body);expect(submissions[1]!.body).toMatchObject({kind:'training program',message:'Нужно уточнить длительность отдыха',screenPath:'/assistant',modelInputJson:{fixture:'MC57 synthetic request'},modelOutputJson:{fixture:'MC57 synthetic response'}});expect(fixture.counts().feedbackAttempts).toBe(2);await page.getByRole('button',{name:'Готово',exact:true}).click();await expect(page.getByText('Обратная связь отправлена',{exact:true})).toHaveCount(0)
     }
    }else if(sample.mode==='workout-restored'){
     const draft=page.locator('.assistant-workout-draft');await expect(draft).toBeVisible();await expect(page.locator('.assistant-exercise-choice')).toHaveCount(1);await probe('workout-ambiguous');await page.locator('.assistant-exercise-options button').first().click();await expect(page.locator('.assistant-exercise-choice')).toHaveCount(0);await expect(page.locator('.assistant-workout-result-row')).toHaveCount(2);await draft.getByLabel('Дата',{exact:true}).fill('2026-11-17');await draft.getByLabel('Время',{exact:true}).fill('10:30');await page.locator('.assistant-workout-result-row').first().getByRole('button',{name:/Удалить/}).click();await expect(page.locator('.assistant-workout-result-row')).toHaveCount(1);const retained=page.locator('.assistant-workout-result-row');await expect(retained).toContainText(fixture.retainedExercise.name);const weight=retained.getByLabel('Вес',{exact:true});await weight.clear();await expect(weight).toHaveValue('');await weight.fill('45');await retained.getByLabel('Повторы',{exact:true}).clear();await retained.getByLabel('Повторы',{exact:true}).fill('14');await retained.getByLabel('Подходы',{exact:true}).fill('2');await probe('workout-edited');const snapshot=await page.evaluate(key=>localStorage.getItem(key),fixture.draftKey);await page.reload();await expect(page.locator('.assistant-workout-result-row')).toHaveCount(1);expect(await page.evaluate(key=>localStorage.getItem(key),fixture.draftKey)).toBe(snapshot);const persisted=JSON.parse(snapshot!) as {result:{items:{exerciseRef:string;sets:unknown[]}[]}};expect(persisted.result.items).toHaveLength(1);expect(persisted.result.items[0]!.exerciseRef).toBe(fixture.retainedExercise.ref);expect(persisted.result.items[0]!.sets).toEqual([{weightKg:45,reps:14},{weightKg:45,reps:14}]);await expect(page.locator('.assistant-workout-result-row').getByLabel('Вес',{exact:true})).toHaveValue('45');await expect(page.locator('.assistant-workout-result-row').getByLabel('Повторы',{exact:true})).toHaveValue('14');await expect(page.locator('.assistant-workout-result-row').getByLabel('Подходы',{exact:true})).toHaveValue('2');await page.getByRole('button',{name:'Сохранить тренировку',exact:true}).click();await expect(page.locator('.assistant-workout-saved')).toBeVisible();await probe('workout-saved');expect(await page.evaluate(key=>localStorage.getItem(key),fixture.draftKey)).toBeNull();expect(fixture.writes.filter(w=>w.path.endsWith('/apply'))).toHaveLength(1)
    }
   }
  }
  expect(states.length).toBeGreaterThan(0);expect(fixture.historyUnchanged()).toBe(true);expect(fixture.diagnostics).toEqual([]);expect(fixture.legacyRequests).toEqual([])
  const uuidEvidence=await page.evaluate(()=>(window as unknown as {__fitAssistantTurnUUIDEvidence:{events:string[];consumed:string[]}}).__fitAssistantTurnUUIDEvidence)
  expect(uuidEvidence.consumed).toHaveLength(uuidEvidence.events.length);expect(new Set(uuidEvidence.consumed).size).toBe(uuidEvidence.consumed.length)
  if(uuidEvidence.consumed.length){const ids=fixture.writes.filter(w=>w.path==='/v1/assistant/turn').map(w=>(w.body as {turn_id:string}).turn_id);expect([...new Set(ids)]).toEqual(uuidEvidence.consumed)}
  await writeFile(info.outputPath('assistant-skin.json'),JSON.stringify({sample,route,programEnabled,effectiveProgramBranch:sample.mode.startsWith('program-')?(programEnabled?sample.mode:'program-disabled'):'not-program',uuidEvidence,historicalActions:fixture.historicalActions,featureLinks:sample.mode!=='workout-restored',states,dynamicStates,writes:fixture.writes,reads:fixture.reads,initialMessages:fixture.initialMessages,finalMessages:fixture.messages(),counts:fixture.counts(),diagnostics:fixture.diagnostics,historyUnchanged:fixture.historyUnchanged()}))
  for(const state of states){if(shared){expect(state.owners).toEqual([]);continue}if(sample.lime&&process.env.FIT_ASSISTANT_SKIN_BASELINE==='1'){expect(state.owners).toEqual([]);expect(state.matches.length+state.ancestorMatches.length+state.pseudoMatches.length).toBeGreaterThan(0)}else assertEditorOwnership(state,sample.lime,assistantContract)}
 })
}
