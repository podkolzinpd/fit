import {editorMigrationGuard,editorOwnerFilter,editorOwnerSelectors} from './lime-editor-skin.contract'
import {ablateLiveSkinBranches,restoreLiveSkinBranches} from './lime-live-duration-skin.cases'
import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'

// Reviewed bd928e07: 30 selector families, 28 with paint; two trigger geometry families stay structural.
const liveTimerManifest = {
  "families": [
    ".workout-decision-sheet",
    ".live-identity .live-pinned",
    ".live-identity .live-timer",
    ".live-identity .live-timer .live-dot-mark",
    ".live-identity .live-timer.resting",
    ".live-identity .live-timer.resting .live-dot-mark",
    ".live-identity .rest-timer",
    ".live-identity .rest-timer strong",
    ".live-identity .rest-step",
    ".live-identity .rest-controls .link",
    ".live-identity .live-timer-toolbar .live-timer",
    ".live-identity .live-timer-toolbar button.live-rest-trigger",
    ".live-rest-countdown",
    ".live-rest-countdown.overdue",
    ".live-rest-divider",
    ".live-rest-new-time",
    ".rest-time-wheel-field > span",
    ".rest-time-wheel",
    ".rest-time-wheel:focus-visible",
    ".rest-time-wheel [role='option']",
    ".rest-time-wheel [role='option'].selected",
    ".rest-time-separator",
    ".live-rest-apply",
    ".live-rest-trigger.resting",
    ".live-rest-trigger.rest-overdue",
    ".live-rest-trigger.phase-prep",
    ".live-rest-trigger.phase-work",
    ".live-identity .live-pinned-empty .live-timer-toolbar .live-timer",
    ".live-identity .live-pinned-empty .live-timer-toolbar button.live-rest-trigger",
    ".live-identity .live-timer.paused"
  ],
  "paintFamilies": [
    ".live-identity .live-pinned",
    ".live-identity .live-pinned-empty .live-timer-toolbar .live-timer",
    ".live-identity .live-timer",
    ".live-identity .live-timer .live-dot-mark",
    ".live-identity .live-timer-toolbar .live-timer",
    ".live-identity .live-timer.paused",
    ".live-identity .live-timer.resting",
    ".live-identity .live-timer.resting .live-dot-mark",
    ".live-identity .rest-controls .link",
    ".live-identity .rest-step",
    ".live-identity .rest-timer",
    ".live-identity .rest-timer strong",
    ".live-rest-apply",
    ".live-rest-countdown",
    ".live-rest-countdown.overdue",
    ".live-rest-divider",
    ".live-rest-new-time",
    ".live-rest-trigger.phase-prep",
    ".live-rest-trigger.phase-work",
    ".live-rest-trigger.rest-overdue",
    ".live-rest-trigger.resting",
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
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-pinned))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-timer))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-timer .live-dot-mark))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-timer.resting))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-timer.resting .live-dot-mark))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .rest-timer))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .rest-timer strong))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .rest-step))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .rest-controls .link))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-timer-toolbar .live-timer))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-timer-toolbar button.live-rest-trigger))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-rest-sheet .live-rest-countdown))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-rest-sheet .live-rest-countdown.overdue))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-rest-sheet .live-rest-divider))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-rest-sheet .live-rest-new-time))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) :is(.live-rest-sheet,.workout-duration-sheet) .rest-time-wheel-field > span))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) :is(.live-rest-sheet,.workout-duration-sheet) .rest-time-wheel))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) :is(.live-rest-sheet,.workout-duration-sheet) .rest-time-wheel:focus-visible))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) :is(.live-rest-sheet,.workout-duration-sheet) .rest-time-wheel [role='option']))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) :is(.live-rest-sheet,.workout-duration-sheet) .rest-time-wheel [role='option'].selected))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) :is(.live-rest-sheet,.workout-duration-sheet) .rest-time-separator))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-rest-sheet .live-rest-apply))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-rest-trigger.resting))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-rest-trigger.rest-overdue))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-rest-trigger.phase-prep))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-rest-trigger.phase-work))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-pinned-empty .live-timer-toolbar .live-timer))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-pinned-empty .live-timer-toolbar button.live-rest-trigger))",
    ":where(:not(.fit-lime-shell.workout-live-reference:has(.coach-live-v79,.client-live-v79) .live-timer.paused))"
  ]
}

