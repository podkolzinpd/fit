import {libraryMigrationGuard} from './lime-library-skin.contract'
import {editorMigrationGuard} from './lime-editor-skin.contract'
import {resultMigrationGuard} from './lime-result-remainder-skin.contract'
import {captureLimeErrorSemantics,expectLimeErrorSemantics} from './lime-error-semantics'
import {test,expect,type Page} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {mockPilot,restTimerWorkout,workoutId,clientId} from './fit-lime-fixtures'
import {settleCompletionPaint} from './lime-live-completion-skin.probe'

type ShareWindow=Window & {shareCalls?:number;shareRelease?:()=>void;shareFiles?:string[]}
const shareSelector='.workout-share-overlay'
const shareFamilies=[".sheet-overlay", ".ui-identity .sheet-overlay", ".workout-detail-history-identity .workout-share-overlay", ".workout-detail-history-identity .workout-share-sheet", ".workout-detail-history-identity .workout-share-sheet h2", ".workout-detail-history-identity .workout-share-sheet .icon-button", ".workout-detail-history-identity .workout-share-sheet-intro", ".workout-detail-history-identity .workout-share-options > button", ".workout-detail-history-identity .workout-share-options > button.is-selected", ".workout-detail-history-identity .workout-share-options > button:disabled", ".workout-detail-history-identity .workout-share-options strong", ".workout-detail-history-identity .workout-share-options small", ".workout-detail-history-identity .workout-share-options b", ".workout-detail-history-identity .workout-share-options > button.is-selected b", ".workout-detail-history-identity button", ".workout-detail-history-identity button.primary", ".workout-detail-history-identity .workout-cta[data-variant='primary']", ".workout-detail-history-identity button.secondary", ".workout-detail-history-identity button:disabled"]
const shareMigrationGuards=[
  libraryMigrationGuard,
  editorMigrationGuard,
  resultMigrationGuard,
  ':where(:not(.fit-client-lime :is(.workout-completion-highlight, .workout-completion-missing, .workout-completion-muscles-line), .fit-client-lime :is(.workout-completion-highlight, .workout-completion-missing, .workout-completion-muscles-line) *))',
  ':where(:not(.fit-client-lime .workout-share-overlay, .fit-client-lime .workout-share-overlay *))',
  ':where(:not(.fit-lime-shell.workout-detail-history-identity :is(.workout-actual-duration,.workout-duration-dialog) button))',
  ':where(:not(.fit-lime-shell.workout-detail-history-identity .workout-duration-dialog .workout-cta))',
]
const shareOwnerPrefix='.workout-detail-history-identity:where(.fit-client-lime) '
const shareOwners=[
  ...['.workout-share-sheet','.workout-share-sheet h2','.workout-share-sheet .icon-button','.workout-share-sheet-intro',
    '.workout-share-options > button:disabled','.workout-share-options strong','.workout-share-options small',
    '.workout-share-options b','.workout-share-options > button.is-selected b',
  ].map(selector=>shareOwnerPrefix+selector),
  shareOwnerPrefix+'button:where(.workout-share-overlay button)',
]

