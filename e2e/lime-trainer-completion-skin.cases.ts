import {test,expect,type Page} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {mockPilot,restTimerWorkout,workoutId,clientId} from './fit-lime-fixtures'
import {settleCompletionPaint} from './lime-live-completion-skin.probe'

const trainerSelector='.workout-completion'
const trainerFamilies=[".workout-completion", ".workout-completion-mark", ".workout-completion-kicker", ".workout-completion h2", ".workout-completion p", ".workout-completion-record strong", ".workout-completion-record span", ".workout-completion-next", ".workout-detail-history-identity .workout-completion", ".workout-detail-history-identity .workout-completion-mark", ".workout-detail-history-identity .workout-completion-kicker", ".workout-detail-history-identity .workout-completion h2", ".workout-detail-history-identity .workout-completion p", ".workout-detail-history-identity .workout-completion-record strong", ".workout-detail-history-identity .workout-completion-record span", ".workout-detail-history-identity .workout-completion-next"]
const trainerMigrationGuards=[
  ':where(:not(.fit-lime-shell.workout-detail-history-identity .workout-completion, .fit-lime-shell.workout-detail-history-identity .workout-completion *))',
]
const trainerOwnerPrefix='.workout-detail-history-identity:where(.fit-lime-shell) '
const trainerOwners=[
  '.workout-completion-kicker','.workout-completion h2','.workout-completion p',
  '.workout-completion-record strong','.workout-completion-record span','.workout-completion-next',
].map(selector=>trainerOwnerPrefix+selector)

