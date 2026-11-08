import { expect, type Page } from '@playwright/test'

// Flush the actual focus/font/finite-animation state; never freeze product CSS.
export async function settleCompletionPaint(page: Page, selector: string) {
  await page.evaluate(async selector => {
    const deadline = performance.now() + 5000
    const bounded = async <T>(work: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([work, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Completion paint did not settle within 5000 ms')), Math.max(0, deadline - performance.now()))
        })])
      } finally { clearTimeout(timer) }
    }
    await bounded(document.fonts.ready)
    let quietFrames = 0
    while (quietFrames < 2) {
      await bounded(new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      for (const node of document.querySelectorAll(selector)) { getComputedStyle(node).getPropertyValue('outline-offset'); node.getBoundingClientRect() }
      const active = document.getAnimations().filter(animation =>
        (animation.playState === 'running' || animation.pending) &&
        Number.isFinite(animation.effect?.getTiming().iterations) &&
        Number.isFinite(animation.effect?.getComputedTiming().endTime)
      )
      if (active.length) {
        quietFrames = 0
        // A finished/cancelled animation can start another one; rescan next frame.
        await bounded(Promise.all(active.map(animation => animation.finished.catch(error => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
        }))))
      } else quietFrames++
    }
  }, selector)
}

// MC4.4 only: the shared ownership probe keeps original CSSRule/style objects.
export async function probeCompletionSkin(page: Page, selector: string, stems: string[], screenshot?: string) {
  const capture = () => page.locator('.phone-frame').evaluate((root, selector) => {
    const properties = ['display','position','color','background-color','font-family','font-size','font-weight','line-height','width','height','min-width','min-height','max-height','gap','grid-template-columns','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','border-top-width','border-top-color','border-top-style','border-right-width','border-right-color','border-right-style','border-bottom-width','border-bottom-color','border-bottom-style','border-left-width','border-left-color','border-left-style','border-radius','box-shadow','outline-color','outline-width','outline-style','outline-offset','overflow-x','overflow-y','scroll-snap-type','touch-action','animation-name','animation-duration','transition-property','transition-duration','opacity','align-items','justify-content']
    const targets = Array.from(root.querySelectorAll(selector)), nodes = [...new Set(targets.flatMap(node => [node,...node.querySelectorAll('*')]))]
    return nodes.map(node => { const css=getComputedStyle(node),r=node.getBoundingClientRect();return {tag:node.tagName,class:node.getAttribute('class')||'',style:Object.fromEntries(properties.map(property=>[property,css.getPropertyValue(property)])),rect:[r.x,r.y,r.width,r.height].map(value=>Math.round(value*100)/100)} })
  }, selector)
  const cssom = () => page.evaluate(() => Array.from(document.styleSheets).map(sheet => Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n')))
  const state = () => page.evaluate(selector => {
    const active=document.activeElement
    const elements=[document.scrollingElement,...document.querySelectorAll('.content,'+selector)].filter((node):node is HTMLElement=>node instanceof HTMLElement)
    return {focus:active?{tag:active.tagName,id:active.id,class:active.className,role:active.getAttribute('role'),text:active.textContent}:null,scroll:elements.map(node=>({tag:node.tagName,class:node.className,x:node.scrollLeft,y:node.scrollTop,height:node.scrollHeight,client:node.clientHeight})),anchor:Array.from(document.querySelectorAll<HTMLElement>('.content')).map(node=>({style:node.getAttribute('style'),value:node.style.getPropertyValue('overflow-anchor'),priority:node.style.getPropertyPriority('overflow-anchor'),computed:getComputedStyle(node).overflowAnchor}))}
  }, selector)
  await settleCompletionPaint(page,selector)
  const before=await capture();expect(before.length).toBeGreaterThan(0)
  const cssomBefore=await cssom(),stateBefore=await state()
  const backdrop=await page.locator(selector).evaluate(element=>element instanceof HTMLDialogElement?getComputedStyle(element,'::backdrop').backgroundColor:null)
  const frameBackground=await page.locator('.phone-frame').evaluate(element=>getComputedStyle(element).backgroundColor)
  if(screenshot)await page.screenshot({path:screenshot,animations:'disabled'})
  expect(await capture()).toEqual(before)
  const ablation=await page.evaluateHandle(({selector,stems})=>{
    const common=new Set(stems),visual=/^(?:color|background(?:-.+)?|border(?:-.+)?|box-shadow|font-(?:family|size|weight)|outline(?:-.+)?|animation)$/
    const strip=(selector:string)=>{
      while(selector.includes(':where(:not(')){const start=selector.indexOf(':where(:not(');let end=start+7,depth=1;while(depth&&end<selector.length){if(selector[end]==='(')depth++;if(selector[end]===')')depth--;end++}selector=selector.slice(0,start)+selector.slice(end)}
      return selector.replace(/"/g,"'")
    }
    const branches=(text:string)=>{const list:string[]=[];let depth=0,quote='',start=0;for(let i=0;i<text.length;i++){const char=text[i]!;if(quote){if(char===quote&&text.charCodeAt(i-1)!==92)quote='';continue}if(char==='"'||char==="'")quote=char;else if(char==='('||char==='[')depth++;else if(char===')'||char===']')depth--;else if(char===','&&!depth){list.push(text.slice(start,i).trim());start=i+1}}list.push(text.slice(start).trim());return list}
    const changed:{rule:CSSStyleRule;selectors:string[];selected:string[]}[]=[]
    const visit=(rules:CSSRuleList)=>{for(const rule of Array.from(rules)){if(rule instanceof CSSStyleRule){const selectors=branches(rule.selectorText),selected=selectors.filter(selector=>common.has(strip(selector))&&Array.from(rule.style).some(property=>visual.test(property)));if(selected.length)changed.push({rule,selectors,selected})}if('cssRules'in rule)visit((rule as CSSGroupingRule).cssRules)}}
    for(const sheet of Array.from(document.styleSheets))visit(sheet.cssRules)
    const selected=changed.flatMap(item=>item.selected),matches=selected.filter(selector=>document.querySelector(selector))
    const legacyMatches=selected.every(selector=>{const old=Array.from(document.querySelectorAll(strip(selector))),current=Array.from(document.querySelectorAll(selector));return old.length===current.length&&old.every((node,i)=>node===current[i])})
    const probe=document.createElement('style');probe.textContent=matches.map(selector=>selector+'{--mc44-legacy-completion-probe:legacy}').join(' ');document.head.append(probe)
    const inherited=Array.from(document.querySelectorAll(selector+','+selector+' *')).filter(node=>getComputedStyle(node).getPropertyValue('--mc44-legacy-completion-probe').trim()==='legacy').length;probe.remove()
    const anchorStyle=document.createElement('style');anchorStyle.textContent='.content{overflow-anchor:none!important}';document.head.append(anchorStyle)
    const scroll=Array.from(document.querySelectorAll<HTMLElement>('*')).map(node=>({node,x:node.scrollLeft,y:node.scrollTop}))
    const restore:{rule:CSSStyleRule;selector:string;text:string}[]=[],clones:{parent:CSSStyleSheet|CSSGroupingRule;rule:CSSRule}[]=[]
    for(const {rule,selectors,selected} of changed){
      if(!selected.some(selector=>document.querySelector(selector)))continue
      const selector=rule.selectorText,text=rule.style.cssText,retained=selectors.filter(branch=>!selected.includes(branch))
      rule.selectorText=retained.length?retained.join(', '):':not(*)'
      const neutral=Array.from(rule.style).filter(property=>!visual.test(property)).map(property=>property+':'+rule.style.getPropertyValue(property)+(rule.style.getPropertyPriority(property)?'!important':'')).join(';')
      if(neutral){const parent=(rule.parentRule??rule.parentStyleSheet) as CSSGroupingRule,index=Array.from(parent.cssRules).indexOf(rule);parent.insertRule(selected.join(', ')+'{'+neutral+'}',index+1);clones.push({parent,rule:parent.cssRules[index+1]!})}
      restore.push({rule,selector,text})
    }
    return {rules:changed.length,families:[...new Set(selected.map(strip))],matches,inherited,legacyMatches,selectedPositiveOwners:selected.filter(selector=>strip(selector).includes(':where(')),restore,clones,scroll,anchorStyle}
  },{selector,stems})
  const result=await ablation.evaluate(value=>({rules:value.rules,families:value.families,matches:value.matches,inherited:value.inherited,legacyMatches:value.legacyMatches,selectedPositiveOwners:value.selectedPositiveOwners}))
  expect(result.selectedPositiveOwners).toEqual([])
  await settleCompletionPaint(page,selector)
  const after=await capture()
  const restoration=await ablation.evaluate(async({restore,clones,scroll})=>{
    for(const saved of restore)saved.rule.selectorText=saved.selector
    for(const {parent,rule} of clones){const index=Array.from(parent.cssRules).indexOf(rule);if(index<0)throw Error('Neutral clone missing');parent.deleteRule(index)}
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
    for(const {node,x,y} of scroll){node.scrollLeft=x;node.scrollTop=y}
    return restore.every(saved=>saved.rule.selectorText===saved.selector&&saved.rule.style.cssText===saved.text)
  })
  await settleCompletionPaint(page,selector)
  await ablation.evaluate(({anchorStyle})=>anchorStyle.remove());await ablation.dispose()
  await settleCompletionPaint(page,selector)
  expect(restoration).toBe(true);expect(await cssom()).toEqual(cssomBefore);expect(await state()).toEqual(stateBefore);expect(await capture()).toEqual(before)
  expect(await page.locator(selector).evaluate(element=>element instanceof HTMLDialogElement?getComputedStyle(element,'::backdrop').backgroundColor:null)).toBe(backdrop)
  expect(after).toHaveLength(before.length)
  const differences=before.flatMap((a,i)=>{const b=after[i]!,changes=Object.fromEntries(Object.keys(a.style).filter(property=>a.style[property]!==b.style[property]).map(property=>[property,[a.style[property],b.style[property]]]));return Object.keys(changes).length||JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[{tag:a.tag,class:a.class,changes,rect:JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[a.rect,b.rect]:undefined}]:[]})
  return {before,backdrop,frameBackground,...result,restoration,cssomRoundTrip:true,focusScrollAnchorRoundTrip:true,differences,stateBefore}
}
