import {test,expect,type Page} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {mockPilot,restTimerWorkout,workoutId,clientId,trainerId} from './fit-lime-fixtures'
import {settleCompletionPaint} from './lime-live-completion-skin.probe'

const reportSelector='.workout-completion-share-card'
const reportFamilies=[
  '.workout-completion-share-card','.workout-completion-report-art','.workout-completion-report-subtitle',
  '.workout-completion-report h1','.workout-completion-report-date','.workout-completion-count-line',
  '.workout-completion-count-line strong','.workout-completion-report-facts','.workout-completion-report-facts div',
  '.workout-completion-report-facts dt','.workout-completion-report-facts dd',
].map(selector=>'.workout-detail-history-identity '+selector)
const reportMigrationGuards=[
  ':where(:not(.fit-client-lime .workout-completion-share-card, .fit-client-lime .workout-completion-share-card *))',
]
const reportOwnerPrefix='.workout-detail-history-identity:where(.fit-client-lime) '
const reportOwners=[
  '.workout-completion-report-art','.workout-completion-report-subtitle','.workout-completion-report-date',
  '.workout-completion-count-line','.workout-completion-count-line strong','.workout-completion-report-facts',
  '.workout-completion-report-facts div','.workout-completion-report-facts dt','.workout-completion-report-facts dd',
].map(selector=>reportOwnerPrefix+selector)

