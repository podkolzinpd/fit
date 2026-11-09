import {captureLimeErrorSemantics,expectLimeErrorSemantics} from './lime-error-semantics'
import { test, expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { mockPilot, restTimerWorkout, workoutId, clientId, trainerId } from './fit-lime-fixtures'
import { settleCompletionPaint } from './lime-live-completion-skin.probe'

const durationSelector = '.workout-actual-duration,.workout-duration-dialog[open],.workout-duration-saved'
const durationFamilies = [
  '.workout-actual-duration span', '.workout-actual-duration strong', '.workout-actual-duration button',
  '.workout-duration-dialog h2', '.workout-duration-dialog .field input', '.workout-duration-dialog small', '.workout-duration-saved',
  '.modal-dialog', '.ui-identity .modal-dialog', '.ui-identity .modal-dialog .actions button',
  '.workout-detail-history-identity button', '.workout-detail-history-identity button.primary',
  ".workout-detail-history-identity .workout-cta[data-variant='primary']", '.workout-detail-history-identity button.secondary',
  '.workout-detail-history-identity button:disabled',
]
const durationOwners = ['.workout-actual-duration span', '.workout-actual-duration strong', '.workout-duration-dialog', '.workout-duration-dialog small', '.workout-actual-duration button']
const detailOwner = ':where(.fit-lime-shell.workout-detail-history-identity) '
// Only these complete, reviewed migration guards may be normalized. Positive
// :where owners and any unrelated/unknown :where filters retain their identity.
const durationMigrationGuards = [
  ':where(:not(.fit-client-lime .workout-share-overlay, .fit-client-lime .workout-share-overlay *))',
  ...['.workout-actual-duration button', '.workout-actual-duration span', '.workout-actual-duration strong',
    '.workout-duration-dialog .actions button', '.workout-duration-dialog .field input', '.workout-duration-dialog .workout-cta',
    '.workout-duration-dialog h2', '.workout-duration-dialog small', '.workout-duration-dialog', '.workout-duration-saved',
    ':is(.workout-actual-duration,.workout-duration-dialog) button',
  ].map(selector => ':where(:not(.fit-lime-shell.workout-detail-history-identity ' + selector + '))'),
  ...['.modal-dialog', '.modal-dialog .actions button'].map(selector => ':where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) ' + selector + '))'),
]

// Duration-only ownership: keep CSSRule/style objects, optimizer branches and
// neutral native layout intact. Raw user paths stay outside this diagnostic.
export async function probeActualDurationSkin(page: Page, screenshot?: string) {
  const capture = () => page.locator('.phone-frame').evaluate((root, selector) => {
    const properties = ['display','position','color','background-color','font-family','font-size','font-weight','line-height','width','height','min-width','min-height','max-height','gap','grid-template-columns','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','border-top-width','border-top-color','border-top-style','border-right-width','border-right-color','border-right-style','border-bottom-width','border-bottom-color','border-bottom-style','border-left-width','border-left-color','border-left-style','border-radius','box-shadow','outline-color','outline-width','outline-style','outline-offset','overflow-x','overflow-y','scroll-snap-type','touch-action','animation-name','animation-duration','transition-property','transition-duration','opacity','align-items','justify-content']
    const targets = Array.from(root.querySelectorAll(selector)), nodes = [...new Set(targets.flatMap(node => [node,...node.querySelectorAll('*')]))]
    return nodes.map(node => { const css=getComputedStyle(node),rect=node.getBoundingClientRect();return {tag:node.tagName,class:node.getAttribute('class')||'',style:Object.fromEntries(properties.map(property=>[property,css.getPropertyValue(property)])),rect:[rect.x,rect.y,rect.width,rect.height].map(value=>Math.round(value*100)/100)} })
  }, durationSelector)
  const cssom = () => page.evaluate(() => Array.from(document.styleSheets).map(sheet => Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n')))
  const state = () => page.evaluate(() => {
    const active=document.activeElement
    const elements=[document.scrollingElement,...document.querySelectorAll('.content,.workout-actual-duration,.workout-duration-dialog,.workout-duration-saved')].filter((node):node is HTMLElement=>node instanceof HTMLElement)
    return {focus:active?{tag:active.tagName,id:active.id,class:active.className,role:active.getAttribute('role'),text:active.textContent}:null,scroll:elements.map(node=>({tag:node.tagName,class:node.className,x:node.scrollLeft,y:node.scrollTop,height:node.scrollHeight,client:node.clientHeight})),anchor:Array.from(document.querySelectorAll<HTMLElement>('.content')).map(node=>({style:node.getAttribute('style'),value:node.style.getPropertyValue('overflow-anchor'),priority:node.style.getPropertyPriority('overflow-anchor'),computed:getComputedStyle(node).overflowAnchor}))}
  })
  await settleCompletionPaint(page,durationSelector)
  const before=await capture();expect(before.length).toBeGreaterThan(0)
  const cssomBefore=await cssom(),stateBefore=await state()
  const backdrop=await page.locator('.workout-duration-dialog').evaluate(element=>getComputedStyle(element,'::backdrop').backgroundColor)
  const frameBackground=await page.locator('.phone-frame').evaluate(element=>getComputedStyle(element).backgroundColor)
  if(screenshot)await page.screenshot({path:screenshot,animations:'disabled'})
  expect(await capture()).toEqual(before)
  const ablation=await page.evaluateHandle(({families,guards,owners,ownerPrefix,selector})=>{
    const normalize=(selector:string)=>selector.replace(/,\s*/g,',').replace(/"/g,"'")
    const common=new Set(families.map(normalize)),allowed=new Set(guards.map(normalize)),ownerSelectors=new Set(owners.map(selector=>normalize(ownerPrefix+selector)))
    const visual=/^(?:color|background(?:-.+)?|border(?:-.+)?|box-shadow|font-(?:family|size|weight)|outline(?:-.+)?|animation)$/
    const strip=(selector:string)=>{
      let cursor=0
      while(true){const start=selector.indexOf(':where(',cursor);if(start<0)break;let end=start+7,depth=1,quote='';while(depth&&end<selector.length){const char=selector[end]!;if(quote){if(char===quote&&selector.charCodeAt(end-1)!==92)quote=''}else if(char==='"'||char==="'")quote=char;else if(char==='(')depth++;else if(char===')')depth--;end++}const block=selector.slice(start,end);if(allowed.has(normalize(block))){selector=selector.slice(0,start)+selector.slice(end);cursor=start}else cursor=end}
      return normalize(selector)
    }
    const branches=(text:string)=>{const list:string[]=[];let depth=0,quote='',start=0;for(let i=0;i<text.length;i++){const char=text[i]!;if(quote){if(char===quote&&text.charCodeAt(i-1)!==92)quote='';continue}if(char==='"'||char==="'")quote=char;else if(char==='('||char==='[')depth++;else if(char===')'||char===']')depth--;else if(char===','&&!depth){list.push(text.slice(start,i).trim());start=i+1}}list.push(text.slice(start).trim());return list}
    const owned=new Set(document.querySelectorAll('.workout-actual-duration,.workout-actual-duration *,.workout-duration-dialog,.workout-duration-dialog *,.workout-duration-saved'))
    const touchesOwned=(selector:string)=>Array.from(document.querySelectorAll(selector)).some(node=>owned.has(node))
    const changed:{rule:CSSStyleRule;selectors:string[];selected:string[]}[]=[],foundOwners=new Set<string>()
    const visit=(rules:CSSRuleList)=>{for(const rule of Array.from(rules)){if(rule instanceof CSSStyleRule){const selectors=branches(rule.selectorText);for(const selector of selectors)if(ownerSelectors.has(normalize(selector))&&touchesOwned(selector))foundOwners.add(normalize(selector));const selected=selectors.filter(selector=>common.has(strip(selector))&&Array.from(rule.style).some(property=>visual.test(property)));if(selected.length)changed.push({rule,selectors,selected})}if('cssRules'in rule)visit((rule as CSSGroupingRule).cssRules)}}
    for(const sheet of Array.from(document.styleSheets))visit(sheet.cssRules)
    const selected=changed.flatMap(item=>item.selected),matches=selected.filter(touchesOwned)
    const legacyMatches=selected.every(selector=>{const old=Array.from(document.querySelectorAll(strip(selector))).filter(node=>owned.has(node)),current=Array.from(document.querySelectorAll(selector)).filter(node=>owned.has(node));return old.length===current.length&&old.every((node,i)=>node===current[i])})
    const probe=document.createElement('style');probe.textContent=matches.map(selector=>selector+'{--mc51-legacy-duration-probe:legacy}').join(' ');document.head.append(probe)
    const inherited=Array.from(document.querySelectorAll(selector)).flatMap(node=>[node,...node.querySelectorAll('*')]).filter(node=>getComputedStyle(node).getPropertyValue('--mc51-legacy-duration-probe').trim()==='legacy').length;probe.remove()
    const anchorStyle=document.createElement('style');anchorStyle.textContent='.content{overflow-anchor:none!important}';document.head.append(anchorStyle)
    const scroll=Array.from(document.querySelectorAll<HTMLElement>('*')).map(node=>({node,x:node.scrollLeft,y:node.scrollTop}))
    const restore:{rule:CSSStyleRule;selector:string;text:string}[]=[],clones:{parent:CSSStyleSheet|CSSGroupingRule;rule:CSSRule}[]=[]
    const ownedFilter=':is(.workout-actual-duration,.workout-duration-dialog,.workout-duration-saved),:is(.workout-actual-duration,.workout-duration-dialog,.workout-duration-saved) *'
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
    return {rules:changed.length,families:[...new Set(selected.map(strip))],matches,inherited,legacyMatches,selectedPositiveOwners:selected.filter(selector=>strip(selector).includes(':where(')),owners:[...foundOwners].sort(),classifierOwnerChecks:[...ownerSelectors].map(selector=>({selector,retained:strip(selector)===selector,legacy:common.has(strip(selector))})),restore,clones,scroll,anchorStyle}
  },{families:durationFamilies,guards:durationMigrationGuards,owners:durationOwners,ownerPrefix:detailOwner,selector:durationSelector})
  const result=await ablation.evaluate(value=>({rules:value.rules,families:value.families,matches:value.matches,inherited:value.inherited,legacyMatches:value.legacyMatches,selectedPositiveOwners:value.selectedPositiveOwners,owners:value.owners,classifierOwnerChecks:value.classifierOwnerChecks}))
  expect(result.selectedPositiveOwners).toEqual([])
  expect(result.classifierOwnerChecks).toHaveLength(5)
  expect(result.classifierOwnerChecks.every(check=>check.retained&&!check.legacy)).toBe(true)
  await settleCompletionPaint(page,durationSelector)
  const after=await capture()
  const restoration=await ablation.evaluate(async({restore,clones,scroll})=>{
    for(const saved of restore)saved.rule.selectorText=saved.selector
    for(const {parent,rule} of clones){const index=Array.from(parent.cssRules).indexOf(rule);if(index<0)throw Error('Neutral duration clone missing');parent.deleteRule(index)}
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
    for(const {node,x,y} of scroll){node.scrollLeft=x;node.scrollTop=y}
    return restore.every(saved=>saved.rule.selectorText===saved.selector&&saved.rule.style.cssText===saved.text)
  })
  await settleCompletionPaint(page,durationSelector)
  await ablation.evaluate(({anchorStyle})=>anchorStyle.remove());await ablation.dispose()
  await settleCompletionPaint(page,durationSelector)
  expect(restoration).toBe(true);expect(await cssom()).toEqual(cssomBefore);expect(await state()).toEqual(stateBefore);expect(await capture()).toEqual(before)
  expect(await page.locator('.workout-duration-dialog').evaluate(element=>getComputedStyle(element,'::backdrop').backgroundColor)).toBe(backdrop)
  expect(after).toHaveLength(before.length)
  const differences=before.flatMap((a,i)=>{const b=after[i]!,changes=Object.fromEntries(Object.keys(a.style).filter(property=>a.style[property]!==b.style[property]).map(property=>[property,[a.style[property],b.style[property]]]));return Object.keys(changes).length||JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[{tag:a.tag,class:a.class,changes,rect:JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[a.rect,b.rect]:undefined}]:[]})
  return {before,backdrop,frameBackground,...result,restoration,cssomRoundTrip:true,focusScrollAnchorRoundTrip:true,differences,stateBefore}
}

export function assertActualDurationOwnership(result: Awaited<ReturnType<typeof probeActualDurationSkin>>, lime: boolean) {
  expect([...result.families].sort()).toEqual([...durationFamilies].sort())
  if(lime){
    expect(result.matches).toEqual([]);expect(result.inherited).toBe(0);expect(result.differences).toEqual([])
    expect(result.owners).toEqual(durationOwners.map(selector=>detailOwner+selector).sort())
  }else{
    expect(result.owners).toEqual([]);expect(result.legacyMatches).toBe(true)
    expect(result.matches.length).toBeGreaterThan(0);expect(result.inherited).toBeGreaterThan(0);expect(result.differences.length).toBeGreaterThan(0)
  }
}

// Scope the real done-detail consumer, never workout-live-reference alone.
export function limeActualDurationSkinCases() {
  const samples = [
    {role:'client' as const,theme:'light',width:390,lime:true},
    {role:'client' as const,theme:'dark',width:430,lime:true},
    {role:'trainer' as const,theme:'dark',width:390,lime:true},
    {role:'trainer' as const,theme:'dark',width:1440,lime:true},
    {role:'client' as const,theme:'light',width:390,lime:false},
    {role:'trainer' as const,theme:'dark',width:390,lime:false},
  ]
  for (const sample of samples) test('Done Lime actual duration skin ownership ' + Object.values(sample).join('-'), async ({page,browserName},info) => {
    const errors:string[]=[],requests:string[]=[],responses:string[]=[],consoleErrors:string[]=[]
    page.on('pageerror',e=>errors.push(e.message))
    page.on('requestfailed',r=>requests.push(new URL(r.url()).pathname))
    page.on('response',r=>{if(r.status()>=400) responses.push(String(r.status())+' '+new URL(r.url()).pathname)})
    page.on('console',m=>{if(m.type()==='error') consoleErrors.push(m.text()+' '+m.location().url)})
    const id=sample.role==='client'?clientId:trainerId
    await page.setViewportSize({width:sample.width,height:sample.width===1440?1000:844})
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.clock.setFixedTime(new Date('2026-11-06T09:00:00Z'))
    await page.addInitScript(({id,sample})=>{
      localStorage.setItem('fit.appTheme',sample.theme)
      localStorage.setItem('fit.clientLime.theme.'+id,sample.theme)
    },{id,sample})
    const source=restTimerWorkout()
    source.status='done';source.startedAt='2026-11-06T08:00:00Z';source.completedAt='2026-11-06T09:00:00Z'
    const backend=await mockPilot(page,{role:sample.role,profileId:id,fitLime:sample.lime,clientLime:sample.role==='client' && sample.lime,workouts:[source]})
    const facts=JSON.stringify(backend.getWorkouts()[0]!.exercises)
    await page.route('**/v1/push-notifications/status',r=>r.fulfill({json:{status:{subscribed:false,preferences:{workout_reminder:true,workout_scheduled:true,chat_message:true}}}}))
    await page.route('**/v1/exercise-media/sign-batch',r=>{
      const {paths}=r.request().postDataJSON() as {paths:string[]}
      return r.fulfill({json:{signedUrls:paths.map(path=>({path,signedUrl:new URL('/exercises/vital/air-bike-sprint.jpg',page.url()).href}))}})
    })
    await page.goto('/workouts/'+workoutId)
    await expect(page.locator('.phone-frame')).toHaveClass(/workout-detail-history-identity/)
    if(sample.lime) await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    else await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-lime-shell/)
    if(sample.role==='client') {
      if(sample.lime) await expect(page.locator('.phone-frame')).toHaveClass(/fit-client-lime/)
      else await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-client-lime/)
    }
    if(sample.role==='trainer') await page.locator('.coach-workout-summary > summary').click()
    const trigger=page.getByRole('button',{name:'Изменить длительность',exact:true})
    const rawScroll=()=>page.locator('.content').evaluate(node=>({y:node.scrollTop,height:node.scrollHeight,clientHeight:node.clientHeight}))
    const initialScroll=await rawScroll()
    await trigger.click()
    const dialog=page.getByRole('dialog',{name:'Длительность тренировки',exact:true})
    const input=dialog.getByRole('textbox')
    await expect(input).toHaveValue('60')
    await expect(input).toBeFocused()
    await input.focus()
    await page.keyboard.press(browserName==='webkit'?'Alt+Tab':'Tab')
    await writeFile(info.outputPath('tab-diagnostic.json'),JSON.stringify(await page.evaluate(()=>({active:document.activeElement?.outerHTML,dialogs:Array.from(document.querySelectorAll('dialog')).map(n=>n.outerHTML)})),null,2))
    await expect(dialog.getByRole('button',{name:'Отмена',exact:true})).toBeFocused()
    await page.keyboard.press(browserName==='webkit'?'Alt+Shift+Tab':'Shift+Tab')
    await expect(input).toBeFocused()
    await input.fill('0')
    await dialog.getByRole('button',{name:'Сохранить',exact:true}).click()
    await expect(dialog.getByRole('alert')).toContainText('Укажите длительность')
    await expect(input).toBeFocused()
    await page.mouse.move(0,0)
    await page.evaluate(()=>document.fonts.ready)
    const probe=async(state:string)=>({state,...await probeActualDurationSkin(page,state==='pending'?undefined:info.outputPath('actual-duration-'+state+'.png'))})
    const invalid=await probe('invalid')
    const invalidSemantics=await captureLimeErrorSemantics(dialog.getByRole('alert'))
    const commands:unknown[]=[]
    let release=()=>{}
    const gate=new Promise<void>(resolve=>{release=resolve})
    await page.route('**/v1/workouts/'+workoutId+'/duration',async route=>{
      commands.push(route.request().postDataJSON() as unknown)
      await gate
      await route.fallback()
    })
    await input.fill('50,5')
    await dialog.getByRole('button',{name:'Сохранить',exact:true}).click()
    await expect(dialog.getByRole('button',{name:'Сохраняем…',exact:true})).toBeDisabled()
    await expect(dialog.getByRole('button',{name:'Отмена',exact:true})).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    // Try a real second tap; a disabled control must not submit the form again.
    const submitBounds=await dialog.getByRole('button',{name:'Сохраняем…',exact:true}).boundingBox()
    expect(submitBounds).not.toBeNull()
    await page.touchscreen.tap(submitBounds!.x+submitBounds!.width/2,submitBounds!.y+submitBounds!.height/2)
    await expect(input).toBeDisabled()
    await expect(dialog.getByRole('button',{name:'Сохраняем…',exact:true})).toBeDisabled()
    await expect(dialog.getByRole('button',{name:'Отмена',exact:true})).toBeDisabled()
    await expect.poll(()=>commands).toEqual([{actualDurationSec:3030,expectedVersion:source.version}])
    const pending=await probe('pending')
    release()
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await expect(page.locator('.workout-duration-saved')).toBeVisible()
    await expect(page.locator('.workout-actual-duration')).toContainText('51 мин')
    const finalScroll=await rawScroll()
    const saved=await probe('saved')
    expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(facts)
    await writeFile(info.outputPath('actual-duration-skin.json'),JSON.stringify({sample,invalidSemantics,states:[invalid,pending,saved],initialScroll,finalScroll,commands,errors,requests,responses,consoleErrors},null,2))
    expect(errors).toEqual([]);expect(requests).toEqual([]);expect(responses).toEqual([]);expect(consoleErrors).toEqual([])
    if(sample.lime)expectLimeErrorSemantics(invalidSemantics)
    for(const state of [invalid,pending,saved]) {
      assertActualDurationOwnership(state,sample.lime)
    }
  })
}
