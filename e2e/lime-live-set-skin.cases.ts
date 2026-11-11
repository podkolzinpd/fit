import {editorMigrationGuard,editorOwnerFilter,editorOwnerSelectors} from './lime-editor-skin.contract'
import {ablateLiveSkinBranches,restoreLiveSkinBranches} from './lime-live-duration-skin.cases'
import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { mockPilot, coachGestureWorkout, workoutId } from './fit-lime-fixtures'

// Reviewed bd928e07: 32 authored groups contain 34 selector families, 29 with paint. Exact sets survive optimizer splitting/merging.
const liveSetManifest = {
  "families": [
    ".live-identity .workout-set-table",
    ".live-identity .workout-set-table-head",
    ".live-identity .live-set-table > .live-set",
    ".live-identity .live-set-table > .live-set + .live-set",
    ".live-identity .live-set-grid",
    ".live-identity .live-set.rpe-visible .live-set-grid",
    ".live-identity .live-set-grid > :not(:first-child)",
    ".live-identity .workout-duration-trigger.live-set-input",
    ".live-identity .live-set-number",
    ".live-identity .live-set-input",
    ".live-identity .live-set-rpe",
    ".live-identity .live-set-input:focus",
    ".live-identity .live-set-rpe:focus",
    ".live-identity .live-set-input.plan-hint",
    ".live-identity .live-set-confirm",
    ".live-identity .live-set-check",
    ".live-identity .live-set-save",
    ".live-identity .live-set-expanded .live-set-check",
    ".live-identity .live-set-expanded .live-set-save",
    ".live-identity .live-set.editing > .live-set-grid",
    ".live-identity .live-set.editing .live-set-save",
    ".live-identity .live-set-check.done",
    ".live-identity .live-set.confirmed > .live-set-grid",
    ".live-identity .live-set.confirmed > .live-set-grid > :not(:first-child)",
    ".live-identity .live-set.confirmed .live-set-number",
    ".live-identity .live-set.confirmed .live-set-confirm",
    ".live-identity .live-set.confirmed .live-set-input",
    ".live-identity .live-set.confirmed .live-set-rpe",
    ".live-identity .live-set.confirmed .live-set-check.done",
    ".live-identity .live-set-save-feedback .save-status",
    ".live-identity .live-set.invalid > .live-set-grid",
    ".live-identity .live-set-validation",
    ".live-identity .live-workout-page .live-set-table > .live-set",
    ".live-identity .live-workout-page .live-set-table > .live-set + .live-set"
  ],
  "paintFamilies": [
    ".live-identity .live-set-check",
    ".live-identity .live-set-check.done",
    ".live-identity .live-set-expanded .live-set-check",
    ".live-identity .live-set-expanded .live-set-save",
    ".live-identity .live-set-grid",
    ".live-identity .live-set-grid > :not(:first-child)",
    ".live-identity .live-set-input",
    ".live-identity .live-set-input.plan-hint",
    ".live-identity .live-set-input:focus",
    ".live-identity .live-set-number",
    ".live-identity .live-set-rpe",
    ".live-identity .live-set-rpe:focus",
    ".live-identity .live-set-save",
    ".live-identity .live-set-save-feedback .save-status",
    ".live-identity .live-set-table > .live-set + .live-set",
    ".live-identity .live-set-validation",
    ".live-identity .live-set.confirmed .live-set-check.done",
    ".live-identity .live-set.confirmed .live-set-input",
    ".live-identity .live-set.confirmed .live-set-number",
    ".live-identity .live-set.confirmed .live-set-rpe",
    ".live-identity .live-set.confirmed > .live-set-grid",
    ".live-identity .live-set.confirmed > .live-set-grid > :not(:first-child)",
    ".live-identity .live-set.editing .live-set-save",
    ".live-identity .live-set.editing > .live-set-grid",
    ".live-identity .live-set.invalid > .live-set-grid",
    ".live-identity .live-workout-page .live-set-table > .live-set",
    ".live-identity .live-workout-page .live-set-table > .live-set + .live-set",
    ".live-identity .workout-set-table",
    ".live-identity .workout-set-table-head"
  ],
  "guards": [
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .workout-set-table))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .workout-set-table-head))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-table > .live-set))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-table > .live-set + .live-set))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-grid))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set.rpe-visible .live-set-grid))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-grid > :not(:first-child)))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .workout-duration-trigger.live-set-input))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-number))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-input))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-rpe))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-input:focus))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-rpe:focus))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-input.plan-hint))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-confirm))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-check))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-save))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-expanded .live-set-check))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-expanded .live-set-save))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set.editing > .live-set-grid))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set.editing .live-set-save))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-check.done))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set.confirmed > .live-set-grid))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set.confirmed > .live-set-grid > :not(:first-child)))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set.confirmed .live-set-number))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set.confirmed .live-set-confirm))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set.confirmed .live-set-input))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set.confirmed .live-set-rpe))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set.confirmed .live-set-check.done))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-save-feedback .save-status))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set.invalid > .live-set-grid))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-set-validation))"
  ]
}

