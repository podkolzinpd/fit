import {editorMigrationGuard,editorOwnerFilter,editorOwnerSelectors} from './lime-editor-skin.contract'
import {ablateLiveSkinBranches,restoreLiveSkinBranches} from './lime-live-duration-skin.cases'
import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { mockPilot, coachGestureWorkout, workoutId } from './fit-lime-fixtures'

// Reviewed bd928e07: eight authored groups contain nine selector families; eight carry paint, head gap is structural.
const liveCardManifest = {
  "families": [
    ".live-identity .workout-exercise-contract",
    ".live-identity .live-exercise.current",
    ".live-identity .live-exercise-head",
    ".live-identity .live-exercise-head h2",
    ".live-identity .live-exercise-head h3",
    ".live-identity .overflow-trigger",
    ".live-identity .live-exercise-upcoming",
    ".live-identity .live-exercise-upcoming.started",
    ".live-identity .live-exercise-upcoming .live-exercise-head h2"
  ],
  "paintFamilies": [
    ".live-identity .live-exercise-head h2",
    ".live-identity .live-exercise-head h3",
    ".live-identity .live-exercise-upcoming",
    ".live-identity .live-exercise-upcoming .live-exercise-head h2",
    ".live-identity .live-exercise-upcoming.started",
    ".live-identity .live-exercise.current",
    ".live-identity .overflow-trigger",
    ".live-identity .workout-exercise-contract"
  ],
  "guards": [
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .workout-exercise-contract))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-exercise.current))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-exercise-head))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-exercise-head h2))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-exercise-head h3))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .workout-exercise-contract .overflow-trigger))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-exercise-upcoming))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-exercise-upcoming.started))",
    ":where(:not(.fit-lime-shell.workout-live-reference :is(.coach-live-v79,.client-live-v79) .live-exercise-upcoming .live-exercise-head h2))"
  ]
}

