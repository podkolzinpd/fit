import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { mockPilot, coachGestureWorkout, workoutId } from './fit-lime-fixtures'

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
        const properties = ['display', 'color', 'background-color', 'background-image', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'width', 'height', 'min-width', 'min-height', 'gap', 'row-gap', 'column-gap', 'box-shadow', 'border-top-width', 'border-top-style', 'border-top-color', 'border-right-width', 'border-right-color', 'border-bottom-width', 'border-bottom-color', 'border-left-width', 'border-left-color', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'opacity', 'align-items', 'justify-content', 'grid-template-columns']
        return roots.flatMap((root, index) => [root, ...root.querySelectorAll('*')].map(node => {
          const css = getComputedStyle(node), r = node.getBoundingClientRect()
          return { card: index, tag: node.tagName, class: node.getAttribute('class') || '', style: Object.fromEntries(properties.map(p => [p, css.getPropertyValue(p)])), rect: [r.x, r.y, r.width, r.height].map(v => Math.round(v * 100) / 100) }
        }))
      })
      if (!sample.animation && ((sample.role === 'client' && sample.density === 'original') || (sample.role === 'trainer' && sample.density === 'compact'))) {
        await page.screenshot({ path: info.outputPath('card-shell.png'), animations: 'disabled' })
      }
      const before = await capture()
      const saved = await page.evaluateHandle(() => {
        const changed: Array<[
          CSSStyleRule,
          string
        ]> = []
        const visit = (rules: CSSRuleList) => {
          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSStyleRule && /^\.live-identity\b/.test(rule.selectorText) && /workout-exercise-contract|live-exercise\.current|live-exercise-head|overflow-trigger|live-exercise-upcoming/.test(rule.selectorText)) {
              changed.push([rule, rule.style.cssText])
              rule.style.cssText = ''
            }
            if ('cssRules' in rule)
              visit((rule as CSSGroupingRule).cssRules)
          }
        }
        for (const sheet of Array.from(document.styleSheets))
          visit(sheet.cssRules)
        return changed
      })
      let after: typeof before = []
      let inherited: string[]
      try {
        expect(await saved.evaluate(a => a.length)).toBe(8)
      if (!sample.lime) {
        // The zero-specificity guard must retain exactly the same legacy nodes.
        expect(await saved.evaluate(list => list.every(([rule]) => {
          let original = rule.selectorText
          while (original.includes(':where(')) {
            const start = original.indexOf(':where(')
            let end = start + ':where('.length, depth = 1
            while (depth && end < original.length) {
              if (original[end] === '(') depth++
              if (original[end] === ')') depth--
              end++
            }
            original = original.slice(0, start) + original.slice(end)
          }
          const retained = Array.from(document.querySelectorAll(rule.selectorText))
          const previous = Array.from(document.querySelectorAll(original))
          return retained.length === previous.length && retained.every((node, index) => node === previous[index])
        }))).toBe(true)
      }
        inherited = await saved.evaluate(list => {
          for (const [r] of list)
            r.style.setProperty('--mc31-legacy-card-probe', 'legacy')
          try {
            return Array.from(document.querySelectorAll('.live-workout-page :is(.workout-exercise-contract,.workout-exercise-compact)'))
              .flatMap(root => [root, ...root.querySelectorAll('*')])
              .filter(node => getComputedStyle(node).getPropertyValue('--mc31-legacy-card-probe').trim() === 'legacy')
              .map(node => node.tagName + '.' + (node.getAttribute('class') || ''))
          }
          finally {
            for (const [r] of list)
              r.style.removeProperty('--mc31-legacy-card-probe')
          }
        })
        after = await capture()
      }
      finally {
        await saved.evaluate(a => { for (const [r, s] of a)
          r.style.cssText = s; })
        await saved.dispose()
      }
      expect(after.length).toBe(before.length)
      const differences = before.flatMap((a, i) => {
        const b = after[i]!, props = Object.keys(a.style).filter(p => a.style[p] !== b.style[p])
        return props.length || JSON.stringify(a.rect) !== JSON.stringify(b.rect) ? [{ card: a.card, tag: a.tag, class: a.class, changes: Object.fromEntries(props.map(p => [p, [a.style[p], b.style[p]]])), rect: JSON.stringify(a.rect) !== JSON.stringify(b.rect) ? [a.rect, b.rect] : undefined }] : []
      })
      await writeFile(info.outputPath('ablation.json'), JSON.stringify({ sample, nodes: before.length, inherited, differences, before }, null, 2))
      if (sample.lime) {
        expect(inherited).toEqual([])
        expect(differences).toEqual([])
      }
      else {
        expect(inherited.length).toBeGreaterThan(0)
        expect(differences.length).toBeGreaterThan(0)
      }
    })
}