// Check the real cascade, including the portal sheet, instead of checking class names.
export function limeLiveTimerSkinCases() {
  const samples = (['client', 'trainer'] as const).flatMap(role => (role === 'client' ? ['light', 'dark'] : ['dark']).flatMap(theme =>
    ['original', 'compact'].flatMap(density => ['clock', 'rest', 'overdue', 'sheet'].map(state => ({ role, theme, density, state, lime: true, width: theme === 'light' ? 390 : 430 })))))
  for (const role of ['client', 'trainer'] as const) {
    samples.push({ role, theme: 'dark', density: 'compact', state: 'sheet', lime: true, width: 375 })
    samples.push({ role, theme: 'dark', density: 'original', state: 'sheet', lime: false, width: 390 })
  }
  for (const sample of samples) test('Live Lime timer skin ownership ' + Object.values(sample).join('-'), async ({ page }, info) => {
    const id = !sample.lime ? '10000000-0000-4000-8000-000000000001' : sample.role === 'client' ? 'c11e0000-6010-4000-8000-000000000001' : 'c0ac0000-6010-4000-8000-000000000001'
    const now = Date.parse('2026-11-06T09:00:00Z')
    await page.setViewportSize({ width: sample.width, height: sample.width === 375 ? 667 : 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.setFixedTime(new Date(now))
    await page.addInitScript(({ id, sample, now, workoutId }) => {
      localStorage.setItem('fit.appTheme', sample.theme)
      localStorage.setItem('fit.clientLime.theme.' + id, sample.theme)
      localStorage.setItem('fit.clientLiveDensity.' + id, sample.density)
      localStorage.setItem('fit.coachLiveDensity.' + id, sample.density)
      localStorage.setItem('fit.liveExerciseAnimation.' + id, 'false')
      if (sample.state !== 'clock') sessionStorage.setItem('fit:live-rest-until:' + workoutId, String(now + (sample.state === 'overdue' ? -15000 : 90000)))
    }, { id, sample, now, workoutId })
    const source = restTimerWorkout()
    source.startedAt = new Date(now - 120000).toISOString()
    source.createdBy = id
    if (sample.role === 'trainer') source.trainerId = id
    await mockPilot(page, { role: sample.role, profileId: id, clientLime: sample.lime && sample.role === 'client', fitLime: sample.lime && sample.role === 'trainer', workouts: [source] })
    await page.goto('/workouts/' + workoutId + '/live')
    await expect(page.locator('form[data-live-set-id]').first()).toBeVisible()
    if (sample.lime) {
      await expect(page.locator('.live-workout-page')).toHaveClass(/(?:coach|client)-live-v79/)
      await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    } else await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-lime-shell/)
    if (sample.state === 'sheet') {
      await page.locator(sample.lime ? '.coach-v79-actions button.live-rest-trigger' : '.live-rest-trigger').first().click({ button: 'right' })
      await expect(page.getByRole('dialog', { name: 'Таймер отдыха', exact: true })).toBeVisible()
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
      const targets = Array.from(root.querySelectorAll('.live-pinned,.coach-v79-timer,.coach-v79-dock,.live-rest-sheet,.live-timer-toolbar'))
      const nodes = [...new Set(targets.flatMap(node => [node,...node.querySelectorAll('*')]))]
      return nodes.map(node => { const css=getComputedStyle(node),r=node.getBoundingClientRect();return {tag:node.tagName,class:node.getAttribute('class')||'',style:Object.fromEntries(properties.map(p=>[p,css.getPropertyValue(p)])),rect:[r.x,r.y,r.width,r.height].map(v=>Math.round(v*100)/100)} })
    })
    const before = await capture()
    if (sample.lime && (sample.state === 'sheet' || sample.state === 'overdue')) await page.screenshot({ path: info.outputPath('timer-skin.png'), animations: 'disabled' })
    const ablation=await page.evaluateHandle(ablateLiveSkinBranches,{...liveTimerManifest,guards:[editorMigrationGuard,...liveTimerManifest.guards],owners:editorOwnerSelectors,ownerScope:':where('+editorOwnerFilter+')',targets:".coach-v79-timer,.coach-v79-timer *,.coach-v79-dock,.coach-v79-dock *,.live-rest-sheet,.live-rest-sheet *"})
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
    await writeFile(info.outputPath('timer-skin.json'),JSON.stringify({sample,before,...result,restoration,differences},null,2))
    expect(result.families).toEqual([...liveTimerManifest.families].sort())
    expect(result.paintFamilies).toEqual([...liveTimerManifest.paintFamilies].sort())
    expect(result.classifierChecks).toEqual({known:true,positiveRetained:true,unknownRetained:true,actualOwnersRetained:true})
    expect(result.selectedPositiveOwners).toEqual([])
    if(sample.lime){expect(result.matches).toEqual([]);expect(result.inherited).toEqual([]);expect(differences).toEqual([])}
    else{expect(result.matches.length).toBeGreaterThan(0);expect(result.legacyMatches).toBe(true);expect(differences.length).toBeGreaterThan(0)}
  })
}