// Report hero/metrics ownership: keep CSSRule/style objects, optimizer branches and
// neutral card layout intact. Raw user paths stay outside this diagnostic.
export async function probeCompletionReportSkin(page: Page, screenshot?: string) {
  const capture = () => page.locator('.phone-frame').evaluate((root, selector) => {
    const properties = ['display','position','color','background-color','font-family','font-size','font-weight','font-variant-numeric','letter-spacing','line-height','width','height','min-width','min-height','max-height','gap','grid-template-columns','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','border-top-width','border-top-color','border-top-style','border-right-width','border-right-color','border-right-style','border-bottom-width','border-bottom-color','border-bottom-style','border-left-width','border-left-color','border-left-style','border-radius','box-shadow','outline-color','outline-width','outline-style','outline-offset','overflow-x','overflow-y','scroll-snap-type','touch-action','animation-name','animation-duration','transition-property','transition-duration','opacity','align-items','justify-content']
    const targets = Array.from(root.querySelectorAll(selector)), nodes = [...new Set(targets.flatMap(node => [node,...node.querySelectorAll('*')]))]
    return nodes.map(node => { const css=getComputedStyle(node),rect=node.getBoundingClientRect();return {tag:node.tagName,class:node.getAttribute('class')||'',style:Object.fromEntries(properties.map(property=>[property,css.getPropertyValue(property)])),rect:[rect.x,rect.y,rect.width,rect.height].map(value=>Math.round(value*100)/100)} })
  }, reportSelector)
  const cssom = () => page.evaluate(() => Array.from(document.styleSheets).map(sheet => Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n')))
  const state = () => page.evaluate(() => {
    const active=document.activeElement
    const elements=[document.scrollingElement,...document.querySelectorAll('.content,.workout-completion-share-card')].filter((node):node is HTMLElement=>node instanceof HTMLElement)
    return {focus:active?{tag:active.tagName,id:active.id,class:active.className,role:active.getAttribute('role'),text:active.textContent}:null,scroll:elements.map(node=>({tag:node.tagName,class:node.className,x:node.scrollLeft,y:node.scrollTop,height:node.scrollHeight,client:node.clientHeight})),anchor:Array.from(document.querySelectorAll<HTMLElement>('.content')).map(node=>({style:node.getAttribute('style'),value:node.style.getPropertyValue('overflow-anchor'),priority:node.style.getPropertyPriority('overflow-anchor'),computed:getComputedStyle(node).overflowAnchor}))}
  })
  await settleCompletionPaint(page,reportSelector)
  const before=await capture();expect(before.length).toBeGreaterThan(0)
  const cssomBefore=await cssom(),stateBefore=await state()
  const backdrop=await page.locator('.workout-completion-share-card').evaluate(element=>getComputedStyle(element).backgroundColor)
  const frameBackground=await page.locator('.phone-frame').evaluate(element=>getComputedStyle(element).backgroundColor)
  if(screenshot)await page.screenshot({path:screenshot,animations:'disabled'})
  expect(await capture()).toEqual(before)
  const ablation=await page.evaluateHandle(({families,guards,owners,selector})=>{
    const normalize=(selector:string)=>selector.replace(/,\s*/g,',').replace(/"/g,"'")
    const common=new Set(families.map(normalize)),allowed=new Set(guards.map(normalize)),ownerSelectors=new Set(owners.map(normalize))
    const visual=/^(?:color|background(?:-.+)?|border(?:-.+)?|box-shadow|font(?:-.+)?|letter-spacing|opacity|outline(?:-.+)?|animation)$/
    const strip=(selector:string)=>{
      let cursor=0
      while(true){const start=selector.indexOf(':where(',cursor);if(start<0)break;let end=start+7,depth=1,quote='';while(depth&&end<selector.length){const char=selector[end]!;if(quote){if(char===quote&&selector.charCodeAt(end-1)!==92)quote=''}else if(char==='"'||char==="'")quote=char;else if(char==='(')depth++;else if(char===')')depth--;end++}const block=selector.slice(start,end);if(allowed.has(normalize(block))){selector=selector.slice(0,start)+selector.slice(end);cursor=start}else cursor=end}
      return normalize(selector)
    }
    const unknownGuard=families[0]!+':where(:not(.mc514-unknown-owner))'
    const classifierGuardChecks={known:strip(families[0]!+guards[0]!)===normalize(families[0]!),unknownRetained:strip(unknownGuard)===normalize(unknownGuard)}
    const branches=(text:string)=>{const list:string[]=[];let depth=0,quote='',start=0;for(let i=0;i<text.length;i++){const char=text[i]!;if(quote){if(char===quote&&text.charCodeAt(i-1)!==92)quote='';continue}if(char==='"'||char==="'")quote=char;else if(char==='('||char==='[')depth++;else if(char===')'||char===']')depth--;else if(char===','&&!depth){list.push(text.slice(start,i).trim());start=i+1}}list.push(text.slice(start).trim());return list}
    const owned=new Set(document.querySelectorAll('.workout-completion-share-card,.workout-completion-share-card *'))
    const touchesOwned=(selector:string)=>Array.from(document.querySelectorAll(selector)).some(node=>owned.has(node))
    const changed:{rule:CSSStyleRule;selectors:string[];selected:string[]}[]=[],foundOwners=new Set<string>(),ownerDefinitions=new Set<string>()
    const visit=(rules:CSSRuleList)=>{for(const rule of Array.from(rules)){if(rule instanceof CSSStyleRule){const selectors=branches(rule.selectorText);for(const selector of selectors)if(ownerSelectors.has(normalize(selector))){ownerDefinitions.add(normalize(selector));if(touchesOwned(selector))foundOwners.add(normalize(selector))};const selected=selectors.filter(selector=>common.has(strip(selector))&&Array.from(rule.style).some(property=>visual.test(property)));if(selected.length)changed.push({rule,selectors,selected})}if('cssRules'in rule)visit((rule as CSSGroupingRule).cssRules)}}
    for(const sheet of Array.from(document.styleSheets))visit(sheet.cssRules)
    const selected=changed.flatMap(item=>item.selected),matches=selected.filter(touchesOwned)
    const legacyMatches=selected.every(selector=>{const old=Array.from(document.querySelectorAll(strip(selector))).filter(node=>owned.has(node)),current=Array.from(document.querySelectorAll(selector)).filter(node=>owned.has(node));return old.length===current.length&&old.every((node,i)=>node===current[i])})
    const probe=document.createElement('style');probe.textContent=matches.map(selector=>selector+'{--mc514-legacy-report-probe:legacy}').join(' ');document.head.append(probe)
    const inherited=Array.from(document.querySelectorAll(selector)).flatMap(node=>[node,...node.querySelectorAll('*')]).filter(node=>getComputedStyle(node).getPropertyValue('--mc514-legacy-report-probe').trim()==='legacy').length;probe.remove()
    const anchorStyle=document.createElement('style');anchorStyle.textContent='.content{overflow-anchor:none!important}';document.head.append(anchorStyle)
    const scroll=Array.from(document.querySelectorAll<HTMLElement>('*')).map(node=>({node,x:node.scrollLeft,y:node.scrollTop}))
    const restore:{rule:CSSStyleRule;style:CSSStyleDeclaration;selector:string;text:string}[]=[],clones:{parent:CSSStyleSheet|CSSGroupingRule;rule:CSSRule}[]=[]
    const ownedFilter='.workout-completion-share-card,.workout-completion-share-card *'
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
  },{families:reportFamilies,guards:reportMigrationGuards,owners:reportOwners,selector:reportSelector})
  const result=await ablation.evaluate(value=>({rules:value.rules,families:value.families,matches:value.matches,inherited:value.inherited,legacyMatches:value.legacyMatches,selectedPositiveOwners:value.selectedPositiveOwners,owners:value.owners,ownerDefinitions:value.ownerDefinitions,classifierGuardChecks:value.classifierGuardChecks,classifierOwnerChecks:value.classifierOwnerChecks}))
  expect(result.classifierGuardChecks).toEqual({known:true,unknownRetained:true})
  expect(result.selectedPositiveOwners).toEqual([])
  expect(result.classifierOwnerChecks).toHaveLength(9)
  expect(result.classifierOwnerChecks.every(check=>check.retained&&!check.legacy)).toBe(true)
  await settleCompletionPaint(page,reportSelector)
  const after=await capture()
  const restoration=await ablation.evaluate(async({restore,clones,scroll})=>{
    for(const saved of restore)saved.rule.selectorText=saved.selector
    for(const {parent,rule} of clones){const index=Array.from(parent.cssRules).indexOf(rule);if(index<0)throw Error('Neutral report clone missing');parent.deleteRule(index)}
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
    for(const {node,x,y} of scroll){node.scrollLeft=x;node.scrollTop=y}
    return restore.every(saved=>saved.rule.style===saved.style&&saved.rule.selectorText===saved.selector&&saved.rule.style.cssText===saved.text)
  })
  await settleCompletionPaint(page,reportSelector)
  await ablation.evaluate(({anchorStyle})=>anchorStyle.remove());await ablation.dispose()
  await settleCompletionPaint(page,reportSelector)
  expect(restoration).toBe(true);expect(await cssom()).toEqual(cssomBefore);expect(await state()).toEqual(stateBefore);expect(await capture()).toEqual(before)
  expect(await page.locator('.workout-completion-share-card').evaluate(element=>getComputedStyle(element).backgroundColor)).toBe(backdrop)
  expect(after).toHaveLength(before.length)
  const differences=before.flatMap((a,i)=>{const b=after[i]!,changes=Object.fromEntries(Object.keys(a.style).filter(property=>a.style[property]!==b.style[property]).map(property=>[property,[a.style[property],b.style[property]]]));return Object.keys(changes).length||JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[{tag:a.tag,class:a.class,changes,rect:JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[a.rect,b.rect]:undefined}]:[]})
  return {before,backdrop,frameBackground,...result,restoration,cssomRoundTrip:true,focusScrollAnchorRoundTrip:true,differences,stateBefore}
}

export function assertCompletionReportOwnership(result: Awaited<ReturnType<typeof probeCompletionReportSkin>>, lime: boolean) {
  expect([...result.families].sort()).toEqual([...reportFamilies].sort())
  if(lime){
    expect(result.matches).toEqual([]);expect(result.inherited).toBe(0);expect(result.differences).toEqual([])
    expect(result.ownerDefinitions).toEqual([...reportOwners].sort());expect(result.owners.length).toBeGreaterThan(0)
  }else{
    expect(result.owners).toEqual([]);expect(result.legacyMatches).toBe(true)
    expect(result.matches.length).toBeGreaterThan(0);expect(result.inherited).toBeGreaterThan(0);expect(result.differences.length).toBeGreaterThan(0)
  }
}

// Own only the accepted client result's hero/metrics paint, including art fallback.
export function limeCompletionReportSkinCases(){
  const samples=[
    {theme:'light',width:390,lime:true,state:'full',pilot:false},
    {theme:'dark',width:430,lime:true,state:'fallback',pilot:true},
    {theme:'light',width:375,lime:true,state:'partial',pilot:false},
    {theme:'dark',width:1440,lime:true,state:'full',pilot:false},
    {theme:'light',width:390,lime:true,state:'empty',pilot:true},
    {theme:'dark',width:390,lime:false,state:'full',pilot:false},
  ]
  for(const sample of samples)test('Done Lime completion report skin ownership '+Object.values(sample).join('-'),async({page,browserName},info)=>{
    const errors:string[]=[],requests:string[]=[],responses:string[]=[],consoleErrors:string[]=[]
    page.on('pageerror',error=>errors.push(error.message))
    page.on('requestfailed',request=>requests.push(new URL(request.url()).pathname))
    page.on('response',response=>{if(response.status()>=400)responses.push(String(response.status())+' '+new URL(response.url()).pathname)})
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text()+' '+message.location().url)})
    const id=sample.pilot?'c11e0000-6010-4000-8000-000000000001':clientId
    await page.setViewportSize({width:sample.width,height:844})
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00Z'))
    await page.addInitScript(({id,sample,workoutId})=>{
      localStorage.setItem('fit.appTheme',sample.theme)
      localStorage.setItem('fit.clientLime.theme.'+id,sample.theme)
      localStorage.setItem('fit.liveExerciseAnimation.'+id,'false')
      localStorage.setItem('fit.completion-celebrations.v1:'+id,JSON.stringify({entries:{[workoutId]:{phrase:1,icon:'star'}},recent:[1],lastIcon:'star'}))
    },{id,sample,workoutId})
    const source=restTimerWorkout()
    source.startedAt='2026-09-24T10:00:00Z';source.activeCaloriesKcal=210
    source.exercises[0]!.sets.forEach((set,index)=>{
      if(sample.state!=='empty'&&(sample.state!=='partial'||index===0))Object.assign(set,{fact:{weightKg:20,reps:10},confirmedAt:'2026-09-24T11:00:00Z'})
    })
    const backend=await mockPilot(page,{role:'client',profileId:id,fitLime:sample.lime,clientLime:sample.lime,workouts:[source]})
    await page.route('**/v1/push-notifications/status',route=>route.fulfill({json:{status:{subscribed:false,preferences:{workout_reminder:true,workout_scheduled:true,chat_message:true}}}}))
    await page.route('**/v1/exercise-media/sign-batch',route=>{
      const {paths}=route.request().postDataJSON() as {paths:string[]}
      return route.fulfill({json:{signedUrls:paths.map(path=>({path,signedUrl:new URL('/exercises/vital/air-bike-sprint.jpg',page.url()).href}))}})
    })
    // A fulfilled invalid image exercises the component's real onError fallback,
    // without an unrelated HTTP failure or any changes to shipped artwork.
    if(sample.state==='fallback')await page.route('**/assets/star-*.webp',route=>route.fulfill({status:200,contentType:'image/webp',body:''}))
    await page.goto('/workouts/'+workoutId+'/live')
    await page.getByRole('button',{name:'Завершить тренировку',exact:true}).click()
    await expect(page.locator('.workout-completion-report,.finish-confirm')).toBeVisible()
    if(await page.locator('.finish-confirm').isVisible())await page.locator('.finish-confirm button.primary').click()
    await expect(page.getByRole('region',{name:'Тренировка завершена',exact:true})).toBeVisible()
    const frame=page.locator('.phone-frame')
    if(sample.lime)await expect(frame).toHaveClass(/fit-client-lime/)
    else await expect(frame).not.toHaveClass(/fit-client-lime|fit-lime-shell/)
    if(sample.pilot)await expect(frame).toHaveClass(/client-screen-reference/)
    const report=page.locator('.workout-completion-report')
    if(sample.state==='empty'||sample.state==='partial')await expect(report).toHaveClass(new RegExp('is-'+sample.state))
    else await expect(report).not.toHaveClass(/is-empty|is-partial/)
    const card=page.locator('.workout-completion-share-card')
    if(sample.state==='empty')await expect(card.locator('.workout-completion-report-facts')).toHaveCount(0)
    else await expect(card.locator('.workout-completion-report-facts > div')).toHaveCount(2)
    if(sample.state==='fallback'){
      await expect(card.locator('.workout-completion-report-art > svg')).toBeVisible()
      await expect(card.locator('.workout-completion-report-art img')).toHaveCount(0)
    }else if(sample.state==='full')await card.locator('.workout-completion-report-art img').evaluate(async image=>{await(image as HTMLImageElement).decode()})
    const facts=JSON.stringify(backend.getWorkouts().find(workout=>workout.id===workoutId)!.exercises)
    const durationBefore=backend.getWorkouts().find(workout=>workout.id===workoutId)!.actualDurationSec
    const commands:unknown[]=[]
    page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/duration'))commands.push(request.postDataJSON() as unknown)})
    const trigger=card.getByRole('button',{name:'Изменить длительность',exact:true})
    await page.evaluate(()=>document.fonts.ready)
    const rawScroll=()=>page.locator('.content').evaluate(node=>({x:node.scrollLeft,y:node.scrollTop,height:node.scrollHeight,client:node.clientHeight}))
    const initialScroll=await rawScroll()
    await trigger.click()
    const dialog=page.getByRole('dialog',{name:'Длительность тренировки',exact:true})
    const input=dialog.getByRole('textbox')
    await expect(input).toHaveValue('120')
    await expect(input).toBeFocused()
    await page.keyboard.press(browserName==='webkit'?'Alt+Tab':'Tab')
    await expect(dialog.getByRole('button',{name:'Отмена',exact:true})).toBeFocused()
    await page.keyboard.press(browserName==='webkit'?'Alt+Shift+Tab':'Shift+Tab')
    await expect(input).toBeFocused()
    await input.fill('50,5')
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await expect(input).toHaveValue('120')
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await page.evaluate(()=>document.fonts.ready)
    const result={state:'card',...await probeCompletionReportSkin(page,info.outputPath('completion-report-card.png'))}
    expect(commands).toEqual([])
    expect(JSON.stringify(backend.getWorkouts().find(workout=>workout.id===workoutId)!.exercises)).toBe(facts)
    expect(backend.getWorkouts().find(workout=>workout.id===workoutId)!.actualDurationSec).toBe(durationBefore)
    const finalScroll=await rawScroll()
    const rootClasses=await frame.getAttribute('class')
    await writeFile(info.outputPath('completion-report-skin.json'),JSON.stringify({sample,rootClasses,result,initialScroll,finalScroll,commands,errors,requests,responses,consoleErrors},null,2))
    expect(errors).toEqual([]);expect(requests).toEqual([]);expect(responses).toEqual([]);expect(consoleErrors).toEqual([])
    assertCompletionReportOwnership(result,sample.lime)
  })
}

