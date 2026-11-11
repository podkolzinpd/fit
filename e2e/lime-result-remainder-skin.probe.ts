import {editorMigrationGuard} from './lime-editor-skin.contract'
import {expect,type Page} from '@playwright/test'
import {writeFile} from 'node:fs/promises'

import {resultPageSelector,resultOwnerFilter,resultMigrationGuard,resultFamilies,resultOwnerSelectors} from './lime-result-remainder-skin.contract'
const trainerFamilies=resultFamilies
const trainerMigrationGuards=[
  editorMigrationGuard,
 resultMigrationGuard,
 ':where(:not(.fit-lime-shell.workout-detail-history-identity :is(.workout-actual-duration,.workout-duration-dialog) button))',
 ':where(:not(.fit-client-lime .workout-share-overlay, .fit-client-lime .workout-share-overlay *))',
 ':where(:not(.fit-client-lime :is(.workout-completion-highlight, .workout-completion-missing, .workout-completion-muscles-line), .fit-client-lime :is(.workout-completion-highlight, .workout-completion-missing, .workout-completion-muscles-line) *))',
 ':where(:not(.fit-lime-shell.workout-detail-history-identity .workout-duration-dialog .workout-cta))',
 ':where(:not(.fit-lime-shell .workout-duration-dialog .error, .fit-lime-shell .workout-duration-dialog .error *))',
]
const trainerOwners=resultOwnerSelectors

