import {workoutListMigrationGuard} from './lime-workout-list-skin.scope'
import {libraryMigrationGuard} from './lime-library-skin.contract'
import {expect,type Page,type Request} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {editorPageSelector,editorOwnerFilter,editorMigrationGuard,editorFamilies,editorOwnerSelectors,editorKnownGuards} from './lime-editor-skin.contract'
// MC519 reuses this read-only reader with an explicit library contract. The
// default contract and every existing editor assertion remain unchanged.
export type NativeWorkoutSkinContract={selector:string;families:string[];knownGuards:string[];migrationGuard:string;ownerFilter:string;ownerSelectors:string[];additionalPaintProperties?:string[];additionalCaptureProperties?:string[];captureDOM?:boolean;captureSelectState?:boolean;captureRootSelector?:string;backgroundRootSelector?:string;excludedPaintProperties?:string[]}
const editorSkinContract:NativeWorkoutSkinContract={selector:editorPageSelector,families:editorFamilies,knownGuards:[workoutListMigrationGuard,libraryMigrationGuard,...editorKnownGuards],migrationGuard:editorMigrationGuard,ownerFilter:editorOwnerFilter,ownerSelectors:editorOwnerSelectors}
// Passive image-request metadata distinguishes real loading from untouched lazy
// images. No image source/loading attribute or browser API is changed.
const mediaRequests=new WeakMap<Page,{pending:Set<Request>}>()
export function observeEditorImages(page:Page){
 if(mediaRequests.has(page))return
 const state={pending:new Set<Request>()};mediaRequests.set(page,state)
 page.on('request',request=>{if(request.resourceType()==='image'){state.pending.add(request)}})
 page.on('requestfinished',request=>state.pending.delete(request));page.on('requestfailed',request=>state.pending.delete(request))
}
// Read native state each natural paint frame, with the same bounded deadline.
export async function settleEditorPaint(page:Page,selector:string,contract:NativeWorkoutSkinContract=editorSkinContract){
 const network=mediaRequests.get(page);if(!network)throw Error('Editor image observation must start before navigation')
 let timer:ReturnType<typeof setTimeout>|undefined,stopped=false
 const work=async()=>{
  await page.evaluate(()=>document.fonts.ready)
  let previous='',quiet=0
  while(quiet<2&&!stopped){
   const state=await page.evaluate(async({selector,rootSelector}:{selector:string;rootSelector:string})=>{
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
    const root=document.querySelector(rootSelector),targets=root?Array.from(root.querySelectorAll(selector)):[]
    const nodes=[...new Set(targets.flatMap(node=>{const ancestors:Element[]=[];for(let p=node.parentElement;p;p=p.parentElement)ancestors.push(p);return[node,...node.querySelectorAll('*'),...ancestors]}))]
    // Observe native layout/font/paint readiness in the same frame. The full
    // strict capture below remains unchanged; do not repeat its large payload
    // on every readiness frame.
    const properties=['font-family','font-size','font-weight','letter-spacing','line-height','color','background-color','border-top-color','border-right-color','border-bottom-color','border-left-color','opacity','transform']
    const paint=nodes.map(node=>{const css=getComputedStyle(node),rect=node.getBoundingClientRect();return[node.className,rect.x,rect.y,rect.width,rect.height,...properties.map(property=>css.getPropertyValue(property))]})
    const active=document.getAnimations().filter(a=>(a.playState==='running'||a.pending)&&Number.isFinite(a.effect?.getTiming().iterations)&&Number.isFinite(a.effect?.getComputedTiming().endTime))
    const media=[...new Set(Array.from(document.querySelectorAll(selector)).flatMap(root=>Array.from(root.querySelectorAll('.exercise-image'))))]
    const mediaPending=media.some(node=>{const rect=node.getBoundingClientRect(),near=rect.width>0&&rect.height>0&&rect.bottom>=-320&&rect.top<=innerHeight+320;return near&&node.classList.contains('exercise-image-loading')||Array.from(node.querySelectorAll('img')).some(img=>img.loading==='eager'&&(!img.complete||img.naturalWidth<=0)||img.complete&&img.naturalWidth>0&&node.classList.contains('exercise-image-loading'))})
    const signature=JSON.stringify({paint,media:media.map(node=>({class:node.className,images:Array.from(node.querySelectorAll('img')).map(img=>[img.currentSrc||img.src,img.loading,img.complete,img.naturalWidth,img.naturalHeight])})),scroll:[document.scrollingElement,...document.querySelectorAll('.content')].map(node=>node?[node.scrollLeft,node.scrollTop,node.scrollHeight,node.clientHeight]:null),viewport:visualViewport?[visualViewport.offsetTop,visualViewport.offsetLeft,visualViewport.width,visualViewport.height]:null})
    return {active:active.length,mediaPending,signature,fontsReady:document.fonts.status==='loaded'}
   },{selector,rootSelector:contract.captureRootSelector??'.phone-frame'})
   quiet=state.fontsReady&&!state.active&&!state.mediaPending&&!network.pending.size&&state.signature===previous?quiet+1:0;previous=state.signature
  }
 }
 try{await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Editor paint did not settle within 5000 ms')),5000)})])}finally{stopped=true;clearTimeout(timer)}
}

export async function captureEditorSkin(page:Page,selector:string,families:string[]=editorFamilies,additionalCaptureProperties:string[]=[],captureSelectState=false,captureRootSelector='.phone-frame'){
  return page.locator(captureRootSelector).evaluate((root, {selector,families,additionalCaptureProperties,captureSelectState}) => {
    const properties = ['display','position','top','right','bottom','left','content','appearance','-webkit-appearance','fill','stroke','stroke-width','background-image','background-size','background-position','background-repeat','background-origin','background-clip','mask-image','mask-size','color','background-color','font-family','font-size','font-weight','font-variant-numeric','text-transform','text-decoration-line','text-decoration-color','text-decoration-style','letter-spacing','line-height','width','height','min-width','min-height','max-height','gap','grid-template-columns','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','border-top-width','border-top-color','border-top-style','border-right-width','border-right-color','border-right-style','border-bottom-width','border-bottom-color','border-bottom-style','border-left-width','border-left-color','border-left-style','border-radius','box-shadow','outline-color','outline-width','outline-style','outline-offset','overflow-x','overflow-y','scroll-snap-type','touch-action','transform','--rpe-accent','--rpe-track','animation-name','animation-duration','transition-property','transition-duration','opacity','align-items','justify-content',...additionalCaptureProperties]
    const targets = Array.from(root.querySelectorAll(selector)), nodes = [...new Set(targets.flatMap(node => {const ancestors:Element[]=[];for(let p=node.parentElement;p;p=p.parentElement)ancestors.push(p);return [node,...node.querySelectorAll('*'),...ancestors]}))]
    const captured=nodes.map(node => { const css=getComputedStyle(node),rect=node.getBoundingClientRect();return {tag:node.tagName,class:node.getAttribute('class')||'',interaction:{focus:node===document.activeElement,focusVisible:node.matches(':focus-visible'),disabled:node.matches(':disabled'),expanded:node.getAttribute('aria-expanded'),open:node.hasAttribute('open')},scroll:[node.scrollLeft,node.scrollTop,node.scrollHeight,node.clientHeight],...(node instanceof HTMLInputElement||node instanceof HTMLTextAreaElement?{form:{value:node.value,selection:[node.selectionStart,node.selectionEnd,node.selectionDirection],checked:node instanceof HTMLInputElement?node.checked:null}}:captureSelectState&&node instanceof HTMLSelectElement?{form:{value:node.value,selectedIndex:node.selectedIndex,multiple:node.multiple,selectedOptions:Array.from(node.selectedOptions).map(option=>({index:option.index,value:option.value,label:option.label,text:option.text,selected:option.selected,disabled:option.disabled,html:option.outerHTML}))}}:{}),style:Object.fromEntries(properties.map(property=>[property,css.getPropertyValue(property)])),rect:[rect.x,rect.y,rect.width,rect.height].map(value=>Math.round(value*100)/100)} })
    const observed=new Set(nodes),pseudos=new Map<Element,Set<string>>()
    const add=(node:Element,pseudo:string)=>{if(!observed.has(node))return;const list=pseudos.get(node)??new Set<string>();list.add(pseudo);pseudos.set(node,list)}
    for(const family of families){const pseudo=family.match(/::[\w-]+(?:\([^)]*\))?$/)?.[0];if(!pseudo||!CSS.supports('selector('+family+')'))continue;const origin=family.slice(0,-pseudo.length);for(const node of document.querySelectorAll(origin))add(node,pseudo)}
    for(const dialog of root.querySelectorAll('dialog'))add(dialog,'::backdrop')
    for(const [node,list] of pseudos)for(const pseudo of list){const css=getComputedStyle(node,pseudo),rect=node.getBoundingClientRect();captured.push({tag:node.tagName+pseudo,class:node.getAttribute('class')||'',interaction:{focus:node===document.activeElement,focusVisible:node.matches(':focus-visible'),disabled:node.matches(':disabled'),expanded:node.getAttribute('aria-expanded'),open:node.hasAttribute('open')},scroll:[node.scrollLeft,node.scrollTop,node.scrollHeight,node.clientHeight],style:Object.fromEntries(properties.map(property=>[property,css.getPropertyValue(property)])),rect:[rect.x,rect.y,rect.width,rect.height].map(value=>Math.round(value*100)/100)})}
    return captured
  }, {selector,families,additionalCaptureProperties,captureSelectState})
 }