// Share-only ownership: keep CSSRule/style objects, optimizer branches and
// neutral sheet layout intact. Raw user paths stay outside this diagnostic.
export async function probeCompletionShareSkin(page: Page, screenshot?: string) {
  const capture = () => page.locator('.phone-frame').evaluate((root, selector) => {
    const properties = ['display','position','color','background-color','font-family','font-size','font-weight','font-variant-numeric','letter-spacing','line-height','width','height','min-width','min-height','max-height','gap','grid-template-columns','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','border-top-width','border-top-color','border-top-style','border-right-width','border-right-color','border-right-style','border-bottom-width','border-bottom-color','border-bottom-style','border-left-width','border-left-color','border-left-style','border-radius','box-shadow','outline-color','outline-width','outline-style','outline-offset','overflow-x','overflow-y','scroll-snap-type','touch-action','animation-name','animation-duration','transition-property','transition-duration','opacity','align-items','justify-content']
    const targets = Array.from(root.querySelectorAll(selector)), nodes = [...new Set(targets.flatMap(node => [node,...node.querySelectorAll('*')]))]
    return nodes.map(node => { const css=getComputedStyle(node),rect=node.getBoundingClientRect();return {tag:node.tagName,class:node.getAttribute('class')||'',style:Object.fromEntries(properties.map(property=>[property,css.getPropertyValue(property)])),rect:[rect.x,rect.y,rect.width,rect.height].map(value=>Math.round(value*100)/100)} })
  }, shareSelector)
  const cssom = () => page.evaluate(() => Array.from(document.styleSheets).map(sheet => Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n')))
  const state = () => page.evaluate(() => {
    const active=document.activeElement
    const elements=[document.scrollingElement,...document.querySelectorAll('.content,.workout-share-overlay')].filter((node):node is HTMLElement=>node instanceof HTMLElement)
    return {focus:active?{tag:active.tagName,id:active.id,class:active.className,role:active.getAttribute('role'),text:active.textContent}:null,scroll:elements.map(node=>({tag:node.tagName,class:node.className,x:node.scrollLeft,y:node.scrollTop,height:node.scrollHeight,client:node.clientHeight})),anchor:Array.from(document.querySelectorAll<HTMLElement>('.content')).map(node=>({style:node.getAttribute('style'),value:node.style.getPropertyValue('overflow-anchor'),priority:node.style.getPropertyPriority('overflow-anchor'),computed:getComputedStyle(node).overflowAnchor}))}
  })
  await settleCompletionPaint(page,shareSelector)
  const before=await capture();expect(before.length).toBeGreaterThan(0)
  const cssomBefore=await cssom(),stateBefore=await state()
  const backdrop=await page.locator('.workout-share-overlay').evaluate(element=>getComputedStyle(element).backgroundColor)
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
    const branches=(text:string)=>{const list:string[]=[];let depth=0,quote='',start=0;for(let i=0;i<text.length;i++){const char=text[i]!;if(quote){if(char===quote&&text.charCodeAt(i-1)!==92)quote='';continue}if(char==='"'||char==="'")quote=char;else if(char==='('||char==='[')depth++;else if(char===')'||char===']')depth--;else if(char===','&&!depth){list.push(text.slice(start,i).trim());start=i+1}}list.push(text.slice(start).trim());return list}
    const owned=new Set(document.querySelectorAll('.workout-share-overlay,.workout-share-overlay *'))
    const touchesOwned=(selector:string)=>Array.from(document.querySelectorAll(selector)).some(node=>owned.has(node))
    const changed:{rule:CSSStyleRule;selectors:string[];selected:string[]}[]=[],foundOwners=new Set<string>(),ownerDefinitions=new Set<string>()
    const visit=(rules:CSSRuleList)=>{for(const rule of Array.from(rules)){if(rule instanceof CSSStyleRule){const selectors=branches(rule.selectorText);for(const selector of selectors)if(ownerSelectors.has(normalize(selector))){ownerDefinitions.add(normalize(selector));if(touchesOwned(selector))foundOwners.add(normalize(selector))};const selected=selectors.filter(selector=>common.has(strip(selector))&&Array.from(rule.style).some(property=>visual.test(property)));if(selected.length)changed.push({rule,selectors,selected})}if('cssRules'in rule)visit((rule as CSSGroupingRule).cssRules)}}
    for(const sheet of Array.from(document.styleSheets))visit(sheet.cssRules)
    const selected=changed.flatMap(item=>item.selected),matches=selected.filter(touchesOwned)
    const legacyMatches=selected.every(selector=>{const old=Array.from(document.querySelectorAll(strip(selector))).filter(node=>owned.has(node)),current=Array.from(document.querySelectorAll(selector)).filter(node=>owned.has(node));return old.length===current.length&&old.every((node,i)=>node===current[i])})
    const probe=document.createElement('style');probe.textContent=matches.map(selector=>selector+'{--mc512-legacy-share-probe:legacy}').join(' ');document.head.append(probe)
    const inherited=Array.from(document.querySelectorAll(selector)).flatMap(node=>[node,...node.querySelectorAll('*')]).filter(node=>getComputedStyle(node).getPropertyValue('--mc512-legacy-share-probe').trim()==='legacy').length;probe.remove()
    const anchorStyle=document.createElement('style');anchorStyle.textContent='.content{overflow-anchor:none!important}';document.head.append(anchorStyle)
    const scroll=Array.from(document.querySelectorAll<HTMLElement>('*')).map(node=>({node,x:node.scrollLeft,y:node.scrollTop}))
    const restore:{rule:CSSStyleRule;selector:string;text:string}[]=[],clones:{parent:CSSStyleSheet|CSSGroupingRule;rule:CSSRule}[]=[]
    const ownedFilter='.workout-share-overlay,.workout-share-overlay *'
    for(const {rule,selectors,selected} of changed){
      const applicable=selected.filter(touchesOwned)
      if(!applicable.length)continue
      const originalSelector=rule.selectorText,text=rule.style.cssText
      // Broad detail-button branches keep their paint on every unrelated node.
      const retained=selectors.map(branch=>applicable.includes(branch)?branch+':where(:not('+ownedFilter+'))':branch)
      rule.selectorText=retained.join(', ')
      const neutral=Array.from(rule.style).filter(property=>!visual.test(property)).map(property=>property+':'+rule.style.getPropertyValue(property)+(rule.style.getPropertyPriority(property)?'!important':'')).join(';')
      if(neutral){const parent=(rule.parentRule??rule.parentStyleSheet) as CSSGroupingRule,index=Array.from(parent.cssRules).indexOf(rule);parent.insertRule(applicable.map(branch=>branch+':where('+ownedFilter+')').join(', ')+'{'+neutral+'}',index+1);clones.push({parent,rule:parent.cssRules[index+1]!})}
      restore.push({rule,selector:originalSelector,text})
    }
    return {rules:changed.length,families:[...new Set(selected.map(strip))],matches,inherited,legacyMatches,selectedPositiveOwners:selected.filter(selector=>strip(selector).includes(':where(')),owners:[...foundOwners].sort(),ownerDefinitions:[...ownerDefinitions].sort(),classifierOwnerChecks:[...ownerSelectors].map(selector=>({selector,retained:strip(selector)===selector,legacy:common.has(strip(selector))})),restore,clones,scroll,anchorStyle}
  },{families:shareFamilies,guards:shareMigrationGuards,owners:shareOwners,selector:shareSelector})
  const result=await ablation.evaluate(value=>({rules:value.rules,families:value.families,matches:value.matches,inherited:value.inherited,legacyMatches:value.legacyMatches,selectedPositiveOwners:value.selectedPositiveOwners,owners:value.owners,ownerDefinitions:value.ownerDefinitions,classifierOwnerChecks:value.classifierOwnerChecks}))
  expect(result.selectedPositiveOwners).toEqual([])
  expect(result.classifierOwnerChecks).toHaveLength(10)
  expect(result.classifierOwnerChecks.every(check=>check.retained&&!check.legacy)).toBe(true)
  await settleCompletionPaint(page,shareSelector)
  const after=await capture()
  const restoration=await ablation.evaluate(async({restore,clones,scroll})=>{
    for(const saved of restore)saved.rule.selectorText=saved.selector
    for(const {parent,rule} of clones){const index=Array.from(parent.cssRules).indexOf(rule);if(index<0)throw Error('Neutral share clone missing');parent.deleteRule(index)}
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
    for(const {node,x,y} of scroll){node.scrollLeft=x;node.scrollTop=y}
    return restore.every(saved=>saved.rule.selectorText===saved.selector&&saved.rule.style.cssText===saved.text)
  })
  await settleCompletionPaint(page,shareSelector)
  await ablation.evaluate(({anchorStyle})=>anchorStyle.remove());await ablation.dispose()
  await settleCompletionPaint(page,shareSelector)
  expect(restoration).toBe(true);expect(await cssom()).toEqual(cssomBefore);expect(await state()).toEqual(stateBefore);expect(await capture()).toEqual(before)
  expect(await page.locator('.workout-share-overlay').evaluate(element=>getComputedStyle(element).backgroundColor)).toBe(backdrop)
  expect(after).toHaveLength(before.length)
  const differences=before.flatMap((a,i)=>{const b=after[i]!,changes=Object.fromEntries(Object.keys(a.style).filter(property=>a.style[property]!==b.style[property]).map(property=>[property,[a.style[property],b.style[property]]]));return Object.keys(changes).length||JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[{tag:a.tag,class:a.class,changes,rect:JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[a.rect,b.rect]:undefined}]:[]})
  return {before,backdrop,frameBackground,...result,restoration,cssomRoundTrip:true,focusScrollAnchorRoundTrip:true,differences,stateBefore}
}

