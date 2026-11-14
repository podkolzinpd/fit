import {libraryMigrationGuard} from './lime-library-skin.contract'
import {editorMigrationGuard,editorOwnerFilter,editorOwnerSelectors} from './lime-editor-skin.contract'
import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'

// Reviewed bd928e07: all seven exact shared families carry paint; modern positive owners are separate identities.
const liveDurationManifest = {
  "families": [
    ".workout-decision-sheet",
    ".rest-time-wheel-field > span",
    ".rest-time-wheel",
    ".rest-time-wheel:focus-visible",
    ".rest-time-wheel [role='option']",
    ".rest-time-wheel [role='option'].selected",
    ".rest-time-separator"
  ],
  "paintFamilies": [
    ".rest-time-separator",
    ".rest-time-wheel",
    ".rest-time-wheel [role='option']",
    ".rest-time-wheel [role='option'].selected",
    ".rest-time-wheel-field > span",
    ".rest-time-wheel:focus-visible",
    ".workout-decision-sheet"
  ],
  "guards": [
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) :is(.live-rest-sheet,.workout-duration-sheet,.workout-live-exit-sheet)))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) :is(.live-rest-sheet,.workout-duration-sheet) .rest-time-wheel-field > span))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) :is(.live-rest-sheet,.workout-duration-sheet) .rest-time-wheel))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) :is(.live-rest-sheet,.workout-duration-sheet) .rest-time-wheel:focus-visible))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) :is(.live-rest-sheet,.workout-duration-sheet) .rest-time-wheel [role='option']))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) :is(.live-rest-sheet,.workout-duration-sheet) .rest-time-wheel [role='option'].selected))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) :is(.live-rest-sheet,.workout-duration-sheet) .rest-time-separator))"
  ]
}

