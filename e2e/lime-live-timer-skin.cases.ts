import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'

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
      const properties = ['display','position','color','background-color','font-family','font-size','font-weight','line-height','width','height','min-width','min-height','max-height','gap','grid-template-columns','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-bottom','border-top-width','border-top-color','border-top-style','border-radius','box-shadow','outline-color','outline-width','outline-style','outline-offset','overflow-x','overflow-y','scroll-snap-type','touch-action','opacity','align-items','justify-content']
      const targets = Array.from(root.querySelectorAll('.live-pinned,.coach-v79-timer,.coach-v79-dock,.live-rest-sheet,.live-timer-toolbar'))
      const nodes = [...new Set(targets.flatMap(node => [node,...node.querySelectorAll('*')]))]
      return nodes.map(node => { const css=getComputedStyle(node),r=node.getBoundingClientRect();return {tag:node.tagName,class:node.getAttribute('class')||'',style:Object.fromEntries(properties.map(p=>[p,css.getPropertyValue(p)])),rect:[r.x,r.y,r.width,r.height].map(v=>Math.round(v*100)/100)} })
    })
    const before = await capture()
    if (sample.lime && (sample.state === 'sheet' || sample.state === 'overdue')) await page.screenshot({ path: info.outputPath('timer-skin.png'), animations: 'disabled' })
    const result = await page.evaluate(() => {
      const common = new Set(['.workout-decision-sheet', '.live-rest-countdown', '.live-rest-countdown.overdue', '.live-rest-divider', '.live-rest-new-time', '.rest-time-wheel-field > span', '.rest-time-wheel', '.rest-time-wheel:focus-visible', ".rest-time-wheel [role='option']", ".rest-time-wheel [role='option'].selected", '.rest-time-separator', '.live-rest-apply', '.live-rest-trigger.resting', '.live-rest-trigger.rest-overdue', '.live-rest-trigger.phase-prep', '.live-rest-trigger.phase-work'])
      const visual = /^(?:color|background(?:-.+)?|border(?:-.+)?|box-shadow|font-(?:family|size|weight)|outline(?:-.+)?|animation)$/
      const strip = (selector: string) => {
        while (selector.includes(':where(')) {
          const start = selector.indexOf(':where(')
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
              return /^\.live-identity\b/.test(original) && /\.(?:live-timer(?:-toolbar)?|live-pinned(?:-empty)?|rest-timer|rest-step|rest-controls)(?![\w-])/.test(original)
                || common.has(original) && Array.from(rule.style).some(p => visual.test(p))
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
      probe.textContent = matches.map(selector => selector + ' { --mc41-legacy-timer-probe: legacy; }').join(' ')
      document.head.append(probe)
      const inherited = Array.from(document.querySelectorAll('.coach-v79-timer,.coach-v79-timer *,.coach-v79-dock,.coach-v79-dock *,.live-rest-sheet,.live-rest-sheet *')).filter(node => getComputedStyle(node).getPropertyValue('--mc41-legacy-timer-probe').trim() === 'legacy').length
      probe.remove()
      const restore: { selector: string; current: string; text: string }[] = []
      for (const { rule, selectors, selected } of changed) {
        if (!selected.some(selector => document.querySelector(selector))) continue
        const selector = rule.selectorText, text = rule.style.cssText
        const retained = selectors.filter(branch => !selected.includes(branch))
        // Preserve unrelated branches that the optimizer merged into this rule.
        if (retained.length) rule.selectorText = retained.join(', ')
        else rule.style.cssText = ''
        restore.push({ selector, current: rule.selectorText, text })
      }
      return { rules: changed.length, families: [...new Set(selected.map(strip))], matches, inherited, legacyMatches, restore }
    })
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const after = await capture()
    await page.evaluate(restore => {
      let index = 0
      const visit = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          const saved = restore[index]
          if (rule instanceof CSSStyleRule && saved && rule.selectorText === saved.current) {
            rule.selectorText = saved.selector
            rule.style.cssText = saved.text
            index++
          }
          if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
        }
      }
      for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules)
    }, result.restore)
    expect(after).toHaveLength(before.length)
    const differences=before.flatMap((a,i)=>{const b=after[i]!;const changes=Object.fromEntries(Object.keys(a.style).filter(p=>a.style[p]!==b.style[p]).map(p=>[p,[a.style[p],b.style[p]]]));return Object.keys(changes).length||JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[{tag:a.tag,class:a.class,changes,rect:JSON.stringify(a.rect)!==JSON.stringify(b.rect)?[a.rect,b.rect]:undefined}]:[]})
    await writeFile(info.outputPath('timer-skin.json'),JSON.stringify({sample,before,...result,differences},null,2))
    expect(result.families).toHaveLength(30)
    if(sample.lime){expect(result.matches).toEqual([]);expect(result.inherited).toBe(0);expect(differences).toEqual([])}
    else{expect(result.matches.length).toBeGreaterThan(0);expect(result.legacyMatches).toBe(true);expect(differences.length).toBeGreaterThan(0)}
  })
}
