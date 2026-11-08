import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'
import { settleCompletionPaint } from './lime-live-completion-skin.probe'

// The old absolute button sits in a zero-height v79 wrapper. Measure actual
// clipping and pointer hits, separately from the timer/confirmation behavior.
// Theme and density affect the bounds; 375px adds long-title/media/motion risk.
// The legacy sample proves that the scoped placement change leaves fallback alone.
export function limeLiveTimerReviewLayoutCases() {
  const samples = ['light', 'dark'].flatMap(theme => ['original', 'compact'].map(density => ({ theme, density, width: theme === 'light' ? 390 : 430, animation: false, lime: true })))
  samples.push({ theme: 'dark', density: 'compact', width: 375, animation: true, lime: true })
  samples.push({ theme: 'dark', density: 'original', width: 390, animation: false, lime: false })
  for (const sample of samples) test('Live timer review button stays inside its card ' + Object.values(sample).join('-'), async ({ page }, info) => {
    const id = sample.lime ? 'c11e0000-6010-4000-8000-000000000001' : '10000000-0000-4000-8000-000000000001'
    const errors: string[] = [], failed: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('requestfailed', request => failed.push(new URL(request.url()).pathname))
    page.on('response', response => { if (response.status() >= 400) failed.push(response.status() + ' ' + new URL(response.url()).pathname) })
    await page.setViewportSize({ width: sample.width, height: sample.width === 375 ? 667 : 844 })
    await page.emulateMedia({ reducedMotion: sample.animation ? 'no-preference' : 'reduce' })
    await page.clock.setFixedTime(new Date('2026-11-06T09:00:00Z'))
    await page.addInitScript(({ id, sample, workoutId }) => {
      localStorage.setItem('fit.appTheme', sample.theme)
      localStorage.setItem('fit.clientLime.theme.' + id, sample.theme)
      localStorage.setItem('fit.clientLiveDensity.' + id, sample.density)
      localStorage.setItem('fit.liveExerciseAnimation.' + id, String(sample.animation))
      sessionStorage.setItem('fit:live-rest-until:' + workoutId, String(Date.parse('2026-11-06T09:01:30Z')))
    }, { id, sample, workoutId })
    const source = Object.assign(restTimerWorkout(), { pausedAt: undefined as string | undefined, pausedSeconds: 0 })
    source.createdBy = id
    source.startedAt = '2026-11-06T08:58:00Z'
    if (sample.lime && sample.theme === 'light' && sample.density === 'original') { source.pausedAt = '2026-11-06T08:59:50Z'; source.pausedSeconds = 20 }
    if (sample.width === 375) source.exercises[0]!.name = 'Приседания с очень длинным названием упражнения и комментариями в названии'
    for (const set of source.exercises[0]!.sets) Object.assign(set, { confirmedAt: '2026-11-06T08:59:00Z', timerConfirmed: true, fact: { weightKg: 20, reps: 10 } })
    const backend = await mockPilot(page, { role: 'client', profileId: id, clientLime: sample.lime, workouts: [source] })
    await page.route('**/v1/push-notifications/status', route => route.fulfill({ json: { status: { subscribed: false, preferences: { workout_reminder: true, workout_scheduled: true, chat_message: true } } } }))
    await page.route('**/v1/exercise-media/sign-batch', route => {
      const { paths } = route.request().postDataJSON() as { paths: string[] }
      return route.fulfill({ json: { signedUrls: paths.map(path => ({ path, signedUrl: new URL('/exercises/vital/air-bike-sprint' + (path.endsWith('.mp4') ? '.mp4' : '.jpg'), page.url()).href })) } })
    })
    await page.goto('/workouts/' + workoutId + '/live')
    if (sample.lime) {
      await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
      await expect(page.locator('.finish-confirm.timer-review')).toBeVisible()
    }
    const button = page.getByRole('button', { name: /^Подтвердить подходы:/ })
    await expect(button).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const measurements: unknown[] = []
    const inspect = async (state: string) => {
      // Revealing the button itself scrolls the overflow:hidden swipe and masks clipping.
      await button.evaluate(element => (element.closest('.workout-swipe') ?? element.parentElement)!.scrollIntoView({block:'center',behavior:'instant'}))
      await settleCompletionPaint(page, '.live-timer-pending')
      const result = await button.evaluate(element => {
        const card = element.closest('.workout-swipe') ?? element.closest('.live-timer-pending')!
        const wrapper = element.parentElement!, entry = document.querySelector('.live-add-exercise')!
        const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom } }
        const buttonRect = rect(element), cardRect = rect(card), entryRect = rect(entry)
        const hits = [.15,.5,.85].flatMap(x => [.15,.5,.85].map(y => { const at = document.elementFromPoint(buttonRect.x+buttonRect.width*x,buttonRect.y+buttonRect.height*y); return Boolean(at && element.contains(at)) }))
        const legacyPlacementMatches: string[] = []
        const visit = (rules: CSSRuleList) => { for (const rule of Array.from(rules)) { if (rule instanceof CSSStyleRule && rule.selectorText.includes('.live-timer-confirm') && rule.style.position === 'absolute' && element.matches(rule.selectorText)) legacyPlacementMatches.push(rule.selectorText); if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules) } }
        for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules)
        return { legacyPlacementMatches, cardScrollTop:card.scrollTop, foldTransition:card.querySelector('.client-live-card-body') ? getComputedStyle(card.querySelector('.client-live-card-body')!).transitionDuration : '', button:buttonRect,card:cardRect,wrapper:rect(wrapper),entry:entryRect,hits,position:getComputedStyle(element).position,transform:getComputedStyle(element).transform,overlapHeight:Math.max(0,Math.min(buttonRect.bottom,entryRect.bottom)-Math.max(buttonRect.y,entryRect.y)),activeAnimations:card.getAnimations({subtree:true}).filter(a=>a.playState==='running').length }
      })
      measurements.push({ state, result })
      await writeFile(info.outputPath('timer-review-layout.json'), JSON.stringify({ sample, measurements, errors, failed }, null, 2))
      await page.screenshot({ path: info.outputPath('timer-review-' + state + '.png'), animations: 'disabled' })
      expect(result.cardScrollTop).toBe(0)
      expect(result.button.height).toBeGreaterThanOrEqual(44)
      expect(result.button.y).toBeGreaterThanOrEqual(result.card.y)
      expect(result.button.bottom).toBeLessThanOrEqual(result.card.bottom)
      expect(result.overlapHeight).toBe(0)
      expect(result.hits).toEqual(Array(9).fill(true))
      if (sample.lime) { expect(result.position).toBe('static'); expect(result.transform).toBe('none'); expect(result.legacyPlacementMatches).toEqual([]) } else expect(result.legacyPlacementMatches.length).toBeGreaterThan(0)
      expect(result.activeAnimations).toBe(0)
      if (sample.lime) expect(result.foldTransition.split(',').some(value=>parseFloat(value)>.001)).toBe(sample.animation)
    }
    await inspect('folded')
    if (sample.lime) {
      const toggle = page.getByRole('button', { name: 'Подходы упражнения «' + source.exercises[0]!.name + '»', exact: true })
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await inspect('expanded')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await inspect('refolded')
    }
    // One real pointer confirmation per engine verifies that the newly exposed
    // hit target preserves facts and only clears the existing timer marks.
    if (sample.lime && sample.theme === 'light' && sample.density === 'original') {
      const initial = backend.getWorkouts()[0]! as typeof source
      const pausedAt = initial.pausedAt
      // API DTOs spell absent optional facts as null; compare every non-null
      // field exactly so transport normalization is not mistaken for lost data.
      const canonicalFacts = () => backend.getWorkouts()[0]!.exercises[0]!.sets.map(set => Object.fromEntries(Object.entries(set.fact).filter(([, value]) => value !== null && value !== undefined)))
      const facts = structuredClone(canonicalFacts())
      const confirmed = initial.exercises[0]!.sets.map(set => set.confirmedAt)
      const rest = await page.evaluate(id=>sessionStorage.getItem('fit:live-rest-until:'+id),workoutId)
      await button.tap()
      await expect(button).toHaveCount(0)
      expect(canonicalFacts()).toEqual(facts)
      expect(backend.getWorkouts()[0]!.exercises[0]!.sets.every(set => set.confirmedAt && !set.timerConfirmed)).toBe(true)
      expect(backend.getWorkouts()[0]!.exercises[0]!.sets.map(set=>set.confirmedAt)).toEqual(confirmed)
      expect((backend.getWorkouts()[0]! as typeof source).pausedAt).toBe(pausedAt)
      expect((backend.getWorkouts()[0]! as typeof source).pausedSeconds).toBe(20)
      expect(await page.evaluate(id=>sessionStorage.getItem('fit:live-rest-until:'+id),workoutId)).toBe(rest)
      await page.reload()
      await expect(page.locator('.live-workout-page')).toBeVisible()
      await expect(button).toHaveCount(0)
      expect(canonicalFacts()).toEqual(facts)
      expect(backend.getWorkouts()[0]!.exercises[0]!.sets.map(set=>set.confirmedAt)).toEqual(confirmed)
      expect(backend.getWorkouts()[0]!.exercises[0]!.sets.every(set=>!set.timerConfirmed)).toBe(true)
      expect((backend.getWorkouts()[0]! as typeof source).pausedAt).toBe(pausedAt)
      expect((backend.getWorkouts()[0]! as typeof source).pausedSeconds).toBe(20)
      expect(await page.evaluate(id=>sessionStorage.getItem('fit:live-rest-until:'+id),workoutId)).toBe(rest)
    }
    expect(errors).toEqual([])
    expect(failed).toEqual([])
  })
}