// MC3.1: legacy shell rules can be removed from modern cards without replacing
// their already approved Lime appearance. The legacy consumer remains active.
export function limeLiveCardShellCases() {
  const cases = ['client', 'trainer'].flatMap(role => ['light', 'dark'].flatMap(theme => ['original', 'compact'].flatMap(density => [false, true].map(animation => ({ role, theme, density, animation, lime: true })))))
  cases.push({ role: 'trainer', theme: 'dark', density: 'original', animation: false, lime: false })
  for (const sample of cases)
    test('Live Lime card shell ownership ' + Object.values(sample).join('-'), async ({ page }, info) => {
      const id = sample.lime ? sample.role === 'client' ? 'c11e0000-6010-4000-8000-000000000001' : 'c0ac0000-6010-4000-8000-000000000001' : '10000000-0000-4000-8000-000000000001'
      await page.setViewportSize({ width: sample.theme === 'light' ? 390 : 430, height: 844 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.clock.setFixedTime(new Date('2026-11-05T09:00:00Z'))
      await page.addInitScript(({ id, sample }) => {
        localStorage.setItem('fit.appTheme', sample.theme)
        localStorage.setItem('fit.clientLime.theme.' + id, sample.theme)
        localStorage.setItem('fit.clientLiveDensity.' + id, sample.density)
        localStorage.setItem('fit.coachLiveDensity.' + id, sample.density)
        localStorage.setItem('fit.liveExerciseAnimation.' + id, String(sample.animation))
      }, { id, sample })
      const source = coachGestureWorkout(false, 3)
      source.startedAt = '2026-11-05T08:58:00Z'
      source.createdBy = id
      if (sample.role === 'trainer')
        source.trainerId = id
      source.exercises[0]!.sets.forEach(set => { set.confirmedAt = '2026-11-05T08:59:00Z'; set.fact = { weightKg: 20, reps: 10 }; })
      source.exercises[1]!.name = 'Жим гантелей на наклонной скамье с длинным названием'
      await mockPilot(page, { role: sample.role as 'client' | 'trainer', profileId: id, clientLime: sample.lime && sample.role === 'client', fitLime: sample.lime && sample.role === 'trainer', workouts: [source] })
      await page.goto('/workouts/' + workoutId + '/live')
      const cards = page.locator('.live-workout-page :is(.workout-exercise-contract,.workout-exercise-compact)')
      await expect(cards).toHaveCount(3)
      if (sample.lime) {
        await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
        await expect(page.locator('.phone-frame')).toHaveClass(/workout-live-reference/)
        await expect(page.locator('.live-workout-page')).toHaveClass(new RegExp('coach-live-density-' + sample.density))
      }
      else
        await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-lime-shell/)
      await page.evaluate(() => document.fonts.ready)
      const capture = () => cards.evaluateAll(roots => {
        const properties = ['display', 'color', 'background-color', 'background-image', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'width', 'height', 'min-width', 'min-height', 'gap', 'row-gap', 'column-gap', 'box-shadow', 'border-top-width', 'border-top-style', 'border-top-color', 'border-right-width', 'border-right-color', 'border-bottom-width', 'border-bottom-color', 'border-left-width', 'border-left-color', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'opacity', 'align-items', 'justify-content', 'grid-template-columns', 'border-right-style', 'border-bottom-style', 'border-left-style']
        return roots.flatMap((root, index) => [root, ...root.querySelectorAll('*')].map(node => {
          const css = getComputedStyle(node), r = node.getBoundingClientRect()
          return { card: index, tag: node.tagName, class: node.getAttribute('class') || '', style: Object.fromEntries(properties.map(p => [p, css.getPropertyValue(p)])), rect: [r.x, r.y, r.width, r.height].map(v => Math.round(v * 100) / 100) }
        }))
      })
      if (!sample.animation && ((sample.role === 'client' && sample.density === 'original') || (sample.role === 'trainer' && sample.density === 'compact'))) {
        await page.screenshot({ path: info.outputPath('card-shell.png'), animations: 'disabled' })
      }
      const before = await capture()
      const ablation=await page.evaluateHandle(ablateLiveSkinBranches,{...liveCardManifest,guards:[editorMigrationGuard,...liveCardManifest.guards],owners:editorOwnerSelectors,ownerScope:':where('+editorOwnerFilter+')',targets:".live-workout-page :is(.workout-exercise-contract,.workout-exercise-compact),.live-workout-page :is(.workout-exercise-contract,.workout-exercise-compact) *"})
      const result=await ablation.evaluate(value=>({rules:value.rules,families:value.families,paintFamilies:value.paintFamilies,matches:value.matches,inherited:value.inherited,legacyMatches:value.legacyMatches,classifierChecks:value.classifierChecks,selectedPositiveOwners:value.selectedPositiveOwners}))
      let after:typeof before=[]
      let restoration:ReturnType<typeof restoreLiveSkinBranches>
      try { after=await capture() }
      finally { restoration=await ablation.evaluate(restoreLiveSkinBranches);await ablation.dispose() }
      expect(restoration).toEqual({cssomRoundtrip:true,styleObjectsUnchanged:true,sheetsUnchanged:true})
      const inherited=result.inherited
      expect(after.length).toBe(before.length)
      const differences = before.flatMap((a, i) => {
        const b = after[i]!, props = Object.keys(a.style).filter(p => a.style[p] !== b.style[p])
        return props.length || JSON.stringify(a.rect) !== JSON.stringify(b.rect) ? [{ card: a.card, tag: a.tag, class: a.class, changes: Object.fromEntries(props.map(p => [p, [a.style[p], b.style[p]]])), rect: JSON.stringify(a.rect) !== JSON.stringify(b.rect) ? [a.rect, b.rect] : undefined }] : []
      })
      await writeFile(info.outputPath('ablation.json'), JSON.stringify({ sample, nodes: before.length, ...result, restoration, differences, before }, null, 2))
      expect(result.families).toEqual([...liveCardManifest.families].sort())
      expect(result.paintFamilies).toEqual([...liveCardManifest.paintFamilies].sort())
      expect(result.classifierChecks).toEqual({known:true,positiveRetained:true,unknownRetained:true,actualOwnersRetained:true})
      expect(result.selectedPositiveOwners).toEqual([])
      if(!sample.lime)expect(result.legacyMatches).toBe(true)
      if (sample.lime) {
        expect(result.matches).toEqual([])
        expect(inherited).toEqual([])
        expect(differences).toEqual([])
      }
      else {
        expect(inherited.length).toBeGreaterThan(0)
        expect(differences.length).toBeGreaterThan(0)
      }
    })
}