// MC3.2 tests CSS ownership, separately from the existing input/gesture tests.
// Themes exercise different tokens, densities different geometry, metric kinds
// different controls. The grouped distance case also checks circuit selectors.
export function limeLiveSetSkinCases() {
  const variants = (['client', 'trainer'] as const).flatMap(role =>
    (role === 'client' ? ['light', 'dark'] : ['dark']).flatMap(theme =>
      ['original', 'compact'].flatMap(density =>
        (['strength', 'duration', 'distance', 'rpe'] as const).map(kind => ({ role, theme, density, kind, lime: true, width: theme === 'light' ? 390 : 430 }))))
  )
  for (const role of ['client', 'trainer'] as const) {
    variants.push({ role, theme: 'dark', density: 'compact', kind: 'strength', lime: true, width: 375 })
    variants.push({ role, theme: 'dark', density: 'original', kind: 'strength', lime: false, width: 390 })
  }
  for (const sample of variants) test('Live Lime set skin ownership ' + Object.values(sample).join('-'), async ({ page }, info) => {
    const id = sample.lime ? sample.role === 'client' ? 'c11e0000-6010-4000-8000-000000000001' : 'c0ac0000-6010-4000-8000-000000000001' : '10000000-0000-4000-8000-000000000001'
    await page.setViewportSize({ width: sample.width, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.setFixedTime(new Date('2026-11-06T09:00:00Z'))
    await page.addInitScript(({ id, sample }) => {
      localStorage.setItem('fit.appTheme', sample.theme)
      localStorage.setItem('fit.clientLime.theme.' + id, sample.theme)
      localStorage.setItem('fit.clientLiveDensity.' + id, sample.density)
      localStorage.setItem('fit.coachLiveDensity.' + id, sample.density)
      localStorage.setItem('fit.liveExerciseAnimation.' + id, 'false')
    }, { id, sample })
    const source = coachGestureWorkout(sample.kind === 'distance')
    source.startedAt = '2026-11-06T08:58:00Z'
    source.createdBy = id
    if (sample.role === 'trainer') source.trainerId = id
    const exercise = source.exercises[0]!
    const base = exercise.sets[0]!
    exercise.sets = Array.from({ length: 3 }, (_, position) => ({ ...base, id: base.id.slice(0, -1) + position, position }))
    const strength = sample.kind === 'strength' || sample.kind === 'rpe'
    if (sample.kind === 'duration' || sample.kind === 'distance') {
      exercise.inputKind = sample.kind
      exercise.ref = sample.kind === 'duration' ? 'plank' : 'running'
      exercise.sets = exercise.sets.map(set => ({ ...set, weightKg: undefined, reps: undefined, durationSec: 300, ...(sample.kind === 'distance' ? { distanceKm: 1 } : {}) }))
    }
    exercise.sets[0]!.confirmedAt = '2026-11-06T08:59:00Z'
    exercise.sets[0]!.fact = strength ? { weightKg: 20, reps: 10 } : { durationSec: 300, ...(sample.kind === 'distance' ? { distanceKm: 1 } : {}) }
    await mockPilot(page, { role: sample.role, profileId: id, clientLime: sample.lime && sample.role === 'client', fitLime: sample.lime && sample.role === 'trainer', workouts: [source] })
    await page.goto('/workouts/' + workoutId + '/live')
    const root = page.locator('.live-workout-page')
    await expect(root.locator('form[data-live-set-id]').first()).toBeVisible()
    if (sample.lime) {
      await expect(root).toHaveClass(/(?:coach|client)-live-v79/)
      await expect(root).toHaveClass(new RegExp('coach-live-density-' + sample.density))
      await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
      if (sample.kind === 'rpe') {
        await root.getByRole('button', { name: 'Ещё действия', exact: true }).first().click()
        await page.getByRole('menuitem', { name: 'Указать RPE', exact: true }).click()
        await expect(root.locator('.live-set-rpe').first()).toBeVisible()
      }
    } else await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-lime-shell/)
    await page.evaluate(() => document.fonts.ready)
    // Actual focus, rather than a painted focus class; never change form state.
    if (strength) {
      const input = root.locator('input[name="weightKg"]:enabled').first()
      await input.focus()
      await expect(input).toBeFocused()
      // WebKit may report its native focus outline until the actual
      // :focus-visible rule is resolved, even after two animation frames.
      // Assert the existing approved rule before measuring its preservation.
      if (sample.lime) await expect(input).toHaveCSS('outline-width', '1px')
    }
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    if (sample.kind === 'strength' && sample.lime && sample.width !== 375) await page.screenshot({ path: info.outputPath('set-skin.png'), animations: 'disabled' })
    const capture = () => root.evaluate(element => {
      const props = ['display', 'position', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'width', 'height', 'min-width', 'min-height', 'gap', 'row-gap', 'column-gap', 'box-shadow', 'outline-width', 'outline-style', 'outline-color', 'border-top-width', 'border-top-style', 'border-top-color', 'border-left-width', 'border-left-color', 'border-radius', 'margin-top', 'margin-bottom', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'overflow-x', 'overflow-y', 'text-overflow', 'white-space', 'cursor', 'align-items', 'justify-content', 'grid-template-columns', 'border-right-width', 'border-right-style', 'border-right-color', 'border-bottom-width', 'border-bottom-style', 'border-bottom-color', 'border-left-style', 'margin-right', 'margin-left']
      return Array.from(element.querySelectorAll('.live-set-table, .workout-set-table-head, form[data-live-set-id], form[data-live-set-id] *')).map(node => {
        const css = getComputedStyle(node), r = node.getBoundingClientRect()
        return { tag: node.tagName, class: node.getAttribute('class') || '', style: Object.fromEntries(props.map(p => [p, css.getPropertyValue(p)])), rect: [r.x, r.y, r.width, r.height].map(v => Math.round(v * 100) / 100) }
      })
    })
    const before=await capture()
    const ablation=await page.evaluateHandle(ablateLiveSkinBranches,{...liveSetManifest,guards:[editorMigrationGuard,...liveSetManifest.guards],owners:editorOwnerSelectors,ownerScope:':where('+editorOwnerFilter+')',targets:".live-workout-page form[data-live-set-id],.live-workout-page form[data-live-set-id] *"})
    const result=await ablation.evaluate(value=>({rules:value.rules,families:value.families,paintFamilies:value.paintFamilies,matches:value.matches,inherited:value.inherited,legacyMatches:value.legacyMatches,classifierChecks:value.classifierChecks,selectedPositiveOwners:value.selectedPositiveOwners}))
    let after:typeof before=[]
    let restoration:ReturnType<typeof restoreLiveSkinBranches>
    try {
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
      after=await capture()
    }finally{restoration=await ablation.evaluate(restoreLiveSkinBranches);await ablation.dispose()}
    expect(restoration).toEqual({cssomRoundtrip:true,styleObjectsUnchanged:true,sheetsUnchanged:true})
    expect(after).toHaveLength(before.length)
    const differences = before.flatMap((a, i) => {
      const b = after[i]!, props = Object.keys(a.style).filter(p => a.style[p] !== b.style[p])
      return props.length || JSON.stringify(a.rect) !== JSON.stringify(b.rect) ? [{ tag: a.tag, class: a.class, changes: Object.fromEntries(props.map(p => [p, [a.style[p], b.style[p]]])), rect: JSON.stringify(a.rect) !== JSON.stringify(b.rect) ? [a.rect, b.rect] : undefined }] : []
    })
    await writeFile(info.outputPath('set-skin.json'), JSON.stringify({ sample, before, ...result, restoration, differences }, null, 2))
    expect(result.families).toEqual([...liveSetManifest.families].sort())
    expect(result.paintFamilies).toEqual([...liveSetManifest.paintFamilies].sort())
    expect(result.classifierChecks).toEqual({known:true,positiveRetained:true,unknownRetained:true,actualOwnersRetained:true})
    expect(result.selectedPositiveOwners).toEqual([])
    if (sample.lime) { expect(result.matches).toEqual([]); expect(result.inherited).toEqual([]); expect(differences).toEqual([]) }
    else { expect(result.inherited.length).toBeGreaterThan(0); expect(result.legacyMatches).toBe(true); expect(differences.length).toBeGreaterThan(0) }
  })
}
