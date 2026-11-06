import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { mockPilot, coachGestureWorkout, workoutId } from './fit-lime-fixtures'

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
    if (strength) await root.locator('input[name="weightKg"]').first().focus()
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    if (sample.kind === 'strength' && sample.lime && sample.width !== 375) await page.screenshot({ path: info.outputPath('set-skin.png'), animations: 'disabled' })
    const before = await root.evaluate(element => {
      const props = ['display', 'position', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'width', 'height', 'min-width', 'min-height', 'gap', 'row-gap', 'column-gap', 'box-shadow', 'outline-width', 'outline-style', 'outline-color', 'border-top-width', 'border-top-style', 'border-top-color', 'border-left-width', 'border-left-color', 'border-radius', 'margin-top', 'margin-bottom', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'overflow-x', 'overflow-y', 'text-overflow', 'white-space', 'cursor', 'align-items', 'justify-content', 'grid-template-columns']
      return Array.from(element.querySelectorAll('.live-set-table, .workout-set-table-head, form[data-live-set-id], form[data-live-set-id] *')).map(node => {
        const css = getComputedStyle(node), r = node.getBoundingClientRect()
        return { tag: node.tagName, class: node.getAttribute('class') || '', style: Object.fromEntries(props.map(p => [p, css.getPropertyValue(p)])), rect: [r.x, r.y, r.width, r.height].map(v => Math.round(v * 100) / 100) }
      })
    })
    const result = await page.evaluate(() => {
      const changed: [CSSStyleRule, string][] = []
      const visit = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule && /^\.live-identity\b/.test(rule.selectorText) && /\.(?:workout-set-table(?:-head)?|live-set-(?:table|grid|number|input|rpe|confirm|check|save|save-feedback|validation))(?![\w-])/.test(rule.selectorText)) {
            changed.push([rule, rule.style.cssText])
          }
          if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
        }
      }
      for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules)
      const legacyMatches = changed.every(([rule]) => {
        let original = rule.selectorText
        while (original.includes(':where(')) {
          const start = original.indexOf(':where(')
          let end = start + 7, depth = 1
          while (depth && end < original.length) { if (original[end] === '(') depth++; if (original[end] === ')') depth--; end++ }
          original = original.slice(0, start) + original.slice(end)
        }
        const retained = Array.from(document.querySelectorAll(rule.selectorText))
        const previous = Array.from(document.querySelectorAll(original))
        return retained.length === previous.length && retained.every((node, index) => node === previous[index])
      })
      const applied = changed.filter(([rule]) => document.querySelector(rule.selectorText))
      for (const [rule] of applied) rule.style.setProperty('--mc32-legacy-set-probe', 'legacy')
      const inherited = Array.from(document.querySelectorAll('.live-workout-page form[data-live-set-id], .live-workout-page form[data-live-set-id] *'))
        .filter(node => getComputedStyle(node).getPropertyValue('--mc32-legacy-set-probe').trim() === 'legacy').length
      // Do not rewrite unrelated CSSOM entries: it can itself invalidate native
      // focus painting. Only rules with actual consumers need ablation/restoring.
      for (const [rule] of applied) rule.style.cssText = ''
      return { rules: changed.length, inherited, legacyMatches, matches: applied.map(([r]) => r.selectorText), restore: applied.map(([r, s]) => ({ selector: r.selectorText, text: s })) }
    })
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    const after = await root.evaluate((element, properties) => Array.from(element.querySelectorAll('.live-set-table, .workout-set-table-head, form[data-live-set-id], form[data-live-set-id] *')).map(node => {
      const css = getComputedStyle(node), r = node.getBoundingClientRect()
      return { style: Object.fromEntries(properties.map(p => [p, css.getPropertyValue(p)])), rect: [r.x, r.y, r.width, r.height].map(v => Math.round(v * 100) / 100) }
    }), Object.keys(before[0]!.style))
    expect(after).toHaveLength(before.length)
    const differences = before.flatMap((a, i) => {
      const b = after[i]!, props = Object.keys(a.style).filter(p => a.style[p] !== b.style[p])
      return props.length || JSON.stringify(a.rect) !== JSON.stringify(b.rect) ? [{ tag: a.tag, class: a.class, changes: Object.fromEntries(props.map(p => [p, [a.style[p], b.style[p]]])), rect: JSON.stringify(a.rect) !== JSON.stringify(b.rect) ? [a.rect, b.rect] : undefined }] : []
    })
    await page.evaluate(restore => {
      let index = 0
      const visit = (rules: CSSRuleList) => { for (const rule of Array.from(rules)) { if (rule instanceof CSSStyleRule && rule.selectorText === restore[index]?.selector) { rule.style.cssText = restore[index]!.text; index++ } if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules) } }
      for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules)
    }, result.restore)
    await writeFile(info.outputPath('set-skin.json'), JSON.stringify({ sample, before, ...result, differences }, null, 2))
    expect(result.rules).toBe(32)
    if (sample.lime) { expect(result.matches).toEqual([]); expect(result.inherited).toBe(0); expect(differences).toEqual([]) }
    else { expect(result.inherited).toBeGreaterThan(0); expect(result.legacyMatches).toBe(true); expect(differences.length).toBeGreaterThan(0) }
  })
}