// CSSRule restoration can leave a finished promise pending in Chromium. Read
// actual native state each paint frame; retain the same deadline and motion.
async function settleResultPaint(page:Page,selector:string){
 await page.evaluate(async selector=>{
  const deadline=performance.now()+5000
  let timer:ReturnType<typeof setTimeout>|undefined
  const work=async()=>{
   await document.fonts.ready
   let previous='',quiet=0
   while(quiet<2){
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
    for(const root of document.querySelectorAll(selector))for(const node of [root,...root.querySelectorAll('*')]){getComputedStyle(node).getPropertyValue('color');node.getBoundingClientRect()}
    const active=document.getAnimations().filter(a=>(a.playState==='running'||a.pending)&&Number.isFinite(a.effect?.getTiming().iterations)&&Number.isFinite(a.effect?.getComputedTiming().endTime))
    const signature=JSON.stringify({scroll:[document.scrollingElement,...document.querySelectorAll('.content')].map(node=>node?[node.scrollLeft,node.scrollTop,node.scrollHeight,node.clientHeight]:null),viewport:visualViewport?[visualViewport.offsetTop,visualViewport.offsetLeft,visualViewport.width,visualViewport.height]:null})
    quiet=!active.length&&signature===previous?quiet+1:0;previous=signature
    if(performance.now()>deadline)throw Error('Result paint did not settle within 5000 ms')
   }
  }
  try{await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Result paint did not settle within 5000 ms')),5000)})])}finally{clearTimeout(timer)}
 },selector)
}

// Remaining result paint: reuse the accepted CSSRule/style-object restoration. keep CSSRule/style objects, optimizer branches and
// neutral card layout intact. Raw user paths stay outside this diagnostic.
export async function probeResultRemainderSkin(page: Page, screenshot?: string, selectorOverride?: string) {
  const trainerSelector=selectorOverride??resultPageSelector
  const capture = () => page.locator('.phone-frame').evaluate((root, selector) => {
    const properties = ['display','position','color','background-color','font-family','font-size','font-weight','font-variant-numeric','text-transform','text-decoration-line','text-decoration-color','text-decoration-style','letter-spacing','line-height','width','height','min-width','min-height','max-height','gap','grid-template-columns','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','border-top-width','border-top-color','border-top-style','border-right-width','border-right-color','border-right-style','border-bottom-width','border-bottom-color','border-bottom-style','border-left-width','border-left-color','border-left-style','border-radius','box-shadow','outline-color','outline-width','outline-style','outline-offset','overflow-x','overflow-y','scroll-snap-type','touch-action','transform','--rpe-accent','--rpe-track','animation-name','animation-duration','transition-property','transition-duration','opacity','align-items','justify-content']
    const targets = Array.from(root.querySelectorAll(selector)), nodes = [...new Set(targets.flatMap(node => [node,...node.querySelectorAll('*')]))]
    const captured=nodes.map(node => { const css=getComputedStyle(node),rect=node.getBoundingClientRect();return {tag:node.tagName,class:node.getAttribute('class')||'',style:Object.fromEntries(properties.map(property=>[property,css.getPropertyValue(property)])),rect:[rect.x,rect.y,rect.width,rect.height].map(value=>Math.round(value*100)/100)} })
    for(const summary of root.querySelectorAll('.workout-completion-recorded > summary')){const css=getComputedStyle(summary,'::after'),rect=summary.getBoundingClientRect();captured.push({tag:'SUMMARY::after',class:'recorded-arrow',style:Object.fromEntries(properties.map(property=>[property,css.getPropertyValue(property)])),rect:[rect.x,rect.y,rect.width,rect.height].map(value=>Math.round(value*100)/100)})}
    // WebKit/Chromium expose native range pseudo computed values; retain the
    // originating input rect and custom vars as the observable geometry contract.
    for(const slider of root.querySelectorAll('.workout-rpe-slider'))for(const pseudo of ['::-webkit-slider-runnable-track','::-webkit-slider-thumb']){const css=getComputedStyle(slider,pseudo),rect=slider.getBoundingClientRect();captured.push({tag:'INPUT'+pseudo,class:'rpe-native',style:Object.fromEntries(properties.map(property=>[property,css.getPropertyValue(property)])),rect:[rect.x,rect.y,rect.width,rect.height].map(value=>Math.round(value*100)/100)})}
    return captured
  }, trainerSelector)
  const cssom = () => page.evaluate(() => Array.from(document.styleSheets).map(sheet => Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n')))
  const state = () => page.evaluate(() => {
    const active=document.activeElement
    const elements=[document.scrollingElement,...document.querySelectorAll('.content,.workout-detail-page')].filter((node):node is HTMLElement=>node instanceof HTMLElement)
    return {focus:active?{tag:active.tagName,id:active.id,class:active.className,role:active.getAttribute('role'),text:active.textContent}:null,scroll:elements.map(node=>({tag:node.tagName,class:node.className,x:node.scrollLeft,y:node.scrollTop,height:node.scrollHeight,client:node.clientHeight})),anchor:Array.from(document.querySelectorAll<HTMLElement>('.content')).map(node=>({style:node.getAttribute('style'),value:node.style.getPropertyValue('overflow-anchor'),priority:node.style.getPropertyPriority('overflow-anchor'),computed:getComputedStyle(node).overflowAnchor}))}
  })
  await settleResultPaint(page,trainerSelector)
  const before=await capture();expect(before.length).toBeGreaterThan(0)
  const cssomBefore=await cssom(),stateBefore=await state()
  const backdrop=await page.locator(trainerSelector).evaluateAll(elements=>elements.map(element=>getComputedStyle(element).backgroundColor))
  const frameBackground=await page.locator('.phone-frame').evaluate(element=>getComputedStyle(element).backgroundColor)
  if(screenshot)await page.screenshot({path:screenshot,animations:'allow',caret:'initial'})
  const screenshotAfter=await capture()
  if(screenshot&&JSON.stringify(screenshotAfter)!==JSON.stringify(before))await writeFile(screenshot+'.capture-drift.json',JSON.stringify({before,after:screenshotAfter,beforeState:stateBefore,afterState:await state()},null,2))
  expect(screenshotAfter).toEqual(before)
  const ablation=await page.evaluateHandle(({families,guards,owners,ownerScope,selector})=>{
    const normalize=(selector:string)=>selector.replace(/,\s*/g,',').replace(/"/g,"'")
    const common=new Set(families.map(normalize)),allowed=new Set(guards.map(normalize)),ownerSelectors=new Set(owners.map(normalize))
    const zeroBorder=document.createElement('span').style;zeroBorder.border='0'
    const neutralBorder=(property:string,value:string,style:CSSStyleDeclaration)=>{
      if(!property.startsWith('border')||!Array.from(zeroBorder).includes(property)||value!==zeroBorder.getPropertyValue(property))return false
      if(style.getPropertyValue('border')===zeroBorder.getPropertyValue('border'))return true
      return ['top','right','bottom','left'].some(side=>property.startsWith('border-'+side+'-')&&style.getPropertyValue('border-'+side)===zeroBorder.getPropertyValue('border-'+side))
    }
    const visual=(property:string,value:string,selector:string,style:CSSStyleDeclaration)=>selector.includes('::after')||selector.includes('exercise-details-chevron')?property==='color':/^(?:color|background(?:-.+)?|border(?:-.+)?|box-shadow|font(?:-.+)?|letter-spacing|text-transform|text-decoration(?:-.+)?|opacity|--rpe-(?:accent|track))$/.test(property)&&!(/^border/.test(property)&&/^(?:0(?:px)?|none)$/.test(value.trim()))&&!neutralBorder(property,value,style)
    const classified=(css:string)=>{const style=document.createElement('span').style;style.cssText=css;return Array.from(style).filter(property=>visual(property,style.getPropertyValue(property),'.mc517-predicate-check',style))}
    const classifierBorderChecks={fullZeroNeutral:classified('border:0').length===0,sideZeroNeutral:classified('border-top:0').length===0,colorPaint:classified('border-color:red').some(p=>p.endsWith('color')),borderPaint:classified('border:1px solid red').length>0,explicitColorOnZeroPaint:classified('border:0;border-color:red').some(p=>p.endsWith('color'))}
    const strip=(selector:string)=>{
      let cursor=0
      while(true){const start=selector.indexOf(':where(',cursor);if(start<0)break;let end=start+7,depth=1,quote='';while(depth&&end<selector.length){const char=selector[end]!;if(quote){if(char===quote&&selector.charCodeAt(end-1)!==92)quote=''}else if(char==='"'||char==="'")quote=char;else if(char==='(')depth++;else if(char===')')depth--;end++}const block=selector.slice(start,end);if(allowed.has(normalize(block))){selector=selector.slice(0,start)+selector.slice(end);cursor=start}else cursor=end}
      return normalize(selector)
    }
    const unknownGuard=families[0]!+':where(:not(.mc517-unknown-owner))'
    const classifierGuardChecks={known:strip(families[0]!+guards[0]!)===normalize(families[0]!),unknownRetained:strip(unknownGuard)===normalize(unknownGuard)}
    const branches=(text:string)=>{const list:string[]=[];let depth=0,quote='',start=0;for(let i=0;i<text.length;i++){const char=text[i]!;if(quote){if(char===quote&&text.charCodeAt(i-1)!==92)quote='';continue}if(char==='"'||char==="'")quote=char;else if(char==='('||char==='[')depth++;else if(char===')'||char===']')depth--;else if(char===','&&!depth){list.push(text.slice(start,i).trim());start=i+1}}list.push(text.slice(start).trim());return list}
    const owned=new Set(Array.from(document.querySelectorAll(selector)).flatMap(node=>[node,...node.querySelectorAll('*')]))
    const originating=(s:string)=>s.replace(/::[\w-]+(?:\([^)]*\))?$/,'')
    const touchesOwned=(s:string)=>Array.from(document.querySelectorAll(originating(s))).some(node=>owned.has(node))
    const changed:{rule:CSSStyleRule;selectors:string[];selected:string[]}[]=[],foundOwners=new Set<string>(),ownerDefinitions=new Set<string>()
    const visit=(rules:CSSRuleList)=>{for(const rule of Array.from(rules)){if(rule instanceof CSSStyleRule){const selectors=branches(rule.selectorText);for(const selector of selectors)if(ownerSelectors.has(normalize(selector))){ownerDefinitions.add(normalize(selector));if(touchesOwned(selector))foundOwners.add(normalize(selector))};const selected=selectors.filter(selector=>common.has(strip(selector))&&Array.from(rule.style).some(property=>visual(property,rule.style.getPropertyValue(property),rule.selectorText,rule.style)));if(selected.length)changed.push({rule,selectors,selected})}if('cssRules'in rule)visit((rule as CSSGroupingRule).cssRules)}}
    for(const sheet of Array.from(document.styleSheets))visit(sheet.cssRules)
    const selected=changed.flatMap(item=>item.selected),matches=selected.filter(touchesOwned)
    const matchedLegacyPaint=changed.filter(item=>item.selected.some(touchesOwned)).map(item=>({selectors:item.selected.filter(touchesOwned),declarations:Array.from(item.rule.style).filter(property=>visual(property,item.rule.style.getPropertyValue(property),item.rule.selectorText,item.rule.style)).map(property=>({property,value:item.rule.style.getPropertyValue(property)})),cssText:item.rule.style.cssText}))
    const legacyMatches=selected.every(selector=>{const old=Array.from(document.querySelectorAll(originating(strip(selector)))).filter(node=>owned.has(node)),current=Array.from(document.querySelectorAll(originating(selector))).filter(node=>owned.has(node));return old.length===current.length&&old.every((node,i)=>node===current[i])})
    const probe=document.createElement('style');probe.textContent=matches.map(selector=>selector+'{--mc517-legacy-report-probe:legacy}').join(' ');document.head.append(probe)
    const inherited=Array.from(document.querySelectorAll(selector)).flatMap(node=>[node,...node.querySelectorAll('*')]).filter(node=>getComputedStyle(node).getPropertyValue('--mc517-legacy-report-probe').trim()==='legacy').length;probe.remove()
    const anchorStyle=document.createElement('style');anchorStyle.textContent='.content{overflow-anchor:none!important}';document.head.append(anchorStyle)
    const scroll=Array.from(document.querySelectorAll<HTMLElement>('*')).map(node=>({node,x:node.scrollLeft,y:node.scrollTop}))
    const restore:{rule:CSSStyleRule;style:CSSStyleDeclaration;selector:string;text:string}[]=[],clones:{parent:CSSStyleSheet|CSSGroupingRule;rule:CSSRule}[]=[]
    for(const {rule,selectors,selected} of changed){
      const applicable=selected.filter(touchesOwned)
      if(!applicable.length)continue
      const originalSelector=rule.selectorText,text=rule.style.cssText
      // Reuse selector-only branch ablation; don't insert a dynamic :has owner
      // into CSSOM. Capture stays on the actual result and natural paths precede it.
      const retained=selectors.filter(branch=>!applicable.includes(branch))
      rule.selectorText=retained.length?retained.join(', '):':not(*)'
      const neutral=Array.from(rule.style).filter(property=>!visual(property,rule.style.getPropertyValue(property),rule.selectorText,rule.style)).map(property=>property+':'+rule.style.getPropertyValue(property)+(rule.style.getPropertyPriority(property)?'!important':'')).join(';')
      if(neutral){const parent=(rule.parentRule??rule.parentStyleSheet) as CSSGroupingRule,index=Array.from(parent.cssRules).indexOf(rule);parent.insertRule(applicable.join(', ')+'{'+neutral+'}',index+1);clones.push({parent,rule:parent.cssRules[index+1]!})}
      restore.push({rule,style:rule.style,selector:originalSelector,text})
    }
    return {classifierBorderChecks,matchedLegacyPaint,rules:changed.length,families:[...new Set(selected.map(strip))],matches,inherited,legacyMatches,selectedPositiveOwners:selected.filter(selector=>strip(selector).includes(':where(')),owners:[...foundOwners].sort(),ownerDefinitions:[...ownerDefinitions].sort(),classifierGuardChecks,classifierOwnerChecks:[...ownerSelectors].map(selector=>({selector,retained:strip(selector).includes(normalize(ownerScope)),legacy:common.has(strip(selector))})),restore,clones,scroll,anchorStyle}
  },{families:trainerFamilies,guards:trainerMigrationGuards,owners:trainerOwners,ownerScope:':where('+resultOwnerFilter+')',selector:trainerSelector})
  const result=await ablation.evaluate(value=>({classifierBorderChecks:value.classifierBorderChecks,matchedLegacyPaint:value.matchedLegacyPaint,rules:value.rules,families:value.families,matches:value.matches,inherited:value.inherited,legacyMatches:value.legacyMatches,selectedPositiveOwners:value.selectedPositiveOwners,owners:value.owners,ownerDefinitions:value.ownerDefinitions,classifierGuardChecks:value.classifierGuardChecks,classifierOwnerChecks:value.classifierOwnerChecks}))
  expect(result.classifierBorderChecks).toEqual({fullZeroNeutral:true,sideZeroNeutral:true,colorPaint:true,borderPaint:true,explicitColorOnZeroPaint:true})
  expect(result.classifierGuardChecks).toEqual({known:true,unknownRetained:true})
  expect(result.selectedPositiveOwners).toEqual([])
  // Reviewed negative migration guards may disappear from owner identity; the
  // actual positive owner scope must remain, so copies never become legacy.
  expect(result.classifierOwnerChecks).toHaveLength(trainerOwners.length)
  expect(result.classifierOwnerChecks.every(check=>check.retained&&!check.legacy)).toBe(true)
  await settleResultPaint(page,trainerSelector)
  const after=await capture()
  const restored=await ablation.evaluate(async({restore,clones,scroll})=>{
    for(const saved of restore)saved.rule.selectorText=saved.selector
    for(const {parent,rule} of clones){const index=Array.from(parent.cssRules).indexOf(rule);if(index<0)throw Error('Neutral trainer-card clone missing');parent.deleteRule(index)}
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
    for(const {node,x,y} of scroll){node.scrollLeft=x;node.scrollTop=y}
    return {restoration:restore.every(saved=>saved.rule.style===saved.style&&saved.rule.selectorText===saved.selector&&saved.rule.style.cssText===saved.text)}
  })
  try{await settleResultPaint(page,trainerSelector)}catch(error){
    if(screenshot)await writeFile(screenshot+'.settlement.json',JSON.stringify(await page.evaluate(()=>({now:performance.now(),fonts:document.fonts.status,animations:document.getAnimations().map(a=>{const effect=a.effect as KeyframeEffect|null;const target=effect?.target;return {type:a.constructor.name,name:a instanceof CSSAnimation?a.animationName:a instanceof CSSTransition?a.transitionProperty:null,state:a.playState,pending:a.pending,current:a.currentTime,start:a.startTime,timing:effect?.getTiming(),computed:effect?.getComputedTiming(),frames:effect?.getKeyframes(),target:target instanceof Element?{tag:target.tagName,class:target.className,id:target.id}:null}})})),null,2))
    throw error
  }
  await ablation.evaluate(({anchorStyle})=>anchorStyle.remove());await ablation.dispose()
  await settleResultPaint(page,trainerSelector)
  expect(restored.restoration).toBe(true);expect(await cssom()).toEqual(cssomBefore);expect(await state()).toEqual(stateBefore)
  const finalCapture=await capture()
  if(screenshot&&JSON.stringify(finalCapture)!==JSON.stringify(before))await writeFile(screenshot+'.restore-drift.json',JSON.stringify({before,after:finalCapture,animations:await page.evaluate(()=>document.getAnimations().map(a=>({state:a.playState,pending:a.pending,current:a.currentTime,name:a instanceof CSSTransition?a.transitionProperty:null,target:(a.effect as KeyframeEffect|null)?.target?.getAttribute('class'),frames:(a.effect as KeyframeEffect|null)?.getKeyframes(),timing:a.effect?.getTiming()})))},null,2))
  expect(finalCapture).toEqual(before)
  expect(await page.locator(trainerSelector).evaluateAll(elements=>elements.map(element=>getComputedStyle(element).backgroundColor))).toEqual(backdrop)
  expect(after).toHaveLength(before.length)
  const differences=before.flatMap((a,i)=>{const b=after[i]!,changes=Object.fromEntries(Object.keys(a.style).filter(property=>a.style[property]!==b.style[property]).map(property=>[property,[a.style[property],b.style[property]]]));return Object.keys(changes).length||JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[{tag:a.tag,class:a.class,changes,rect:JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[a.rect,b.rect]:undefined}]:[]})
  return {before,backdrop,frameBackground,...result,...restored,cssomRoundTrip:true,focusScrollAnchorRoundTrip:true,differences,stateBefore}
}

export function assertResultRemainderOwnership(result: Awaited<ReturnType<typeof probeResultRemainderSkin>>, lime: boolean) {
  expect(result.families.length).toBeGreaterThan(0)
  if(lime){
    expect(result.matches).toEqual([]);expect(result.inherited).toBe(0);expect(result.differences).toEqual([])
    expect(result.ownerDefinitions).toEqual(trainerOwners.map(selector=>selector.replace(/,\s*/g,',').replace(/"/g,"'")).sort())
  }else{
    expect(result.owners).toEqual([]);expect(result.legacyMatches).toBe(true)
    expect(result.matches.length).toBeGreaterThan(0);expect(result.inherited).toBeGreaterThan(0);expect(result.differences.length).toBeGreaterThan(0)
  }
}