// A done-detail duration test does not render the trainer's justCompleted card.
// Exercise its actual post-Live consumer separately, without migrating its skin.
export function limeTrainerCompletionNonConsumerCases(){
  test('Done Lime trainer completion nonconsumer',async({page},info)=>{
    const errors:string[]=[],requests:string[]=[],responses:string[]=[],consoleErrors:string[]=[]
    page.on('pageerror',error=>errors.push(error.message))
    page.on('requestfailed',request=>requests.push(new URL(request.url()).pathname))
    page.on('response',response=>{if(response.status()>=400)responses.push(String(response.status())+' '+new URL(response.url()).pathname)})
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text()+' '+message.location().url)})
    await page.setViewportSize({width:390,height:844})
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00Z'))
    await page.addInitScript(()=>localStorage.setItem('fit.appTheme','dark'))
    const source=restTimerWorkout();source.startedAt='2026-09-24T10:00:00Z';source.trainerId=trainerId;source.createdBy=trainerId
    for(const set of source.exercises[0]!.sets)Object.assign(set,{fact:{weightKg:20,reps:10},confirmedAt:'2026-09-24T11:00:00Z'})
    const facts=JSON.stringify(source.exercises)
    const backend=await mockPilot(page,{role:'trainer',profileId:trainerId,fitLime:true,clientLime:false,workouts:[source]})
    await page.route('**/v1/push-notifications/status',route=>route.fulfill({json:{status:{subscribed:false,preferences:{workout_reminder:true,workout_scheduled:true,chat_message:true}}}}))
    await page.route('**/v1/exercise-media/sign-batch',route=>{
      const {paths}=route.request().postDataJSON() as {paths:string[]}
      return route.fulfill({json:{signedUrls:paths.map(path=>({path,signedUrl:new URL('/exercises/vital/air-bike-sprint.jpg',page.url()).href}))}})
    })
    let personalRecordCalls=0
    await page.route('**/v1/workouts/'+workoutId+'/personal-records',route=>{personalRecordCalls++;return route.fulfill({json:{records:[]}})})
    await page.goto('/workouts/'+workoutId+'/live')
    await page.getByRole('button',{name:'Завершить тренировку',exact:true}).click()
    const attendance=page.getByRole('dialog',{name:'Отметить проведённой',exact:true})
    await expect(attendance).toBeVisible()
    await attendance.getByRole('button',{name:'Подтвердить проведение',exact:true}).click()
    const card=page.getByRole('region',{name:'Тренировка завершена',exact:true})
    await expect(card).toHaveClass(/workout-completion/)
    await expect(card).toContainText('Подтверждено 2 подхода')
    await expect(page.locator('.workout-completion-report,.workout-completion-share-card')).toHaveCount(0)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-client-lime|theme-light/)
    await expect.poll(()=>personalRecordCalls).toBe(1)
    await expect(card.getByRole('link',{name:'Вернуться к клиенту',exact:true})).toHaveAttribute('href','/clients/'+clientId)
    await settleCompletionPaint(page,'.workout-completion')
    const before=await card.evaluate(root=>[root,...root.querySelectorAll('*')].map(node=>{
      const css=getComputedStyle(node),rect=node.getBoundingClientRect()
      const properties=['color','background-color','font-family','font-size','font-weight','font-variant-numeric','text-transform','line-height','letter-spacing','display','position','width','height','gap','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','border-top-width','border-top-color','border-top-style','border-right-width','border-right-color','border-right-style','border-bottom-width','border-bottom-color','border-bottom-style','border-left-width','border-left-color','border-left-style','border-radius','box-shadow','outline-color','outline-width','outline-style','outline-offset']
      return{tag:node.tagName,class:node.getAttribute('class')||'',style:Object.fromEntries(properties.map(p=>[p,css.getPropertyValue(p)])),rect:[rect.x,rect.y,rect.width,rect.height].map(v=>Math.round(v*100)/100)}
    }))
    expect(before.length).toBeGreaterThan(0)
    const matches=await card.evaluate((root,families)=>families.filter(selector=>Array.from(document.querySelectorAll(selector)).some(node=>node===root||root.contains(node))),reportFamilies)
    expect(matches).toEqual([])
    expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(facts)
    expect(backend.getWorkouts()[0]!.status).toBe('done')
    const frameBackground=await page.locator('.phone-frame').evaluate(node=>getComputedStyle(node).backgroundColor),rootClasses=await page.locator('.phone-frame').getAttribute('class')
    await page.screenshot({path:info.outputPath('trainer-completion-nonconsumer.png'),animations:'disabled'})
    await writeFile(info.outputPath('trainer-completion-nonconsumer.json'),JSON.stringify({sample:{role:'trainer',theme:'dark',width:390},before,matches,personalRecordCalls,rootClasses,frameBackground,factsUnchanged:true,errors,requests,responses,consoleErrors},null,2))
    expect(errors).toEqual([]);expect(requests).toEqual([]);expect(responses).toEqual([]);expect(consoleErrors).toEqual([])
  })
}