// Keep complete source snapshots in the browser. Serializing the entire CSSOM
// over the protocol twice per probe was expensive in multi-state cases.
// Each probe still takes a fresh snapshot and compares every source string.
export async function captureEditorSources(page:Page,selector:string,captureDOM=false){
 return page.evaluateHandle(({selector,captureDOM})=>{
  const rules:{rule:CSSStyleRule;style:CSSStyleDeclaration;selector:string;text:string}[]=[]
  const visit=(items:CSSRuleList)=>{for(const rule of Array.from(items)){if(rule instanceof CSSStyleRule)rules.push({rule,style:rule.style,selector:rule.selectorText,text:rule.style.cssText});if('cssRules'in rule)visit((rule as CSSGroupingRule).cssRules)}}
  for(const sheet of Array.from(document.styleSheets))visit(sheet.cssRules)
  return {rules,selector,cssom:Array.from(document.styleSheets).map(sheet=>Array.from(sheet.cssRules).map(rule=>rule.cssText).join('\n')),
   dom:captureDOM?Array.from(document.querySelectorAll(selector)).map(node=>({tag:node.tagName,class:node.getAttribute('class')??'',html:node.outerHTML})):null}
 },{selector,captureDOM})
}

export async function readEditorSourceProof(sources:Awaited<ReturnType<typeof captureEditorSources>>){
 return sources.evaluate(async snapshot=>{
  const cssom=Array.from(document.styleSheets).map(sheet=>Array.from(sheet.cssRules).map(rule=>rule.cssText).join('\n'))
  const dom=snapshot.dom===null?null:Array.from(document.querySelectorAll(snapshot.selector)).map(node=>({tag:node.tagName,class:node.getAttribute('class')??'',html:node.outerHTML}))
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot.cssom)))
  return {cssomUnchanged:JSON.stringify(cssom)===JSON.stringify(snapshot.cssom),domUnchanged:JSON.stringify(dom)===JSON.stringify(snapshot.dom),
   styleObjectsUnchanged:snapshot.rules.every(s=>s.rule.style===s.style&&s.rule.selectorText===s.selector&&s.rule.style.cssText===s.text),
   cssomSHA256:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''),dom:snapshot.dom}
 })
}