export function assertCompletionShareOwnership(result: Awaited<ReturnType<typeof probeCompletionShareSkin>>, lime: boolean) {
  expect([...result.families].sort()).toEqual([...shareFamilies].sort())
  if(lime){
    expect(result.matches).toEqual([]);expect(result.inherited).toBe(0);expect(result.differences).toEqual([])
    expect(result.ownerDefinitions).toEqual([...shareOwners].sort());expect(result.owners.length).toBeGreaterThan(0)
  }else{
    expect(result.owners).toEqual([]);expect(result.legacyMatches).toBe(true)
    expect(result.matches.length).toBeGreaterThan(0);expect(result.inherited).toBeGreaterThan(0);expect(result.differences.length).toBeGreaterThan(0)
  }
}

// The completion report is client-only; trainer done detail has no share dialog.
export function limeCompletionShareSkinCases(){
  const samples=[
    {theme:'light',width:390,lime:true,empty:false},
    {theme:'dark',width:430,lime:true,empty:false},
    {theme:'dark',width:1440,lime:true,empty:false},
    {theme:'light',width:375,lime:true,empty:true},
    {theme:'dark',width:390,lime:false,empty:false},
  ]
  for(const sample of samples) test('Done Lime completion share skin ownership '+Object.values(sample).join('-'),async({page,browserName},info)=>{
    const errors:string[]=[],requests:string[]=[],responses:string[]=[],consoleErrors:string[]=[]
    page.on('pageerror',e=>errors.push(e.message))
    page.on('requestfailed',r=>requests.push(new URL(r.url()).pathname))
    page.on('response',r=>{if(r.status()>=400) responses.push(String(r.status())+' '+new URL(r.url()).pathname)})
    page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text()+' '+m.location().url)})
    await page.setViewportSize({width:sample.width,height:844})
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.clock.setFixedTime(new Date('2026-09-24T12:00:00Z'))
    await page.addInitScript(({id,sample,workoutId})=>{
      localStorage.setItem('fit.appTheme',sample.theme)
      localStorage.setItem('fit.clientLime.theme.'+id,sample.theme)
      localStorage.setItem('fit.liveExerciseAnimation.'+id,'false')
      localStorage.setItem('fit.completion-celebrations.v1:'+id,JSON.stringify({entries:{[workoutId]:{phrase:1,icon:'star'}},recent:[1],lastIcon:'star'}))
      const audit=window as ShareWindow
      audit.shareCalls=0;audit.shareFiles=[]
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('fixture clipboard denied'))}})
      const exec=document.execCommand.bind(document)
      document.execCommand=(command:string,showUI?:boolean,value?:string)=>command==='copy'?false:exec(command,showUI,value)
      Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true})
      Object.defineProperty(navigator,'share',{configurable:true,value:(data:ShareData)=>{
        audit.shareCalls!++
        audit.shareFiles!.push(data.files?.[0]?.name??'text')
        if(audit.shareCalls===1)return new Promise<void>((_resolve,reject)=>{audit.shareRelease=()=>reject(new Error('fixture share failed'))})
        return Promise.resolve()
      }})
    },{id:clientId,sample,workoutId})
    const source=restTimerWorkout()
    source.startedAt='2026-09-24T10:00:00Z'
    for(const set of source.exercises[0]!.sets) if(!sample.empty) Object.assign(set,{fact:{weightKg:20,reps:10},confirmedAt:'2026-09-24T11:00:00Z'})
    const previous=structuredClone(source)
    previous.id='10000000-0000-4000-8000-000000000084';previous.status='done';previous.workoutDate='2026-09-20';previous.completedAt='2026-09-20T11:00:00Z'
    for(const set of previous.exercises[0]!.sets)Object.assign(set,{fact:{weightKg:10,reps:10},confirmedAt:'2026-09-20T11:00:00Z'})
    const backend=await mockPilot(page,{role:'client',profileId:clientId,fitLime:sample.lime,clientLime:sample.lime,workouts:[source,previous]})
    await page.route('**/v1/push-notifications/status',r=>r.fulfill({json:{status:{subscribed:false,preferences:{workout_reminder:true,workout_scheduled:true,chat_message:true}}}}))
    await page.route('**/v1/exercise-media/sign-batch',r=>{
      const {paths}=r.request().postDataJSON() as {paths:string[]}
      return r.fulfill({json:{signedUrls:paths.map(path=>({path,signedUrl:new URL('/exercises/vital/air-bike-sprint.jpg',page.url()).href}))}})
    })
    await page.goto('/workouts/'+workoutId+'/live')
    await page.getByRole('button',{name:'Завершить тренировку',exact:true}).click()
    await expect(page.locator('.workout-completion-report,.finish-confirm')).toBeVisible()
    if(await page.locator('.finish-confirm').isVisible())await page.locator('.finish-confirm button.primary').click()
    await expect(page.getByRole('region',{name:'Тренировка завершена',exact:true})).toBeVisible()
    const facts=JSON.stringify(backend.getWorkouts().find(w=>w.id===workoutId)!.exercises)
    const trigger=page.getByRole('button',{name:'Поделиться',exact:true})
    await expect(trigger).toBeEnabled()
    await page.evaluate(()=>document.fonts.ready)
    await page.locator('.workout-completion-report').evaluate(async root=>{
      await Promise.all(Array.from(root.querySelectorAll('img')).map(image=>image.decode()))
    })
    await trigger.scrollIntoViewIfNeeded()
    await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))))
    const rawScroll=()=>page.evaluate(()=>({content:document.querySelector('.phone-frame .content')!.scrollTop,document:document.scrollingElement!.scrollTop,activeClass:document.activeElement?.getAttribute('class')}))
    const rawBefore=await rawScroll()
    await trigger.click()
    const dialog=page.getByRole('dialog',{name:'Чем поделиться',exact:true})
    await expect(dialog).toBeVisible()
    if(sample.lime)await expect(page.locator('.phone-frame')).toHaveClass(/fit-client-lime/)
    else await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-lime-shell|fit-client-lime/)
    const close=dialog.getByRole('button',{name:'Закрыть',exact:true})
    const rawOpened=await rawScroll()
    await close.click()
    await expect(dialog).not.toBeVisible()
    await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))))
    const rawClosed=await rawScroll()
    await expect(trigger).toBeInViewport()
    await trigger.click()
    await expect(dialog).toBeVisible()
    // This sheet has no natural autofocus contract. Calibrate only keyboard paint.
    const naturalFocus=await page.evaluate(()=>document.activeElement?.getAttribute('class'))
    await close.focus()
    await page.keyboard.press(browserName==='webkit'?'Alt+Tab':'Tab')
    await expect(dialog.getByRole('radio',{name:/^Итог/})).toBeFocused()
    await page.keyboard.press(browserName==='webkit'?'Alt+Shift+Tab':'Shift+Tab')
    await expect(close).toBeFocused()
    await page.evaluate(()=>document.fonts.ready)
    const probe=async(state:string)=>{
      await page.mouse.move(0,0)
      return {state,...await probeCompletionShareSkin(page,state==='pending'?undefined:info.outputPath('completion-share-'+state+'.png'))}
    }
    const states=[await probe('summary')]
    const achievement=dialog.getByRole('radio',{name:/^Достижение/})
    const progress=dialog.getByRole('radio',{name:/^Прогресс/})
    if(sample.empty){await expect(achievement).toBeDisabled();await expect(progress).toBeDisabled()}
    else{
      await expect(achievement).toBeEnabled();await achievement.click();await expect(achievement).toHaveAttribute('aria-checked','true')
      states.push(await probe('achievement'))
      await expect(progress).toBeEnabled();await progress.click();await expect(progress).toHaveAttribute('aria-checked','true')
      states.push(await probe('progress'))
    }
    const submit=dialog.getByRole('button',{name:'Поделиться карточкой',exact:true})
    await submit.click()
    await expect(dialog.getByRole('button',{name:'Готовим PNG…',exact:true})).toBeDisabled()
    await expect(close).toBeDisabled()
    await page.mouse.click(2,2)
    await expect(dialog).toBeVisible()
    await expect.poll(()=>page.evaluate(()=>(window as ShareWindow).shareCalls)).toBe(1)
    states.push(await probe('pending'))
    await page.evaluate(()=>(window as ShareWindow).shareRelease!())
    await expect(dialog.getByRole('alert')).toContainText('Не удалось поделиться')
    await expect(submit).toBeEnabled()
    await expect(submit).toHaveAttribute('aria-busy','false')
    await expect(close).toBeEnabled()
    // WebKit can keep the disabled icon's inherited color for one more paint.
    // Wait for the enabled submit and its actual SVG to agree before CSSOM QA.
    await expect.poll(()=>submit.evaluate(node=>Array.from(node.querySelectorAll('svg,svg *')).every(child=>getComputedStyle(child).color===getComputedStyle(node).color))).toBe(true)
    states.push(await probe('error'))
    const errorSemantics=await captureLimeErrorSemantics(dialog.getByRole('alert'))
    await close.click()
    await expect(dialog).not.toBeVisible()
    const outsideError=page.getByRole('alert').filter({hasText:'Не удалось поделиться'})
    await expect(outsideError).toBeVisible()
    await page.mouse.move(0,0)
    await settleCompletionPaint(page,'.workout-completion-share-status.error')
    const outsideErrorSemantics=await captureLimeErrorSemantics(outsideError)
    await page.screenshot({path:info.outputPath('completion-share-outside-error.png'),animations:'disabled'})
    await trigger.click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    if(!sample.empty)await progress.click()
    await submit.click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('status').filter({hasText:'Карточка передана'})).toBeVisible()
    expect(JSON.stringify(backend.getWorkouts().find(w=>w.id===workoutId)!.exercises)).toBe(facts)
    const share=await page.evaluate(()=>({calls:(window as ShareWindow).shareCalls,files:(window as ShareWindow).shareFiles}))
    expect(share.calls).toBe(2)
    expect(share.files).toEqual(Array(2).fill('fit-workout-'+(sample.empty?'summary':'progress')+'.png'))
    await writeFile(info.outputPath('completion-share-skin.json'),JSON.stringify({sample,errorSemantics,outsideErrorSemantics,naturalFocus,naturalPath:{before:rawBefore,opened:rawOpened,closed:rawClosed},states,share,errors,requests,responses,consoleErrors},null,2))
    expect(errors).toEqual([]);expect(requests).toEqual([]);expect(responses).toEqual([]);expect(consoleErrors).toEqual([])
    if(sample.lime){expectLimeErrorSemantics(errorSemantics);expectLimeErrorSemantics(outsideErrorSemantics)}
    for(const state of states){
      assertCompletionShareOwnership(state,sample.lime)
    }
  })
}