// Trainer completion ownership: keep CSSRule/style objects, optimizer branches and
// neutral card layout intact. Raw user paths stay outside this diagnostic.
export async function probeTrainerCompletionSkin(page: Page, screenshot?: string) {
  const capture = () => page.locator('.phone-frame').evaluate((root, selector) => {
    const properties = ['display','position','color','background-color','font-family','font-size','font-weight','font-variant-numeric','text-transform','text-decoration-line','text-decoration-color','text-decoration-style','letter-spacing','line-height','width','height','min-width','min-height','max-height','gap','grid-template-columns','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','border-top-width','border-top-color','border-top-style','border-right-width','border-right-color','border-right-style','border-bottom-width','border-bottom-color','border-bottom-style','border-left-width','border-left-color','border-left-style','border-radius','box-shadow','outline-color','outline-width','outline-style','outline-offset','overflow-x','overflow-y','scroll-snap-type','touch-action','animation-name','animation-duration','transition-property','transition-duration','opacity','align-items','justify-content']
    const targets = Array.from(root.querySelectorAll(selector)), nodes = [...new Set(targets.flatMap(node => [node,...node.querySelectorAll('*')]))]
    return nodes.map(node => { const css=getComputedStyle(node),rect=node.getBoundingClientRect();return {tag:node.tagName,class:node.getAttribute('class')||'',style:Object.fromEntries(properties.map(property=>[property,css.getPropertyValue(property)])),rect:[rect.x,rect.y,rect.width,rect.height].map(value=>Math.round(value*100)/100)} })
  }, trainerSelector)
  const cssom = () => page.evaluate(() => Array.from(document.styleSheets).map(sheet => Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n')))
  const state = () => page.evaluate(() => {
    const active=document.activeElement
    const elements=[document.scrollingElement,...document.querySelectorAll('.content,.workout-completion')].filter((node):node is HTMLElement=>node instanceof HTMLElement)
    return {focus:active?{tag:active.tagName,id:active.id,class:active.className,role:active.getAttribute('role'),text:active.textContent}:null,scroll:elements.map(node=>({tag:node.tagName,class:node.className,x:node.scrollLeft,y:node.scrollTop,height:node.scrollHeight,client:node.clientHeight})),anchor:Array.from(document.querySelectorAll<HTMLElement>('.content')).map(node=>({style:node.getAttribute('style'),value:node.style.getPropertyValue('overflow-anchor'),priority:node.style.getPropertyPriority('overflow-anchor'),computed:getComputedStyle(node).overflowAnchor}))}
  })
  await settleCompletionPaint(page,trainerSelector)
  const before=await capture();expect(before.length).toBeGreaterThan(0)
  const cssomBefore=await cssom(),stateBefore=await state()
  const backdrop=await page.locator('.workout-completion').evaluateAll(elements=>elements.map(element=>getComputedStyle(element).backgroundColor))
  const frameBackground=await page.locator('.phone-frame').evaluate(element=>getComputedStyle(element).backgroundColor)
  if(screenshot)await page.screenshot({path:screenshot,animations:'disabled'})
  expect(await capture()).toEqual(before)
  const ablation=await page.evaluateHandle(({families,guards,owners,selector})=>{
    const normalize=(selector:string)=>selector.replace(/,\s*/g,',').replace(/"/g,"'")
    const common=new Set(families.map(normalize)),allowed=new Set(guards.map(normalize)),ownerSelectors=new Set(owners.map(normalize))
    const visual=/^(?:color|background(?:-.+)?|border(?:-.+)?|box-shadow|font(?:-.+)?|letter-spacing|text-transform|text-decoration(?:-.+)?|opacity|outline(?:-.+)?|animation)$/
    const strip=(selector:string)=>{
      let cursor=0
      while(true){const start=selector.indexOf(':where(',cursor);if(start<0)break;let end=start+7,depth=1,quote='';while(depth&&end<selector.length){const char=selector[end]!;if(quote){if(char===quote&&selector.charCodeAt(end-1)!==92)quote=''}else if(char==='"'||char==="'")quote=char;else if(char==='(')depth++;else if(char===')')depth--;end++}const block=selector.slice(start,end);if(allowed.has(normalize(block))){selector=selector.slice(0,start)+selector.slice(end);cursor=start}else cursor=end}
      return normalize(selector)
    }
    const unknownGuard=families[0]!+':where(:not(.mc516-unknown-owner))'
    const classifierGuardChecks={known:strip(families[0]!+guards[0]!)===normalize(families[0]!),unknownRetained:strip(unknownGuard)===normalize(unknownGuard)}
    const branches=(text:string)=>{const list:string[]=[];let depth=0,quote='',start=0;for(let i=0;i<text.length;i++){const char=text[i]!;if(quote){if(char===quote&&text.charCodeAt(i-1)!==92)quote='';continue}if(char==='"'||char==="'")quote=char;else if(char==='('||char==='[')depth++;else if(char===')'||char===']')depth--;else if(char===','&&!depth){list.push(text.slice(start,i).trim());start=i+1}}list.push(text.slice(start).trim());return list}
    const owned=new Set(document.querySelectorAll('.workout-completion,.workout-completion *'))
    const touchesOwned=(selector:string)=>Array.from(document.querySelectorAll(selector)).some(node=>owned.has(node))
    const changed:{rule:CSSStyleRule;selectors:string[];selected:string[]}[]=[],foundOwners=new Set<string>(),ownerDefinitions=new Set<string>()
    const visit=(rules:CSSRuleList)=>{for(const rule of Array.from(rules)){if(rule instanceof CSSStyleRule){const selectors=branches(rule.selectorText);for(const selector of selectors)if(ownerSelectors.has(normalize(selector))){ownerDefinitions.add(normalize(selector));if(touchesOwned(selector))foundOwners.add(normalize(selector))};const selected=selectors.filter(selector=>common.has(strip(selector))&&Array.from(rule.style).some(property=>visual.test(property)));if(selected.length)changed.push({rule,selectors,selected})}if('cssRules'in rule)visit((rule as CSSGroupingRule).cssRules)}}
    for(const sheet of Array.from(document.styleSheets))visit(sheet.cssRules)
    const selected=changed.flatMap(item=>item.selected),matches=selected.filter(touchesOwned)
    const legacyMatches=selected.every(selector=>{const old=Array.from(document.querySelectorAll(strip(selector))).filter(node=>owned.has(node)),current=Array.from(document.querySelectorAll(selector)).filter(node=>owned.has(node));return old.length===current.length&&old.every((node,i)=>node===current[i])})
    const probe=document.createElement('style');probe.textContent=matches.map(selector=>selector+'{--mc516-legacy-report-probe:legacy}').join(' ');document.head.append(probe)
    const inherited=Array.from(document.querySelectorAll(selector)).flatMap(node=>[node,...node.querySelectorAll('*')]).filter(node=>getComputedStyle(node).getPropertyValue('--mc516-legacy-report-probe').trim()==='legacy').length;probe.remove()
    const anchorStyle=document.createElement('style');anchorStyle.textContent='.content{overflow-anchor:none!important}';document.head.append(anchorStyle)
    const scroll=Array.from(document.querySelectorAll<HTMLElement>('*')).map(node=>({node,x:node.scrollLeft,y:node.scrollTop}))
    const restore:{rule:CSSStyleRule;style:CSSStyleDeclaration;selector:string;text:string}[]=[],clones:{parent:CSSStyleSheet|CSSGroupingRule;rule:CSSRule}[]=[]
    const ownedFilter='.workout-completion,.workout-completion *'
    for(const {rule,selectors,selected} of changed){
      const applicable=selected.filter(touchesOwned)
      if(!applicable.length)continue
      const originalSelector=rule.selectorText,text=rule.style.cssText
      // Broad detail-button branches keep their paint on every unrelated node.
      const retained=selectors.map(branch=>applicable.includes(branch)?branch+':where(:not('+ownedFilter+'))':branch)
      rule.selectorText=retained.join(', ')
      const neutral=Array.from(rule.style).filter(property=>!visual.test(property)).map(property=>property+':'+rule.style.getPropertyValue(property)+(rule.style.getPropertyPriority(property)?'!important':'')).join(';')
      if(neutral){const parent=(rule.parentRule??rule.parentStyleSheet) as CSSGroupingRule,index=Array.from(parent.cssRules).indexOf(rule);parent.insertRule(applicable.map(branch=>branch+':where('+ownedFilter+')').join(', ')+'{'+neutral+'}',index+1);clones.push({parent,rule:parent.cssRules[index+1]!})}
      restore.push({rule,style:rule.style,selector:originalSelector,text})
    }
    return {rules:changed.length,families:[...new Set(selected.map(strip))],matches,inherited,legacyMatches,selectedPositiveOwners:selected.filter(selector=>strip(selector).includes(':where(')),owners:[...foundOwners].sort(),ownerDefinitions:[...ownerDefinitions].sort(),classifierGuardChecks,classifierOwnerChecks:[...ownerSelectors].map(selector=>({selector,retained:strip(selector)===selector,legacy:common.has(strip(selector))})),restore,clones,scroll,anchorStyle}
  },{families:trainerFamilies,guards:trainerMigrationGuards,owners:trainerOwners,selector:trainerSelector})
  const result=await ablation.evaluate(value=>({rules:value.rules,families:value.families,matches:value.matches,inherited:value.inherited,legacyMatches:value.legacyMatches,selectedPositiveOwners:value.selectedPositiveOwners,owners:value.owners,ownerDefinitions:value.ownerDefinitions,classifierGuardChecks:value.classifierGuardChecks,classifierOwnerChecks:value.classifierOwnerChecks}))
  expect(result.classifierGuardChecks).toEqual({known:true,unknownRetained:true})
  expect(result.selectedPositiveOwners).toEqual([])
  expect(result.classifierOwnerChecks).toHaveLength(6)
  expect(result.classifierOwnerChecks.every(check=>check.retained&&!check.legacy)).toBe(true)
  await settleCompletionPaint(page,trainerSelector)
  const after=await capture()
  const restoration=await ablation.evaluate(async({restore,clones,scroll})=>{
    for(const saved of restore)saved.rule.selectorText=saved.selector
    for(const {parent,rule} of clones){const index=Array.from(parent.cssRules).indexOf(rule);if(index<0)throw Error('Neutral trainer-card clone missing');parent.deleteRule(index)}
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
    for(const {node,x,y} of scroll){node.scrollLeft=x;node.scrollTop=y}
    return restore.every(saved=>saved.rule.style===saved.style&&saved.rule.selectorText===saved.selector&&saved.rule.style.cssText===saved.text)
  })
  await settleCompletionPaint(page,trainerSelector)
  await ablation.evaluate(({anchorStyle})=>anchorStyle.remove());await ablation.dispose()
  await settleCompletionPaint(page,trainerSelector)
  expect(restoration).toBe(true);expect(await cssom()).toEqual(cssomBefore);expect(await state()).toEqual(stateBefore);expect(await capture()).toEqual(before)
  expect(await page.locator('.workout-completion').evaluateAll(elements=>elements.map(element=>getComputedStyle(element).backgroundColor))).toEqual(backdrop)
  expect(after).toHaveLength(before.length)
  const differences=before.flatMap((a,i)=>{const b=after[i]!,changes=Object.fromEntries(Object.keys(a.style).filter(property=>a.style[property]!==b.style[property]).map(property=>[property,[a.style[property],b.style[property]]]));return Object.keys(changes).length||JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[{tag:a.tag,class:a.class,changes,rect:JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[a.rect,b.rect]:undefined}]:[]})
  return {before,backdrop,frameBackground,...result,restoration,cssomRoundTrip:true,focusScrollAnchorRoundTrip:true,differences,stateBefore}
}

export function assertTrainerCompletionOwnership(result: Awaited<ReturnType<typeof probeTrainerCompletionSkin>>, lime: boolean) {
  expect([...result.families].sort()).toEqual([...trainerFamilies].sort())
  if(lime){
    expect(result.matches).toEqual([]);expect(result.inherited).toBe(0);expect(result.differences).toEqual([])
    expect(result.ownerDefinitions).toEqual([...trainerOwners].sort());expect(result.owners.length).toBeGreaterThan(0)
  }else{
    expect(result.owners).toEqual([]);expect(result.legacyMatches).toBe(true)
    expect(result.matches.length).toBeGreaterThan(0);expect(result.inherited).toBeGreaterThan(0);expect(result.differences.length).toBeGreaterThan(0)
  }
}

export function limeTrainerCompletionSkinCases(){
  const samples=[
    {theme:'light',width:390,lime:true,state:'ordinary',compact:false},
    {theme:'dark',width:390,lime:true,state:'ordinary',compact:false},
    {theme:'dark',width:430,lime:true,state:'record',compact:true},
    {theme:'light',width:375,lime:true,state:'partial',compact:true},
    {theme:'dark',width:1440,lime:true,state:'record-long',compact:false},
    {theme:'light',width:390,lime:true,state:'error',compact:false},
    {theme:'dark',width:390,lime:false,state:'record',compact:false},
  ]
  for(const sample of samples)test('Done Lime trainer completion skin ownership '+Object.values(sample).join('-'),async({page,browserName},info)=>{
    const errors:string[]=[],requests:string[]=[],responses:string[]=[],consoleErrors:{text:string;path:string}[]=[]
    page.on('pageerror',error=>errors.push(error.message))
    page.on('requestfailed',request=>requests.push(new URL(request.url()).pathname))
    page.on('response',response=>{if(response.status()>=400)responses.push(String(response.status())+' '+new URL(response.url()).pathname)})
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push({text:message.text(),path:new URL(message.location().url||page.url()).pathname})})
    const id='c0ac0000-6010-4000-8000-000000000001'
    await page.setViewportSize({width:sample.width,height:844})
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00Z'))
    await page.addInitScript(({id,sample})=>{
      localStorage.setItem('fit.appTheme',sample.theme)
      localStorage.setItem('fit.liveExerciseAnimation.'+id,'false')
    },{id,sample})
    const source=restTimerWorkout()
    source.startedAt='2026-09-24T10:00:00Z';source.trainerId=id;source.createdBy=id
    source.exercises[0]!.sets.forEach((set,index)=>{
      if(sample.state!=='partial'||index===0)Object.assign(set,{fact:{weightKg:20,reps:10},confirmedAt:'2026-09-24T11:00:00Z'})
    })
    const expectedFacts=JSON.stringify(source.exercises)
    const backend=await mockPilot(page,{role:'trainer',profileId:id,fitLime:sample.lime,clientLime:false,scheduleDensity:sample.compact?'compact':'comfortable',workouts:[source]})
    await page.route('**/v1/push-notifications/status',route=>route.fulfill({json:{status:{subscribed:false,preferences:{workout_reminder:true,workout_scheduled:true,chat_message:true}}}}))
    await page.route('**/v1/exercise-media/sign-batch',route=>{
      const {paths}=route.request().postDataJSON() as {paths:string[]}
      return route.fulfill({json:{signedUrls:paths.map(path=>({path,signedUrl:new URL('/exercises/vital/air-bike-sprint.jpg',page.url()).href}))}})
    })
    const path='/v1/workouts/'+workoutId+'/personal-records'
    let calls=0,release:()=>void=()=>{}
    const gate=new Promise<void>(resolve=>{release=resolve})
    const record={exerciseRef:'squat',exerciseName:sample.state==='record-long'?'Приседания со штангой на плечах с контролируемым медленным опусканием':'Приседания',inputKind:'strength',metric:'weight_reps',primaryValue:840,weightKg:70,reps:12}
    await page.route('**'+path,async route=>{
      calls++
      if(calls===1)await gate
      if(sample.state==='error')await route.fulfill({status:503,json:{error:'unavailable'}})
      else await route.fulfill({json:{records:sample.state.startsWith('record')?[record]:[]}})
    })
    const scroll=()=>page.locator('.content').evaluate(node=>({x:node.scrollLeft,y:node.scrollTop,height:node.scrollHeight,client:node.clientHeight}))
    await page.goto('/workouts/'+workoutId+'/live')
    await expect(page.getByRole('button',{name:'Завершить тренировку',exact:true})).toBeVisible()
    expect(await page.evaluate(()=>localStorage.getItem('fit.appTheme'))).toBe(sample.theme)
    if(sample.lime)await expect(page.locator('.coach-live-v79')).toBeVisible()
    const initialScroll=await scroll()
    await page.getByRole('button',{name:'Завершить тренировку',exact:true}).click()
    const attendance=page.getByRole('dialog',{name:sample.lime?'Завершение тренировки':'Отметить проведённой',exact:true})
    await expect(attendance).toBeVisible()
    if(sample.lime)await expect(attendance.getByRole('radio',{name:'Завершить тренировку',exact:true})).toBeChecked()
    await attendance.getByRole('button',{name:sample.lime?'Завершить тренировку':'Подтвердить проведение',exact:true}).click()
    const card=page.getByRole('region',{name:'Тренировка завершена',exact:true}),frame=page.locator('.phone-frame')
    await expect(card).toHaveClass(/workout-completion/)
    await expect(frame).toHaveClass(/workout-detail-history-identity/)
    if(sample.lime){
      await expect(frame).toHaveClass(/fit-lime-shell/)
      // Current trainer Lime shell is dark for both real stored preferences.
      await expect(frame).not.toHaveClass(/theme-light/)
      await expect(page.locator('html')).not.toHaveClass(/theme-light/)
    }else await expect(frame).not.toHaveClass(/fit-lime-shell/)
    await expect(frame).not.toHaveClass(/fit-client-lime/)
    await expect(page.locator('.workout-completion-report')).toHaveCount(0)
    await expect.poll(()=>calls).toBe(1)
    const link=card.getByRole('link',{name:'Вернуться к клиенту',exact:true})
    await expect(link).toHaveAttribute('href','/clients/'+clientId)
    const results=[]
    const probe=async(state:string)=>{
      await page.mouse.move(0,0)
      return {state,...await probeTrainerCompletionSkin(page,info.outputPath('completion-card-'+state+'.png'))}
    }
    // Hold the real request while capturing the existing no-record loading card.
    if(sample.state.startsWith('record'))results.push(await probe('loading'))
    release()
    if(sample.state==='error'){
      await expect.poll(()=>responses.length).toBe(2)
      expect(calls).toBe(2)
    }else if(sample.state.startsWith('record')){
      await expect(card.locator('.workout-completion-record strong')).toHaveText('Личный рекорд · '+record.exerciseName)
      await expect(card.locator('.workout-completion-record span')).toHaveText('70 кг × 12 повт.')
    }else await expect.poll(()=>calls).toBe(1)
    if(!sample.state.startsWith('record'))await expect(card.locator('.workout-completion-record')).toHaveCount(0)
    await expect(card.locator('p')).toHaveText(sample.state==='partial'?'Подтверждено 1 из 2 подходов':'Подтверждено 2 подхода')
    // Calibrate the start, then use real forward/backward keyboard navigation.
    await card.locator('h2').evaluate(node=>{node.setAttribute('tabindex','-1');(node as HTMLElement).focus()})
    await page.keyboard.press(browserName==='webkit'?'Alt+Tab':'Tab')
    await expect(link).toBeFocused()
    await page.keyboard.press(browserName==='webkit'?'Alt+Shift+Tab':'Shift+Tab')
    await expect(link).not.toBeFocused()
    await page.keyboard.press(browserName==='webkit'?'Alt+Tab':'Tab')
    await expect(link).toBeFocused()
    results.push(await probe(sample.state))
    expect(JSON.stringify(backend.getWorkouts().find(workout=>workout.id===workoutId)!.exercises)).toBe(expectedFacts)
    expect(backend.getWorkouts().find(workout=>workout.id===workoutId)!.status).toBe('done')
    const rootClasses=await frame.getAttribute('class'),finalScroll=await scroll()
    await link.click()
    await expect(page).toHaveURL('/clients/'+clientId)
    const destination=page.url()
    await writeFile(info.outputPath('trainer-completion-skin.json'),JSON.stringify({sample,rootClasses,destination,initialScroll,finalScroll,factsUnchanged:true,status:'done',results,calls,errors,requests,responses,consoleErrors},null,2))
    expect(errors).toEqual([]);expect(requests).toEqual([])
    if(sample.state==='error'){
      expect(responses).toEqual(['503 '+path,'503 '+path])
      expect(consoleErrors.length).toBeLessThanOrEqual(2)
      for(const message of consoleErrors){expect(message.text.startsWith('Failed to load resource:')).toBe(true);expect(message.path).toBe(path)}
    }else{expect(responses).toEqual([]);expect(consoleErrors).toEqual([])}
    for(const result of results)assertTrainerCompletionOwnership(result,sample.lime)
  })
}