// No stylesheet, node, focus, selection or scroll mutation is used to prove
// ownership. The complete legacy source/order is checked separately; native
// selector intersection (including ancestors and originating pseudo elements)
// and exact baseline/candidate capture prove isolation and preserved appearance.
export async function probeEditorSkin(page:Page,screenshot?:string,selectorOverride?:string,contract:NativeWorkoutSkinContract=editorSkinContract){
 const selector=selectorOverride??contract.selector
 await settleEditorPaint(page,selector,contract)
 const state=()=>page.evaluate(()=>({focus:document.activeElement?.outerHTML,scroll:[document.scrollingElement,...document.querySelectorAll('.content,.workout-form-page,.today-review')].filter((n):n is HTMLElement=>n instanceof HTMLElement).map(n=>({tag:n.tagName,class:n.className,x:n.scrollLeft,y:n.scrollTop,height:n.scrollHeight,client:n.clientHeight}))}))
 const before=await captureEditorSkin(page,selector,contract.families,contract.additionalCaptureProperties??[],contract.captureSelectState??false,contract.captureRootSelector??'.phone-frame');expect(before.length).toBeGreaterThan(0)
 const stateBefore=await state(),sources=await captureEditorSources(page,selector,contract.captureDOM)
 const result=await page.evaluate(({families,guards,owners,ownerScope,selector,additionalPaintProperties,excludedPaintProperties})=>{
  const normalize=(s:string)=>s.replace(/,\s*/g,',').replace(/"/g,"'")
  const common=new Set(families.map(normalize)),allowed=new Set(guards.map(normalize)),ownerSelectors=new Set(owners.map(normalize))
  const split=(s:string)=>{const list:string[]=[];let n=0,q='',start=0;for(let i=0;i<s.length;i++){const c=s[i]!;if(q){if(c===q&&s[i-1]!=='\\')q=''}else if(c==='"'||c==="'")q=c;else if(c==='('||c==='[')n++;else if(c===')'||c===']')n--;else if(c===','&&!n){list.push(s.slice(start,i).trim());start=i+1}}list.push(s.slice(start).trim());return list}
  const strip=(s:string)=>{let i=0;while((i=s.indexOf(':where(',i))>=0){let j=i+7,n=1,q='';for(;j<s.length&&n;j++){const c=s[j]!;if(q){if(c===q&&s[j-1]!=='\\')q=''}else if(c==='"'||c==="'")q=c;else if(c==='(')n++;else if(c===')')n--}if(allowed.has(normalize(s.slice(i,j))))s=s.slice(0,i)+s.slice(j);else i=j}return normalize(s)}
  const zero=document.createElement('span').style;zero.border='0'
  const neutral=(p:string,v:string,s:CSSStyleDeclaration)=>p.startsWith('border')&&Array.from(zero).includes(p)&&v===zero.getPropertyValue(p)&&(s.getPropertyValue('border')===zero.getPropertyValue('border')||['top','right','bottom','left'].some(side=>p.startsWith('border-'+side+'-')&&s.getPropertyValue('border-'+side)===zero.getPropertyValue('border-'+side)))
  const paint=(p:string,v:string,s:CSSStyleDeclaration)=>!excludedPaintProperties.includes(p)&&!(p.startsWith('font')&&(p==='font-variant-numeric'||v.trim()==='inherit'))&&(/^(?:color|background(?:-.+)?|border(?:-.+)?|box-shadow|font(?:-.+)?|letter-spacing|text-transform|text-decoration(?:-.+)?|opacity)$/.test(p)||additionalPaintProperties.includes(p))&&!(/^border/.test(p)&&/^(?:0(?:px)?|none)$/.test(v.trim()))&&!neutral(p,v,s)
  const classified=(css:string)=>{const s=document.createElement('span').style;s.cssText=css;return Array.from(s).filter(p=>paint(p,s.getPropertyValue(p),s))}
  const classifierBorderChecks={fullZeroNeutral:!classified('border:0').length,sideZeroNeutral:!classified('border-top:0').length,colorPaint:classified('border-color:red').some(p=>p.endsWith('color')),borderPaint:!!classified('border:1px solid red').length,explicitColorOnZeroPaint:classified('border:0;border-color:red').some(p=>p.endsWith('color'))}
  const targets=Array.from(document.querySelectorAll(selector)),owned=new Set(targets.flatMap(n=>[n,...n.querySelectorAll('*')])),ancestors=new Set<Element>()
  for(const node of owned)for(let p=node.parentElement;p;p=p.parentElement)if(!owned.has(p))ancestors.add(p)
  const observed=new Set([...owned,...ancestors]),unsupported:string[]=[]
  const originating=(s:string)=>s.replace(/::[\w-]+(?:\([^)]*\))?$/,'')
  const queried=new Map<string,Element[]>()
  const query=(s:string)=>{
   const cached=queried.get(s);if(cached)return cached
   try{const nodes=Array.from(document.querySelectorAll(originating(s))).filter(n=>observed.has(n));queried.set(s,nodes);return nodes}
   catch(error){if(CSS.supports('selector('+s+')'))throw error;unsupported.push(s);return []}
  }
  const selected:string[]=[],matches:string[]=[],ancestorMatches:string[]=[],pseudoMatches:string[]=[],activeMatches:string[]=[],ownerDefinitions=new Set<string>(),foundOwners=new Set<string>(),matchedLegacyPaint:{selector:string;active:boolean;nodes:number;ancestors:number;declarations:{property:string;value:string;important:boolean}[]}[]=[]
  const visit=(rules:CSSRuleList,active=true)=>{for(const rule of Array.from(rules)){
   if(rule instanceof CSSStyleRule){let declarations:{property:string;value:string;important:boolean}[]|undefined;for(const branch of split(rule.selectorText)){
    if(ownerSelectors.has(normalize(branch))){ownerDefinitions.add(normalize(branch));if(query(branch).length)foundOwners.add(normalize(branch))}
    // Parse authored declarations only for a reviewed legacy family, once per
    // rule. Owner discovery still covers every branch, and every selected
    // declaration/intersection assertion is unchanged.
    if(!common.has(strip(branch)))continue
    declarations??=Array.from(rule.style).filter(p=>paint(p,rule.style.getPropertyValue(p),rule.style)).map(p=>({property:p,value:rule.style.getPropertyValue(p),important:!!rule.style.getPropertyPriority(p)}))
    if(!declarations.length)continue
    selected.push(branch);const nodes=query(branch);if(!nodes.length)continue
    matches.push(branch);const ancestorCount=nodes.filter(n=>ancestors.has(n)).length;if(ancestorCount)ancestorMatches.push(branch);if(branch.includes('::'))pseudoMatches.push(branch);if(active)activeMatches.push(branch)
    matchedLegacyPaint.push({selector:branch,active,nodes:nodes.length,ancestors:ancestorCount,declarations})
   }}
   if('cssRules'in rule)visit((rule as CSSGroupingRule).cssRules,active&&(!(rule instanceof CSSMediaRule)||matchMedia(rule.conditionText).matches)&&(!(rule instanceof CSSSupportsRule)||CSS.supports(rule.conditionText)))
  }}
  for(const sheet of Array.from(document.styleSheets))visit(sheet.cssRules,!sheet.disabled&&(!sheet.media.mediaText||matchMedia(sheet.media.mediaText).matches))
  const unknown=families[0]!+':where(:not(.mc518-unknown-owner))'
  return {rules:selected.length,families:[...new Set(selected.map(strip))],matches,ancestorMatches,pseudoMatches,activeMatches,matchedLegacyPaint,unsupported,owners:[...foundOwners].sort(),ownerDefinitions:[...ownerDefinitions].sort(),legacyMatches:selected.every(s=>{const a=query(strip(s)),b=query(s);return a.length===b.length&&a.every((n,i)=>n===b[i])}),selectedPositiveOwners:selected.filter(s=>strip(s).includes(':where(')),classifierBorderChecks,classifierGuardChecks:{known:strip(families[0]!+guards[0]!)===normalize(families[0]!),unknownRetained:strip(unknown)===normalize(unknown)},classifierOwnerChecks:[...ownerSelectors].map(s=>({selector:s,retained:strip(s).includes(normalize(ownerScope)),legacy:common.has(strip(s))})),observedNodes:observed.size,ancestorNodes:ancestors.size}
 },{families:contract.families,guards:[contract.migrationGuard,...contract.knownGuards],owners:contract.ownerSelectors,ownerScope:':where('+contract.ownerFilter+')',selector,additionalPaintProperties:contract.additionalPaintProperties??[],excludedPaintProperties:contract.excludedPaintProperties??[]})
 expect(result.classifierBorderChecks).toEqual({fullZeroNeutral:true,sideZeroNeutral:true,colorPaint:true,borderPaint:true,explicitColorOnZeroPaint:true})
 expect(result.classifierGuardChecks).toEqual({known:true,unknownRetained:true});expect(result.selectedPositiveOwners).toEqual([])
 expect(result.classifierOwnerChecks).toHaveLength(contract.ownerSelectors.length);expect(result.classifierOwnerChecks.every(c=>c.retained&&!c.legacy)).toBe(true)
 const backdrop=await page.locator(selector).evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundColor)),frameBackground=await page.locator(contract.backgroundRootSelector??'.phone-frame').evaluate(n=>getComputedStyle(n).backgroundColor)
 if(screenshot)await page.screenshot({path:screenshot,animations:'allow',caret:'initial'})
 await settleEditorPaint(page,selector,contract)
 const after=await captureEditorSkin(page,selector,contract.families,contract.additionalCaptureProperties??[],contract.captureSelectState??false,contract.captureRootSelector??'.phone-frame'),stateAfter=await state()
 if(screenshot&&JSON.stringify(after)!==JSON.stringify(before))await writeFile(screenshot+'.capture-drift.json',JSON.stringify({before,after,stateBefore,stateAfter},null,2))
 expect(after).toEqual(before);expect(stateAfter).toEqual(stateBefore)
 const sourceProof=await readEditorSourceProof(sources)
 expect(sourceProof.cssomUnchanged).toBe(true);if(contract.captureDOM)expect(sourceProof.domUnchanged).toBe(true)
 expect(sourceProof.styleObjectsUnchanged).toBe(true)
 await sources.dispose()
 return {before,...(contract.captureDOM?{dom:sourceProof.dom}:{}),backdrop,frameBackground,...result,stateBefore,cssomSHA256:sourceProof.cssomSHA256,cssomNeverMutated:true,styleObjectsUnchanged:true,nativeCaptureStable:true,focusScrollAnchorNeverMutated:true,method:'Native source/selector/ancestor/pseudo intersection + exact capture; no CSSOM or DOM mutation'}
}

export function assertEditorOwnership(result:Awaited<ReturnType<typeof probeEditorSkin>>,lime:boolean,contract:NativeWorkoutSkinContract=editorSkinContract){
 expect(result.families.length).toBeGreaterThan(0);expect(result.observedNodes).toBeGreaterThan(0)
 if(lime){expect(result.matches).toEqual([]);expect(result.ancestorMatches).toEqual([]);expect(result.pseudoMatches).toEqual([]);expect(result.ownerDefinitions).toEqual(contract.ownerSelectors.map(s=>s.replace(/,\s*/g,',').replace(/"/g,"'")).sort())}
 else{expect(result.owners).toEqual([]);expect(result.legacyMatches).toBe(true);expect(result.matches.length).toBeGreaterThan(0);expect(result.activeMatches.length).toBeGreaterThan(0)}
}
