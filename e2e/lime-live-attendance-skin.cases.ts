import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { probeCompletionSkin } from './lime-live-completion-skin.probe'
import { mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'

// MC4.4 ownership: actual completion consumers, neutral layout and safe CSSOM restoration.
export function limeLiveAttendanceSkinCases() {
  const samples = ['original', 'compact'].flatMap(density => ['filled', 'delete', 'accounting'].map(state => ({ role: 'trainer' as const, theme: 'dark', density, state, lime: true, width: 430 })))
  samples.push({ role: 'trainer', theme: 'dark', density: 'compact', state: 'delete', lime: true, width: 375 })
  samples.push({ role: 'trainer', theme: 'dark', density: 'original', state: 'accounting', lime: true, width: 1440 })
  samples.push({ role: 'trainer', theme: 'dark', density: 'original', state: 'filled', lime: false, width: 390 })
  for (const sample of samples) test('Live Lime attendance skin ownership ' + Object.values(sample).join('-'), async ({ page, browserName }, info) => {
    const errors: string[] = []
    const requests: string[] = []
    const responses: string[] = []
    page.on('response', response => { if (response.status() >= 400) responses.push(String(response.status()) + ' ' + new URL(response.url()).pathname) })
    const consoleErrors: string[] = []
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text() + ' ' + message.location().url) })
    page.on('pageerror', error => errors.push(error.message))
    page.on('requestfailed', request => requests.push(new URL(request.url()).pathname))
    const id = !sample.lime ? '10000000-0000-4000-8000-000000000001' : 'c0ac0000-6010-4000-8000-000000000001'
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
    source.workoutDate = '2026-11-06'
    source.exercises[0]!.sets[0]!.fact = { weightKg: 20, reps: 10 }
    source.exercises[0]!.sets[0]!.confirmedAt = '2026-11-06T08:59:00Z'
    if (sample.state === 'delete') source.exercises = []
    source.startedAt = new Date(now - 120000).toISOString()
    source.createdBy = id
    if (sample.role === 'trainer') source.trainerId = id
    const backend = await mockPilot(page, { role: sample.role, profileId: id, fitLime: sample.lime, workouts: [source] })
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
    const dialog = page.locator('.workout-attendance-sheet')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.workout-attendance-accounting strong')).toBeVisible()
    if (sample.state === 'delete') await dialog.getByRole('radio', { name: 'Удалить пустую тренировку', exact: true }).check()
    if (sample.state === 'accounting') await dialog.getByRole('button', { name: 'Изменить учёт', exact: true }).click()
    // CSSOM mutation can clear stale WebKit hover on the last clicked link.
    // Hold a deliberate neutral pointer state for both cascade captures.
    await page.mouse.move(0, 0)
    const close = dialog.getByRole('button', { name: 'Закрыть', exact: true })
    await close.focus()
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
    await expect(close).not.toBeFocused()
    expect(await dialog.evaluate(element=>Boolean(document.activeElement&&element.contains(document.activeElement)))).toBe(true)
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab')
    await expect(close).toBeFocused()
    await dialog.evaluate(async element=>{ await Promise.all(element.getAnimations({subtree:true}).filter(a=>a.playState==='running').map(a=>a.finished)) })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const result=await probeCompletionSkin(page,'.workout-attendance-sheet',['.workout-decision-sheet'],info.outputPath('attendance-skin.png'))
    await writeFile(info.outputPath('attendance-skin.json'),JSON.stringify({sample,...result,errors,requests,consoleErrors,responses},null,2))
    expect(result.families).toHaveLength(1)
    await dialog.getByRole('button', { name: sample.lime ? 'Продолжить тренировку' : 'Отмена', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(initialFacts)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const finishTrigger = page.getByRole('button', { name: 'Завершить тренировку', exact: true })
    if (sample.lime) await expect(finishTrigger).toBeFocused()
    const returnFocused = await finishTrigger.evaluate(element=>element === document.activeElement)
    await writeFile(info.outputPath('attendance-skin.json'),JSON.stringify({sample,...result,errors,requests,consoleErrors,responses,returnFocused},null,2))
    expect(errors).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(requests).toEqual([])
    expect(responses).toEqual([])
    expect(result.matches).toEqual([])
    if(sample.lime)expect(result.inherited).toBe(0)
    expect(result.differences).toEqual([])
  })
}
