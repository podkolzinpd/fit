import {expect,type Page} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {captureEditorSkin,settleEditorPaint} from './lime-editor-skin.probe'
import {assistantContract as contract} from './lime-assistant-skin.contract'

// Recording is a real dynamic state: the Stop button's accessible name ticks.
// Keep it separate from strict static DOM captures. No DOM/CSS/timer/scroll is
// changed here; full raw snapshots and every observed mutation remain evidence.
export async function probeAssistantRecording(page:Page,screenshot:string,baseline:boolean){
 await page.mouse.move(0,0)
 await settleEditorPaint(page,contract.selector,contract)
 const observer=await page.evaluateHandle(({selector})=>{
  const roots=Array.from(document.querySelectorAll(selector))
  const timer=document.querySelector(`${selector} .voice-input-icon button.recording`)
  if(roots.length!==1||!timer)throw Error('Expected one native Assistant recording root and Stop button')
  const focus=document.activeElement
  const nodes=()=>roots.flatMap(root=>{const result:Node[]=[];const visit=(node:Node)=>{result.push(node);node.childNodes.forEach(visit)};visit(root);return result})
  const originalNodes=nodes()
  const raw=()=>({at:performance.now(),html:roots.map(root=>root.outerHTML),focusHTML:document.activeElement?.outerHTML??null,focusTag:document.activeElement?.tagName??null,nodes:nodes().map((node,index)=>({index,type:node.nodeType,name:node.nodeName,value:node.nodeValue,attributes:node instanceof Element?Array.from(node.attributes).map(attr=>[attr.name,attr.value]):[],timer:node===timer})),scroll:[document.scrollingElement,...document.querySelectorAll('.content,.assistant-thread')].map(node=>node?[node.scrollLeft,node.scrollTop,node.scrollHeight,node.clientHeight]:null),viewport:visualViewport?[visualViewport.offsetTop,visualViewport.offsetLeft,visualViewport.width,visualViewport.height]:null})
  const before=raw(),mutations:{at:number;timer:boolean;type:string;attribute:string|null;old:string|null;value:string|null}[]=[]
  const record=(records:MutationRecord[])=>records.forEach(item=>mutations.push({at:performance.now(),timer:item.target===timer,type:item.type,attribute:item.attributeName,old:item.oldValue,value:item.target instanceof Element&&item.attributeName?item.target.getAttribute(item.attributeName):item.target.nodeValue}))
  const watching=new MutationObserver(record);roots.forEach(root=>watching.observe(root,{subtree:true,attributes:true,attributeOldValue:true,characterData:true,characterDataOldValue:true,childList:true}))
  const styles:{rule:CSSStyleRule;style:CSSStyleDeclaration;selector:string;text:string}[]=[]
  const visitRules=(rules:CSSRuleList)=>{for(const rule of Array.from(rules)){if(rule instanceof CSSStyleRule)styles.push({rule,style:rule.style,selector:rule.selectorText,text:rule.style.cssText});if('cssRules'in rule)visitRules((rule as CSSGroupingRule).cssRules)}}
  for(const sheet of Array.from(document.styleSheets))visitRules(sheet.cssRules)
  const cssom=()=>Array.from(document.styleSheets).map(sheet=>Array.from(sheet.cssRules).map(rule=>rule.cssText))
  const cssomBefore=cssom()
  return {before,cssomBefore,count:()=>mutations.length,finish:()=>{record(watching.takeRecords());watching.disconnect();const current=nodes();return{after:raw(),mutations,cssomAfter:cssom(),focusSame:focus===document.activeElement,nodeIdentitiesSame:current.length===originalNodes.length&&current.every((node,index)=>node===originalNodes[index]),styleObjectsSame:styles.every(item=>item.rule.style===item.style&&item.rule.selectorText===item.selector&&item.rule.style.cssText===item.text)}}}
 },{selector:contract.selector})
 const before=await captureEditorSkin(page,contract.selector,contract.families,contract.additionalCaptureProperties??[],true,contract.captureRootSelector)
 expect(before.length).toBeGreaterThan(0)
 // Source witnesses include active/conditional families and pseudo origins.
 // The common static probe remains unchanged and owns its full classifier QA.
 const sources=await page.evaluate(({selector,families,guards,ownerFilter,ownerSelectors,extra,excluded})=>{
  const normalize=(value:string)=>value.replace(/,\s*/g,',').replace(/"/g,"'")
  const familySet=new Set(families.map(normalize)),guardSet=new Set(guards.map(normalize)),owners=new Set(ownerSelectors.map(normalize))
  const split=(value:string)=>{const result:string[]=[];let depth=0,quote='',start=0;for(let i=0;i<value.length;i++){const c=value[i]!;if(quote){if(c===quote&&value[i-1]!=='\\')quote=''}else if(c==='"'||c==="'")quote=c;else if(c==='(')depth++;else if(c===')')depth--;else if(c===','&&depth===0){result.push(value.slice(start,i).trim());start=i+1}}result.push(value.slice(start).trim());return result}
  const strip=(value:string)=>{let i=0;while((i=value.indexOf(':where(',i))>=0){let end=i+7,depth=1,quote='';for(;end<value.length&&depth;end++){const c=value[end]!;if(quote){if(c===quote&&value[end-1]!=='\\')quote=''}else if(c==='"'||c==="'")quote=c;else if(c==='(')depth++;else if(c===')')depth--}if(guardSet.has(normalize(value.slice(i,end))))value=value.slice(0,i)+value.slice(end);else i=end}return normalize(value)}
  const targets=Array.from(document.querySelectorAll(selector)),observed=new Set(targets.flatMap(node=>[node,...node.querySelectorAll('*')]))
  for(const node of [...observed])for(let p=node.parentElement;p;p=p.parentElement)observed.add(p)
  const unsupported:string[]=[]
  const query=(value:string)=>{try{return Array.from(document.querySelectorAll(value.replace(/::[\w-]+(?:\([^)]*\))?$/,''))).filter(node=>observed.has(node))}catch(error){if(CSS.supports('selector('+value+')'))throw error;unsupported.push(value);return []}}
  const neutralStyle=document.createElement('span').style;neutralStyle.border='0'
  const paint=(property:string,value:string,style:CSSStyleDeclaration)=>!excluded.includes(property)&&!(property.startsWith('font')&&(property==='font-variant-numeric'||value.trim()==='inherit'))&&(/^(?:color|background(?:-.+)?|border(?:-.+)?|box-shadow|font(?:-.+)?|letter-spacing|text-transform|text-decoration(?:-.+)?|opacity)$/.test(property)||extra.includes(property))&&!(/^border/.test(property)&&/^(?:0(?:px)?|none)$/.test(value))&&!(property.startsWith('border')&&Array.from(neutralStyle).includes(property)&&value===neutralStyle.getPropertyValue(property)&&(style.getPropertyValue('border')===neutralStyle.getPropertyValue('border')||['top','right','bottom','left'].some(side=>property.startsWith('border-'+side+'-')&&style.getPropertyValue('border-'+side)===neutralStyle.getPropertyValue('border-'+side))))
  const intersections:{selector:string;family:string;active:boolean;nativeNodes:number;liveNodes:number;ownedNativeNodes:number;ownedLiveNodes:number;declarations:{property:string;value:string;priority:string}[]}[]=[],ownerDefinitions=new Set<string>(),matchedOwners=new Set<string>()
  const visit=(rules:CSSRuleList,active:boolean)=>{for(const rule of Array.from(rules)){
   if(rule instanceof CSSStyleRule)for(const branch of split(rule.selectorText)){
    if(owners.has(normalize(branch))){ownerDefinitions.add(normalize(branch));if(query(branch).length)matchedOwners.add(normalize(branch))}
    const family=strip(branch);if(!familySet.has(family))continue
    const declarations=Array.from(rule.style).filter(property=>paint(property,rule.style.getPropertyValue(property),rule.style)).map(property=>({property,value:rule.style.getPropertyValue(property),priority:rule.style.getPropertyPriority(property)}));if(!declarations.length)continue
    const native=query(family),live=query(branch);if(!native.length)continue
    intersections.push({selector:branch,family,active,nativeNodes:native.length,liveNodes:live.length,ownedNativeNodes:native.filter(node=>node.matches(ownerFilter)).length,ownedLiveNodes:live.filter(node=>node.matches(ownerFilter)).length,declarations})
   }
   if('cssRules'in rule)visit((rule as CSSGroupingRule).cssRules,active&&(!(rule instanceof CSSMediaRule)||matchMedia(rule.conditionText).matches)&&(!(rule instanceof CSSSupportsRule)||CSS.supports(rule.conditionText)))
  }}
  for(const sheet of Array.from(document.styleSheets))visit(sheet.cssRules,!sheet.disabled&&(!sheet.media.mediaText||matchMedia(sheet.media.mediaText).matches))
  return{intersections,unsupported,ownerDefinitions:[...ownerDefinitions].sort(),matchedOwners:[...matchedOwners].sort()}
 },{selector:contract.selector,families:contract.families,guards:[contract.migrationGuard,...contract.knownGuards],ownerFilter:contract.ownerFilter,ownerSelectors:contract.ownerSelectors,extra:contract.additionalPaintProperties??[],excluded:contract.excludedPaintProperties??[]})
 await page.screenshot({path:screenshot,animations:'allow',caret:'initial'})
 // Observe at least one genuine timer tick rather than freezing it or hoping
 // that an entire capture finishes between two ticks.
 await expect.poll(()=>observer.evaluate(value=>value.count()),{timeout:2500}).toBeGreaterThan(0)
 const after=await captureEditorSkin(page,contract.selector,contract.families,contract.additionalCaptureProperties??[],true,contract.captureRootSelector)
 const initial=await observer.evaluate(value=>({before:value.before,cssomBefore:value.cssomBefore})),finished=await observer.evaluate(value=>value.finish())
 await observer.dispose()
 const raw={...initial,...finished,beforeComputed:before,afterComputed:after,sources}
 await writeFile(screenshot+'.dynamic.json',JSON.stringify(raw,null,2))
 expect(after).toEqual(before);expect(finished.cssomAfter).toEqual(initial.cssomBefore);expect(finished.styleObjectsSame).toBe(true);expect(finished.focusSame).toBe(true);expect(finished.nodeIdentitiesSame).toBe(true)
 expect(finished.after.scroll).toEqual(initial.before.scroll);expect(finished.after.viewport).toEqual(initial.before.viewport);expect(finished.after.focusTag).toBe(initial.before.focusTag)
 expect(finished.after.nodes).toHaveLength(initial.before.nodes.length)
 const elapsed=(label:string)=>{const match=/^Завершить голосовой ввод, (\d+):([0-5]\d)$/.exec(label);expect(match).not.toBeNull();return Number(match![1])*60+Number(match![2])}
 const timerBefore=initial.before.nodes.filter(node=>node.timer),timerAfter=finished.after.nodes.filter(node=>node.timer);expect(timerBefore).toHaveLength(1);expect(timerAfter).toHaveLength(1)
 for(let i=0;i<initial.before.nodes.length;i++){
  const previous=initial.before.nodes[i]!,next=finished.after.nodes[i]!
  expect({index:next.index,type:next.type,name:next.name,value:next.value,timer:next.timer}).toEqual({index:previous.index,type:previous.type,name:previous.name,value:previous.value,timer:previous.timer})
  expect(next.attributes).toHaveLength(previous.attributes.length)
  for(let j=0;j<previous.attributes.length;j++){
   const prior=previous.attributes[j]!,current=next.attributes[j]!;expect(current[0]).toBe(prior[0])
   if(previous.timer&&prior[0]==='aria-label')expect(elapsed(current[1]!)).toBeGreaterThanOrEqual(elapsed(prior[1]!));else expect(current).toEqual(prior)
  }
 }
 let seconds=elapsed(timerBefore[0]!.attributes.find(attr=>attr[0]==='aria-label')![1]!)
 for(const change of finished.mutations){expect(change.timer).toBe(true);expect(change.type).toBe('attributes');expect(change.attribute).toBe('aria-label');expect(elapsed(change.old!)).toBe(seconds);expect(elapsed(change.value!)).toBe(++seconds)}
 expect(seconds).toBe(elapsed(timerAfter[0]!.attributes.find(attr=>attr[0]==='aria-label')![1]!));expect(finished.mutations.length).toBeGreaterThan(0)
 expect(sources.intersections.some(item=>item.ownedNativeNodes>0)).toBe(true)
 if(baseline){expect(sources.matchedOwners).toEqual([]);expect(sources.intersections.some(item=>item.ownedLiveNodes>0)).toBe(true)}
 else{expect(sources.ownerDefinitions).toHaveLength(contract.ownerSelectors.length);expect(sources.matchedOwners.length).toBeGreaterThan(0);expect(sources.intersections.filter(item=>item.ownedLiveNodes>0)).toEqual([])}
 return {state:'voice-recording',qualification:'Dynamic recording DOM: only the Stop accessible elapsed label may tick; no static-DOM claim',rawPath:screenshot+'.dynamic.json',screenshot,beforeComputed:before,afterComputed:after,domBefore:initial.before,domAfter:finished.after,timeline:finished.mutations,sources,focusIdentityPreserved:finished.focusSame,nodeIdentitiesPreserved:finished.nodeIdentitiesSame,cssomNeverMutated:true,styleObjectsUnchanged:true,computedGeometryInputScrollExact:true}
}
