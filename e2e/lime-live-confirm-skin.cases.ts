import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'

// Check the real cascade, including the portal sheet, instead of checking class names.
export function limeLiveConfirmSkinCases() {
  const samples = (['client', 'trainer'] as const).flatMap(role => (role === 'client' ? ['light', 'dark'] : ['dark']).flatMap(theme =>
    ['original', 'compact'].flatMap(density => ['sheet'].map(state => ({ role, theme, density, state, lime: true, width: theme === 'light' ? 390 : 430 })))))
  for (const role of ['client', 'trainer'] as const) {
    samples.push({ role, theme: 'dark', density: 'compact', state: 'sheet', lime: true, width: 375 })
    samples.push({ role, theme: 'dark', density: 'original', state: 'sheet', lime: false, width: 390 })
  }
  samples.push({ role: 'trainer', theme: 'dark', density: 'original', state: 'sheet', lime: true, width: 1440 })
  for (const sample of samples) test('Live Lime confirm skin ownership ' + Object.values(sample).join('-'), async ({ page, browserName }, info) => {
    const errors: string[] = []
    const requests: string[] = []
    const responses: string[] = []
    page.on('response', response => { if (response.status() >= 400) responses.push(String(response.status()) + ' ' + new URL(response.url()).pathname) })
    const consoleErrors: string[] = []
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text() + ' ' + message.location().url) })
    page.on('pageerror', error => errors.push(error.message))
    page.on('requestfailed', request => requests.push(new URL(request.url()).pathname))
    const id = !sample.lime ? '10000000-0000-4000-8000-000000000001' : sample.role === 'client' ? 'c11e0000-6010-4000-8000-000000000001' : 'c0ac0000-6010-4000-8000-000000000001'
    const now = Date.parse('2026-11-06T09:00:00Z')
    await page.setViewportSize({ width: sample.width, height: sample.width === 375 ? 667 : sample.width === 1440 ? 1000 : 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.setFixedTime(new Date(now))
    await page.addInitScript(({ id, sample, now, workoutId }) => {
      localStorage.setItem('fit.workoutTimeWheel', 'true')
      localStorage.setItem('fit.appTheme', sample.theme)
      localStorage.setItem('fit.clientLime.theme.' + id, sample.theme)
      localStorage.setItem('fit.clientLiveDensity.' + id, sample.density)
      localStorage.setItem('fit.coachLiveDensity.' + id, sample.density)
      localStorage.setItem('fit.liveExerciseAnimation.' + id, 'false')
      sessionStorage.setItem('fit:live-rest-until:' + workoutId, String(now + 90000))
    }, { id, sample, now, workoutId })
    const source = restTimerWorkout()
    source.exercises[0]!.sets[1]!.fact = { weightKg: 20, reps: 10 }
    source.exercises[0]!.sets[1]!.confirmedAt = '2026-11-06T08:59:00Z'
    source.startedAt = new Date(now - 120000).toISOString()
    source.createdBy = id
    if (sample.role === 'trainer') source.trainerId = id
    const backend = await mockPilot(page, { role: sample.role, profileId: id, clientLime: sample.lime && sample.role === 'client', fitLime: sample.lime && sample.role === 'trainer', workouts: [source] })
    // These unrelated background APIs are absent from mockPilot's default fixture.
    // Give them real schema-shaped local responses so console assertions stay strict.
    await page.route('**/v1/push-notifications/status', route => route.fulfill({ json: { status: { subscribed: false, preferences: { workout_reminder: true, workout_scheduled: true, chat_message: true } } } }))
    await page.route('**/v1/exercise-media/sign-batch', route => {
      const { paths } = route.request().postDataJSON() as { paths: string[] }
      return route.fulfill({ json: { signedUrls: paths.map(path => ({ path, signedUrl: new URL('/exercises/vital/air-bike-sprint.jpg', page.url()).href })) } })
    })
    await page.goto('/workouts/' + workoutId + '/live')
    await expect(page.locator('form[data-live-set-id]').first()).toBeVisible()
    if (sample.lime) {
      await expect(page.locator('.live-workout-page')).toHaveClass(/(?:coach|client)-live-v79/)
      await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    } else await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-lime-shell/)
    const initialFacts = JSON.stringify(backend.getWorkouts()[0]!.exercises)
    const menuTrigger = page.locator(sample.lime ? '.live-exercise' : '.live-exercise-head').first().getByRole('button', { name: 'Ещё действия', exact: true })
    await menuTrigger.click()
    await page.getByRole('menuitem', { name: 'Удалить упражнение', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    const confirm = dialog.getByRole('button', { name: 'Удалить', exact: true })
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    // Wait for the opening/menu frame, then check natural autofocus separately.
    await expect(confirm).toBeFocused()
    // macOS WebKit uses Option-Tab to include native buttons in keyboard traversal.
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused()
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
    await expect(confirm).toBeFocused()
    await expect(confirm).toHaveCSS('outline-width', '2px')
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const capture = () => page.locator('.phone-frame').evaluate(root => {
      const properties = ['display','position','color','background-color','font-family','font-size','font-weight','line-height','width','height','min-width','min-height','max-height','gap','grid-template-columns','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-bottom','border-top-width','border-top-color','border-top-style','border-right-width','border-right-color','border-right-style','border-bottom-width','border-bottom-color','border-bottom-style','border-left-width','border-left-color','border-left-style','border-radius','box-shadow','outline-color','outline-width','outline-style','outline-offset','overflow-x','overflow-y','scroll-snap-type','touch-action','animation-name','animation-duration','transition-property','transition-duration','stroke-width','filter','backdrop-filter','opacity','align-items','justify-content']
      const targets = Array.from(root.querySelectorAll('.modal-overlay'))
      const nodes = [...new Set(targets.flatMap(node => [node,...node.querySelectorAll('*')]))]
      return nodes.map(node => { const css=getComputedStyle(node),r=node.getBoundingClientRect();return {tag:node.tagName,class:node.getAttribute('class')||'',style:Object.fromEntries(properties.map(p=>[p,css.getPropertyValue(p)])),rect:[r.x,r.y,r.width,r.height].map(v=>Math.round(v*100)/100)} })
    })
    const cssom=()=>page.evaluate(()=>Array.from(document.styleSheets).map(sheet=>Array.from(sheet.cssRules).map(rule=>rule.cssText).join('\n')))
    const anchorSnapshot=()=>page.locator('.content').evaluate(element=>{const node=element as HTMLElement;return {style:node.getAttribute('style'),value:node.style.getPropertyValue('overflow-anchor'),priority:node.style.getPropertyPriority('overflow-anchor'),computed:getComputedStyle(node).getPropertyValue('overflow-anchor')}})
    const cssomBefore=await cssom(),anchorBefore=await anchorSnapshot()
    const before = await capture()
    expect(before.length).toBeGreaterThan(0)
    const frameBackground=await page.locator('.phone-frame').evaluate(element=>getComputedStyle(element).backgroundColor)
    if (sample.lime && (sample.state === 'sheet' || sample.state === 'overdue')) await page.screenshot({ path: info.outputPath('confirm-skin.png'), animations: 'disabled' })
    const ablation = await page.evaluateHandle(() => {
      const common = new Set(['.modal-overlay', '.modal-dialog', '.modal-message', '.modal-dialog .actions .danger', '.live-identity .modal-overlay', '.live-identity .modal-dialog', '.live-identity .modal-message', '.ui-identity .modal-overlay', '.ui-identity .modal-dialog', '.ui-identity .modal-message', '.ui-identity .modal-dialog .actions button', '.ui-identity .modal-dialog .actions .danger'])
      const visual = /^(?:color|background(?:-.+)?|border(?:-.+)?|box-shadow|font-(?:family|size|weight)|outline(?:-.+)?|animation)$/
      const strip = (selector: string) => {
        while (selector.includes(':where(:not(')) {
          const start = selector.indexOf(':where(:not(')
          let end = start + 7, depth = 1
          while (depth && end < selector.length) { if (selector[end] === '(') depth++; if (selector[end] === ')') depth--; end++ }
          selector = selector.slice(0, start) + selector.slice(end)
        }
        return selector.replace(/"/g, "'")
      }
      // Commas inside :has/:is/attribute values are not selector-list separators.
      const branches = (text: string) => {
        const list: string[] = []
        let depth = 0, quote = '', start = 0
        for (let i = 0; i < text.length; i++) {
          const char = text[i]!
          if (quote) { if (char === quote && text.charCodeAt(i - 1) !== 92) quote = ''; continue }
          if (char === '"' || char === "'") quote = char
          else if (char === '(' || char === '[') depth++
          else if (char === ')' || char === ']') depth--
          else if (char === ',' && !depth) { list.push(text.slice(start, i).trim()); start = i + 1 }
        }
        list.push(text.slice(start).trim())
        return list
      }
      const changed: { rule: CSSStyleRule; selectors: string[]; selected: string[] }[] = []
      const visit = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule) {
            const selectors = branches(rule.selectorText)
            const selected = selectors.filter(selector => {
              const original = strip(selector)
              return common.has(original) && Array.from(rule.style).some(p => visual.test(p))
            })
            if (selected.length) changed.push({ rule, selectors, selected })
          }
          if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
        }
      }
      for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules)
      const selected = changed.flatMap(item => item.selected)
      const matches = selected.filter(selector => document.querySelector(selector))
      const legacyMatches = selected.every(selector => {
        const previous = Array.from(document.querySelectorAll(strip(selector))), current = Array.from(document.querySelectorAll(selector))
        return previous.length === current.length && previous.every((node, i) => node === current[i])
      })
      const probe = document.createElement('style')
      probe.textContent = matches.map(selector => selector + ' { --mc43-legacy-confirm-probe: legacy; }').join(' ')
      document.head.append(probe)
      const inherited = Array.from(document.querySelectorAll('.modal-overlay,.modal-overlay *')).filter(node => getComputedStyle(node).getPropertyValue('--mc43-legacy-confirm-probe').trim() === 'legacy').length
      probe.remove()
      // Original declaration objects stay untouched, including var() shorthands.
      const anchorStyle=document.createElement('style')
      anchorStyle.textContent='.content { overflow-anchor: none !important; }'
      document.head.append(anchorStyle)
      const scroll=Array.from(document.querySelectorAll<HTMLElement>('*')).map(node=>({node,x:node.scrollLeft,y:node.scrollTop}))
      const restore: { rule:CSSStyleRule;selector:string;text:string }[]=[]
      const clones: { parent:CSSStyleSheet|CSSGroupingRule;rule:CSSRule }[]=[]
      for(const {rule,selectors,selected} of changed){
        if(!selected.some(selector=>document.querySelector(selector)))continue
        const selector=rule.selectorText,text=rule.style.cssText
        const retained=selectors.filter(branch=>!selected.includes(branch))
        rule.selectorText=retained.length?retained.join(', '):':not(*)'
        // Preserve only the exact original neutral layout for selected branches.
        const layout=Array.from(rule.style).filter(property=>!visual.test(property)).map(property=>property+':'+rule.style.getPropertyValue(property)+(rule.style.getPropertyPriority(property)?' !important':'')).join(';')
        if(layout){
          const parent=(rule.parentRule??rule.parentStyleSheet) as CSSGroupingRule
          const index=Array.from(parent.cssRules).indexOf(rule)
          parent.insertRule(selected.join(', ')+'{'+layout+'}',index+1)
          clones.push({parent,rule:parent.cssRules[index+1]!})
        }
        restore.push({rule,selector,text})
      }
      const selectedPositiveOwners=selected.filter(selector=>strip(selector).includes(':where('))
      return {rules:changed.length,families:[...new Set(selected.map(strip))],matches,inherited,legacyMatches,selectedPositiveOwners,restore,clones,scroll,anchorStyle}
    })
    const result=await ablation.evaluate(value=>({rules:value.rules,families:value.families,matches:value.matches,inherited:value.inherited,legacyMatches:value.legacyMatches,selectedPositiveOwners:value.selectedPositiveOwners}))
    expect(result.selectedPositiveOwners).toEqual([])
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
    const after=await capture()
    const restoration=await ablation.evaluate(async({restore,clones,scroll})=>{
      for(const saved of restore)saved.rule.selectorText=saved.selector
      for(const {parent,rule} of clones){const index=Array.from(parent.cssRules).indexOf(rule);if(index<0)throw new Error('Neutral clone missing');parent.deleteRule(index)}
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
      for(const {node,x,y} of scroll){node.scrollLeft=x;node.scrollTop=y}
      return restore.every(saved=>saved.rule.selectorText===saved.selector&&saved.rule.style.cssText===saved.text)
    })
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
    await ablation.evaluate(({anchorStyle})=>anchorStyle.remove())
    await ablation.dispose()
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
    expect(restoration).toBe(true)
    expect(await cssom()).toEqual(cssomBefore)
    expect(await anchorSnapshot()).toEqual(anchorBefore)
    expect(await capture()).toEqual(before)
    expect(after).toHaveLength(before.length)
    const differences=before.flatMap((a,i)=>{const b=after[i]!;const changes=Object.fromEntries(Object.keys(a.style).filter(p=>a.style[p]!==b.style[p]).map(p=>[p,[a.style[p],b.style[p]]]));return Object.keys(changes).length||JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[{tag:a.tag,class:a.class,changes,rect:JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[a.rect,b.rect]:undefined}]:[]})
    await writeFile(info.outputPath('confirm-skin.json'),JSON.stringify({sample,before,frameBackground,...result,restoration,cssomRoundTrip:true,anchorRoundTrip:true,differences,errors,requests,consoleErrors,responses},null,2))
    expect(errors).toEqual([])
    expect(requests).toEqual([])
    expect(responses).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(result.families).toHaveLength(12)
    if(sample.lime){expect(result.matches).toEqual([]);expect(result.inherited).toBe(0);expect(differences).toEqual([])}
    else{expect(result.matches.length).toBeGreaterThan(0);expect(result.legacyMatches).toBe(true);expect(differences.length).toBeGreaterThan(0)}
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(initialFacts)
    // Escape is one behavior case per role/engine; the other samples check paint only.
    if (sample.lime && sample.density === 'original' && (sample.theme === 'light' || sample.role === 'trainer') && sample.width < 500) {
      await menuTrigger.click()
      await page.getByRole('menuitem', { name: 'Удалить упражнение', exact: true }).click()
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(initialFacts)
    }
    expect(errors).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(requests).toEqual([])
    expect(responses).toEqual([])
  })

  // Native done-detail shares modal paint but has no modern Live descendant.
  // One client theme and trainer desktop catch the :has boundary without a new matrix.
  for(const role of ['client','trainer'] as const)test('NonLive Lime confirm guard control '+role,async({page,browserName},info)=>{
    const id=role==='client'?'c11e0000-6010-4000-8000-000000000001':'c0ac0000-6010-4000-8000-000000000001'
    const errors:string[]=[],requests:string[]=[],responses:string[]=[],consoleErrors:string[]=[]
    page.on('pageerror',error=>errors.push(error.message))
    page.on('requestfailed',request=>requests.push(new URL(request.url()).pathname))
    page.on('response',response=>{if(response.status()>=400)responses.push(response.status()+' '+new URL(response.url()).pathname)})
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text()+' '+message.location().url)})
    await page.setViewportSize({width:role==='client'?390:1440,height:role==='client'?844:1000})
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.clock.setFixedTime(new Date('2026-11-06T09:00:00Z'))
    await page.addInitScript(({id,role})=>{localStorage.setItem('fit.appTheme',role==='client'?'light':'dark');localStorage.setItem('fit.clientLime.theme.'+id,'light')},{id,role})
    const source=restTimerWorkout();source.status='done';source.startedAt='2026-11-06T07:00:00Z';source.completedAt='2026-11-06T09:00:00Z';source.actualDurationSec=7200;source.createdBy=id
    if(role==='trainer')source.trainerId=id
    const backend=await mockPilot(page,{role,profileId:id,clientLime:role==='client',fitLime:role==='trainer',workouts:[source]})
    await page.route('**/v1/push-notifications/status',route=>route.fulfill({json:{status:{subscribed:false,preferences:{workout_reminder:true,workout_scheduled:true,chat_message:true}}}}))
    await page.route('**/v1/exercise-media/sign-batch',route=>{const {paths}=route.request().postDataJSON() as {paths:string[]};return route.fulfill({json:{signedUrls:paths.map(path=>({path,signedUrl:new URL('/exercises/vital/air-bike-sprint.jpg',page.url()).href}))}})})
    await page.goto('/workouts/'+workoutId)
    const frame=page.locator('.phone-frame');await expect(frame).toHaveClass(/fit-lime-shell/)
    await expect(page.locator('.coach-live-v79,.client-live-v79')).toHaveCount(0)
    if(role==='trainer')await page.locator('.coach-workout-summary > summary').click()
    const trigger=page.getByRole('button',{name:'Изменить длительность',exact:true})
    const facts=JSON.stringify(backend.getWorkouts()[0]!.exercises),version=backend.getWorkouts()[0]!.version
    const writes:unknown[]=[]
    page.on('request',request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.endsWith('/duration'))writes.push(request.postDataJSON() as unknown)})
    const rawScroll=()=>page.locator('.content').evaluate(node=>({y:node.scrollTop,height:node.scrollHeight,clientHeight:node.clientHeight}))
    const initialScroll=await rawScroll()
    await trigger.click()
    const dialog=page.getByRole('dialog',{name:'Длительность тренировки',exact:true}),input=dialog.getByRole('textbox')
    await expect(input).toHaveValue('120');await expect(input).toBeFocused()
    await page.keyboard.press(browserName==='webkit'?'Alt+Tab':'Tab')
    await expect(dialog.getByRole('button',{name:'Отмена',exact:true})).toBeFocused()
    await page.keyboard.press(browserName==='webkit'?'Alt+Shift+Tab':'Shift+Tab')
    await expect(input).toBeFocused();await input.fill('77,5')
    await page.evaluate(()=>document.fonts.ready)
    await page.mouse.move(0,0)
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
    const before=await dialog.evaluate(root=>{
      const properties=['display','position','color','background-color','font-family','font-size','font-weight','line-height','width','height','min-width','min-height','max-height','gap','grid-template-columns','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-bottom','border-top-width','border-top-color','border-top-style','border-right-width','border-right-color','border-right-style','border-bottom-width','border-bottom-color','border-bottom-style','border-left-width','border-left-color','border-left-style','border-radius','box-shadow','outline-color','outline-width','outline-style','outline-offset','overflow-x','overflow-y','scroll-snap-type','touch-action','animation-name','animation-duration','transition-property','transition-duration','stroke-width','filter','backdrop-filter','opacity','align-items','justify-content']
      return [root,...root.querySelectorAll('*')].map(node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return {tag:node.tagName,class:node.getAttribute('class')||'',style:Object.fromEntries(properties.map(property=>[property,style.getPropertyValue(property)])),rect:[rect.x,rect.y,rect.width,rect.height].map(value=>Math.round(value*100)/100)}})
    })
    const matches=await page.evaluate(()=>{
      const common=new Set(['.modal-dialog','.ui-identity .modal-dialog','.ui-identity .modal-dialog .actions button']),found=new Set<string>()
      const strip=(selector:string)=>{while(selector.includes(':where(:not(')){const start=selector.indexOf(':where(:not(');let end=start+7,depth=1;while(depth){if(selector[end]==='(')depth++;if(selector[end]===')')depth--;end++}selector=selector.slice(0,start)+selector.slice(end)}return selector}
      const branches=(text:string)=>{const out:string[]=[];let depth=0,start=0;for(let i=0;i<text.length;i++){if(text[i]==='('||text[i]==='[')depth++;if(text[i]===')'||text[i]===']')depth--;if(text[i]===','&&!depth){out.push(text.slice(start,i).trim());start=i+1}}out.push(text.slice(start).trim());return out}
      const visit=(rules:CSSRuleList)=>{for(const rule of Array.from(rules)){if(rule instanceof CSSStyleRule&&Array.from(rule.style).some(property=>/^(color|background.*|border.*|box-shadow|font-(family|size|weight))$/.test(property))){for(const selector of branches(rule.selectorText)){const legacy=strip(selector);if(common.has(legacy)&&document.querySelector(selector))found.add(legacy)}}if('cssRules' in rule)visit((rule as CSSGroupingRule).cssRules)}}
      for(const sheet of Array.from(document.styleSheets))visit(sheet.cssRules)
      return [...found].sort()
    })
    expect(matches).toEqual(['.modal-dialog','.ui-identity .modal-dialog','.ui-identity .modal-dialog .actions button'])
    const backdrop=await dialog.evaluate(node=>getComputedStyle(node,'::backdrop').backgroundColor)
    await page.screenshot({path:info.outputPath('confirm-nonlive-control.png'),animations:'disabled'})
    await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused()
    await trigger.click();await expect(input).toHaveValue('120');await dialog.getByRole('button',{name:'Отмена',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused()
    const finalScroll=await rawScroll()
    expect(writes).toEqual([]);expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(facts);expect(backend.getWorkouts()[0]!.version).toBe(version);expect(backend.getWorkouts()[0]!.actualDurationSec).toBe(7200)
    await writeFile(info.outputPath('confirm-nonlive-control.json'),JSON.stringify({role,before,backdrop,matches,initialScroll,finalScroll,writes,errors,requests,responses,consoleErrors},null,2))
    expect(errors).toEqual([]);expect(requests).toEqual([]);expect(responses).toEqual([]);expect(consoleErrors).toEqual([])
  })
}