// Exact pre-MC518 families, not optimizer CSSRule counts. MC518 may split a
// mixed rule or merge its paint with a positive editor owner in one CSSRule.
// Only reviewed negative migration guards are removed from branch identity.
export function ablateLiveSkinBranches(config: {families:string[];paintFamilies:string[];guards:string[];owners:string[];ownerScope:string;targets:string}) {
  const normalize=(s:string)=>{
    // CSS minification/serialization may elide combinator spaces and role quotes.
    // Canonicalize identity only; never remove an unreviewed :where() filter.
    s=s.replace(/,\s*/g,',').replace(/"/g,"'").replace(/\[role=option\]/g,"[role='option']").trim()
    let result='',quote=''
    for(let i=0;i<s.length;i++){const c=s[i]!;if(quote){result+=c;if(c===quote&&s.charCodeAt(i-1)!==92)quote='';continue}if(c==="'"||c==='"')quote=c;if(!quote&&/[>+~]/.test(c)){result=result.trimEnd()+c;while(/\s/.test(s[i+1]||''))i++}else result+=c}
    return result
  }
  const strip=(s:string)=>config.guards.reduce((text,guard)=>text.replaceAll(normalize(guard),''),normalize(s))
  const familyNames=new Map(config.families.map(s=>[normalize(s),s]))
  const families=new Set(familyNames.keys())
  const branches=(text:string)=>{
    const result:string[]=[];let start=0,depth=0,quote=''
    for(let i=0;i<text.length;i++){const c=text[i]!;if(quote){if(c===quote&&text.charCodeAt(i-1)!==92)quote='';continue}if(c==='"'||c==="'")quote=c;else if(c==='('||c==='[')depth++;else if(c===')'||c===']')depth--;else if(c===','&&!depth){result.push(text.slice(start,i).trim());start=i+1}}
    result.push(text.slice(start).trim());return result
  }
  const visual=(property:string,value:string)=>/^(?:color|background(?:-.+)?|border(?:-.+)?|box-shadow|font-(?:family|size|weight)|outline(?:-.+)?|animation(?:-.+)?|letter-spacing|text-transform|opacity)$/.test(property)&&value.trim()!=='inherit'
  const sheets=Array.from(document.styleSheets),originalRules:CSSRule[]=[]
  const visitAll=(rules:CSSRuleList)=>{for(const rule of Array.from(rules)){originalRules.push(rule);if('cssRules'in rule)visitAll((rule as CSSGroupingRule).cssRules)}}
  for(const sheet of sheets)visitAll(sheet.cssRules)
  const originalText=originalRules.map(rule=>rule.cssText),styleRefs=originalRules.filter((rule):rule is CSSStyleRule=>rule instanceof CSSStyleRule).map(rule=>({rule,style:rule.style,text:rule.style.cssText}))
  const selected:{rule:CSSStyleRule;branches:string[];paint:string[]}[]=[];const authored:string[]=[],paint:string[]=[]
  for(const rule of originalRules){if(!(rule instanceof CSSStyleRule))continue;const all=branches(rule.selectorText),own=all.filter(s=>families.has(strip(s)));if(!own.length)continue;authored.push(...own);const hasPaint=Array.from(rule.style).some(p=>visual(p,rule.style.getPropertyValue(p)));if(hasPaint){paint.push(...own);selected.push({rule,branches:all,paint:own})}}
  const matches=paint.filter(s=>document.querySelector(s))
  const legacyMatches=authored.every(s=>{const a=Array.from(document.querySelectorAll(strip(s))),b=Array.from(document.querySelectorAll(s));return a.length===b.length&&a.every((n,i)=>n===b[i])})
  const base=config.families[0]!,positive=base+':where(.mc-live-positive-owner)',unknown=base+':where(:not(.mc-live-unknown-owner))'
  const classifierChecks={known:strip(base+config.guards[0]!)===normalize(base),positiveRetained:strip(positive)===normalize(positive)&&!families.has(strip(positive)),unknownRetained:strip(unknown)===normalize(unknown)&&!families.has(strip(unknown)),actualOwnersRetained:config.owners.every(s=>strip(s).includes(normalize(config.ownerScope))&&!families.has(strip(s)))}
  const selectedPositiveOwners=authored.filter(s=>strip(s).includes(':where('))
  const probe=document.createElement('style');probe.textContent=matches.map(s=>s+' { --mc-live-skin-probe: legacy; }').join('\n')
  if(matches.length)document.head.append(probe)
  const inherited=Array.from(document.querySelectorAll(config.targets)).filter(n=>getComputedStyle(n).getPropertyValue('--mc-live-skin-probe').trim()==='legacy').map(n=>n.tagName+'.'+(n.getAttribute('class')||''))
  probe.remove()
  const restore:{rule:CSSStyleRule;selector:string;style:CSSStyleDeclaration;text:string}[]=[],clones:{parent:CSSStyleSheet|CSSGroupingRule;rule:CSSRule}[]=[]
  for(const item of selected){if(!item.paint.some(s=>document.querySelector(s)))continue;const {rule}=item,parent=(rule.parentRule||rule.parentStyleSheet) as CSSStyleSheet|CSSGroupingRule;const neutral=Array.from(rule.style).filter(p=>!visual(p,rule.style.getPropertyValue(p)))
    if(neutral.length){const index=Array.from(parent.cssRules).indexOf(rule);parent.insertRule(item.paint.join(', ')+' {}',index);const clone=parent.cssRules[index] as CSSStyleRule;for(const p of neutral)clone.style.setProperty(p,rule.style.getPropertyValue(p),rule.style.getPropertyPriority(p));clones.push({parent,rule:clone})}
    restore.push({rule,selector:rule.selectorText,style:rule.style,text:rule.style.cssText});const retained=item.branches.filter(s=>!item.paint.includes(s));rule.selectorText=retained.length?retained.join(', '):':not(*)'
  }
  return {rules:selected.length,families:[...new Set(authored.map(s=>familyNames.get(strip(s))!))].sort(),paintFamilies:[...new Set(paint.map(s=>familyNames.get(strip(s))!))].sort(),matches,inherited,legacyMatches,classifierChecks,selectedPositiveOwners,restore,clones,sheets,originalRules,originalText,styleRefs}
}

export function restoreLiveSkinBranches(value:ReturnType<typeof ablateLiveSkinBranches>) {
  // Keep the original declaration objects: reparsing a var() border shorthand
  // followed by a side override is not a reliable CSSOM round trip.
  for(const saved of value.restore)saved.rule.selectorText=saved.selector
  for(const clone of [...value.clones].reverse()){const index=Array.from(clone.parent.cssRules).indexOf(clone.rule);if(index<0)throw new Error('Live neutral clone disappeared');clone.parent.deleteRule(index)}
  const sheets=Array.from(document.styleSheets),rules:CSSRule[]=[]
  const visit=(list:CSSRuleList)=>{for(const rule of Array.from(list)){rules.push(rule);if('cssRules'in rule)visit((rule as CSSGroupingRule).cssRules)}}
  for(const sheet of sheets)visit(sheet.cssRules)
  return {cssomRoundtrip:rules.length===value.originalRules.length&&rules.every((r,i)=>r===value.originalRules[i]&&r.cssText===value.originalText[i]),styleObjectsUnchanged:value.styleRefs.every(s=>s.rule.style===s.style&&s.rule.style.cssText===s.text),sheetsUnchanged:sheets.length===value.sheets.length&&sheets.every((s,i)=>s===value.sheets[i])}
}

// Check the real cascade, including the portal sheet, instead of checking class names.
export function limeLiveDurationSkinCases() {
  const samples = (['client', 'trainer'] as const).flatMap(role => (role === 'client' ? ['light', 'dark'] : ['dark']).flatMap(theme =>
    ['original', 'compact'].flatMap(density => ['sheet'].map(state => ({ role, theme, density, state, lime: true, width: theme === 'light' ? 390 : 430 })))))
  for (const role of ['client', 'trainer'] as const) {
    samples.push({ role, theme: 'dark', density: 'compact', state: 'sheet', lime: true, width: 375 })
    samples.push({ role, theme: 'dark', density: 'original', state: 'sheet', lime: false, width: 390 })
  }
  samples.push({ role: 'trainer', theme: 'dark', density: 'original', state: 'sheet', lime: true, width: 1440 })
  for (const sample of samples) test('Live Lime duration skin ownership ' + Object.values(sample).join('-'), async ({ page }, info) => {
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
      if (sample.state !== 'clock') sessionStorage.setItem('fit:live-rest-until:' + workoutId, String(now + (sample.state === 'overdue' ? -15000 : 90000)))
    }, { id, sample, now, workoutId })
    const source = restTimerWorkout(0, true, 'manual')
    source.startedAt = new Date(now - 120000).toISOString()
    source.createdBy = id
    if (sample.role === 'trainer') source.trainerId = id
    await mockPilot(page, { role: sample.role, profileId: id, clientLime: sample.lime && sample.role === 'client', fitLime: sample.lime && sample.role === 'trainer', workouts: [source] })
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
    if (sample.state === 'sheet') {
      await page.getByRole('button', { name: /Фактическое время:/ }).first().click()
      await expect(page.getByRole('dialog', { name: 'Фактическое время', exact: true })).toBeVisible()
      const wheel = page.locator('.rest-time-wheel').first()
      await wheel.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      await expect(wheel).toBeFocused()
      await expect(wheel).toHaveCSS('outline-width', '2px')
    }
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const capture = () => page.locator('.phone-frame').evaluate(root => {
      const properties = ['display','position','color','background-color','font-family','font-size','font-weight','line-height','width','height','min-width','min-height','max-height','gap','grid-template-columns','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-bottom','border-top-width','border-top-color','border-top-style','border-radius','box-shadow','outline-color','outline-width','outline-style','outline-offset','overflow-x','overflow-y','scroll-snap-type','touch-action','opacity','align-items','justify-content', 'border-right-width', 'border-right-style', 'border-right-color', 'border-bottom-width', 'border-bottom-style', 'border-bottom-color', 'border-left-width', 'border-left-style', 'border-left-color', 'margin-right', 'margin-left']
      const targets = Array.from(root.querySelectorAll('.workout-duration-sheet'))
      const nodes = [...new Set(targets.flatMap(node => [node,...node.querySelectorAll('*')]))]
      return nodes.map(node => { const css=getComputedStyle(node),r=node.getBoundingClientRect();return {tag:node.tagName,class:node.getAttribute('class')||'',style:Object.fromEntries(properties.map(p=>[p,css.getPropertyValue(p)])),rect:[r.x,r.y,r.width,r.height].map(v=>Math.round(v*100)/100)} })
    })
    const before = await capture()
    if (sample.lime && (sample.state === 'sheet' || sample.state === 'overdue')) await page.screenshot({ path: info.outputPath('duration-skin.png'), animations: 'disabled' })
    const ablation=await page.evaluateHandle(ablateLiveSkinBranches,{...liveDurationManifest,guards:[libraryMigrationGuard,editorMigrationGuard,...liveDurationManifest.guards],owners:editorOwnerSelectors,ownerScope:':where('+editorOwnerFilter+')',targets:".workout-duration-sheet,.workout-duration-sheet *"})
    const result=await ablation.evaluate(value=>({rules:value.rules,families:value.families,paintFamilies:value.paintFamilies,matches:value.matches,inherited:value.inherited,legacyMatches:value.legacyMatches,classifierChecks:value.classifierChecks,selectedPositiveOwners:value.selectedPositiveOwners}))
    let after:typeof before=[]
    let restoration:ReturnType<typeof restoreLiveSkinBranches>
    try {
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
      after=await capture()
    }finally{restoration=await ablation.evaluate(restoreLiveSkinBranches);await ablation.dispose()}
    expect(restoration).toEqual({cssomRoundtrip:true,styleObjectsUnchanged:true,sheetsUnchanged:true})
    expect(after).toHaveLength(before.length)
    const differences=before.flatMap((a,i)=>{const b=after[i]!;const changes=Object.fromEntries(Object.keys(a.style).filter(p=>a.style[p]!==b.style[p]).map(p=>[p,[a.style[p],b.style[p]]]));return Object.keys(changes).length||JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[{tag:a.tag,class:a.class,changes,rect:JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[a.rect,b.rect]:undefined}]:[]})
    await writeFile(info.outputPath('duration-skin.json'),JSON.stringify({sample,before,...result,restoration,differences,errors,requests,consoleErrors,responses},null,2))
    expect(errors).toEqual([])
    expect(requests).toEqual([])
    expect(responses).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(result.families).toEqual([...liveDurationManifest.families].sort())
    expect(result.paintFamilies).toEqual([...liveDurationManifest.paintFamilies].sort())
    expect(result.classifierChecks).toEqual({known:true,positiveRetained:true,unknownRetained:true,actualOwnersRetained:true})
    expect(result.selectedPositiveOwners).toEqual([])
    if(sample.lime){expect(result.matches).toEqual([]);expect(result.inherited).toEqual([]);expect(differences).toEqual([])}
    else{expect(result.matches.length).toBeGreaterThan(0);expect(result.legacyMatches).toBe(true);expect(differences.length).toBeGreaterThan(0)}
  })
}
