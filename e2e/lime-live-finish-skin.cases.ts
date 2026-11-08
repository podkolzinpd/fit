import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { probeCompletionSkin } from './lime-live-completion-skin.probe'
import { mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'

// MC4.4 ownership: actual completion consumers, neutral layout and safe CSSOM restoration.
export function limeLiveFinishSkinCases() {
  const samples = ['light', 'dark'].flatMap(theme => ['original', 'compact'].flatMap(density =>
    ['partial', 'cardio', 'timer-review'].map(state => ({ role: 'client' as const, theme, density, state, lime: true, width: theme === 'light' ? 390 : 430 }))))
  samples.push({ role: 'client', theme: 'dark', density: 'compact', state: 'cardio', lime: true, width: 375 })
  samples.push({ role: 'client', theme: 'dark', density: 'original', state: 'partial', lime: false, width: 390 })
  for (const sample of samples) test('Live Lime finish skin ownership ' + Object.values(sample).join('-'), async ({ page, browserName }, info) => {
    const errors: string[] = []
    const requests: string[] = []
    const responses: string[] = []
    page.on('response', response => { if (response.status() >= 400) responses.push(String(response.status()) + ' ' + new URL(response.url()).pathname) })
    const consoleErrors: string[] = []
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text() + ' ' + message.location().url) })
    page.on('pageerror', error => errors.push(error.message))
    page.on('requestfailed', request => requests.push(new URL(request.url()).pathname))
    const id = !sample.lime ? '10000000-0000-4000-8000-000000000001' : 'c11e0000-6010-4000-8000-000000000001'
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
    if (sample.state === 'cardio') {
      Object.assign(source.exercises[0]!, { ref: 'running', name: 'Бег', muscleGroup: 'cardio', inputKind: 'distance' })
      source.exercises[0]!.sets[0]!.fact = { distanceKm: 1 }
      source.exercises[0]!.sets[0]!.confirmedAt = '2026-11-06T08:59:00Z'
    } else if (sample.state === 'timer-review') {
      for (const set of source.exercises[0]!.sets) Object.assign(set, { fact: { weightKg: 20, reps: 10 }, confirmedAt: '2026-11-06T08:59:00Z', timerConfirmed: true })
    }
    source.startedAt = new Date(now - 120000).toISOString()
    source.createdBy = id
    const backend = await mockPilot(page, { role: sample.role, profileId: id, clientLime: sample.lime && sample.role === 'client', workouts: [source] })
    // These unrelated background APIs are absent from mockPilot's default fixture.
    // Give them real schema-shaped local responses so console assertions stay strict.
    await page.route('**/v1/push-notifications/status', route => route.fulfill({ json: { status: { subscribed: false, preferences: { workout_reminder: true, workout_scheduled: true, chat_message: true } } } }))
    await page.route('**/v1/exercise-media/sign-batch', route => {
      const { paths } = route.request().postDataJSON() as { paths: string[] }
      return route.fulfill({ json: { signedUrls: paths.map(path => ({ path, signedUrl: new URL('/exercises/vital/air-bike-sprint.jpg', page.url()).href })) } })
    })
    await page.goto('/workouts/' + workoutId + '/live')
    await expect(page.locator('.live-workout-page')).toBeVisible()
    if (sample.lime) {
      await expect(page.locator('.live-workout-page')).toHaveClass(/(?:coach|client)-live-v79/)
      await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    } else await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-lime-shell/)
    const initialFacts = JSON.stringify(backend.getWorkouts()[0]!.exercises)
    await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
    const confirmation = page.locator('.finish-confirm')
    await expect(confirmation).toBeVisible()
    if (sample.state === 'timer-review') await expect(confirmation).toHaveClass(/timer-review/)
    else await expect(confirmation).not.toHaveClass(/timer-review/)
    if (sample.state === 'cardio') await expect(confirmation).toContainText('нет фактического времени')
    if (sample.state === 'partial' && sample.lime) await expect(confirmation).toContainText('Не подтверждено подходов: 2')
    // Inline finish has no autofocus contract; calibrate only its keyboard paint.
    const action = confirmation.getByRole('button').last()
    await action.focus()
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab')
    await expect(confirmation.getByRole('button').nth((await confirmation.getByRole('button').count())-2)).toBeFocused()
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
    await expect(action).toBeFocused()
    await expect(action).toHaveCSS('outline-width', '2px')
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const result=await probeCompletionSkin(page,'.finish-confirm',['.finish-confirm p','.live-identity .finish-confirm p',".live-identity .finish-confirm .workout-cta[data-variant='tertiary']",".live-identity .finish-confirm .workout-cta[data-variant='primary']"],sample.lime?info.outputPath('finish-skin.png'):undefined)
    await writeFile(info.outputPath('finish-skin.json'),JSON.stringify({sample,...result,errors,requests,consoleErrors,responses},null,2))
    expect(result.families).toHaveLength(4)
    await confirmation.getByRole('button', { name: sample.state === 'cardio' ? 'Внести время' : sample.state === 'timer-review' ? 'Проверить' : 'Отмена', exact: true }).click()
    await expect(confirmation).toHaveCount(0)
    expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(initialFacts)
    expect(errors).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(requests).toEqual([])
    expect(responses).toEqual([])
    if(sample.lime){expect(result.matches).toEqual([]);expect(result.inherited).toBe(0);expect(result.differences).toEqual([])}
    else{expect(result.matches.length).toBeGreaterThan(0);expect(result.legacyMatches).toBe(true);expect(result.differences.length).toBeGreaterThan(0)}
  })
}
