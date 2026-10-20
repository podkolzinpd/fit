import { expect, test } from '@playwright/test'
import { coachGestureWorkout, mockPilot, workoutId } from './fit-lime-fixtures'

test.skip(process.env.FIT_CLIENT_WORKOUT_ACCEPTANCE !== '1', 'Dedicated native client-workout harness')

const pilotId = 'c11e0000-6010-4000-8000-000000000001'

test.beforeEach(async ({ page }) => {
  // Only app GETs may reach the local server; every API write is fixture-bound.
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === new URL(test.info().project.use.baseURL ?? `http://127.0.0.1:${process.env.FIT_TEST_PORT ?? 5173}`).origin
      && route.request().method() === 'GET' && !url.pathname.startsWith('/api/') ? route.continue() : route.abort()
  })
  await page.routeWebSocket('**', socket => socket.close())
})

test('client reference settings preserve animation independently of density and reload', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [coachGestureWorkout()] })
  await page.goto('/me/settings')
  const original = page.getByRole('radio', { name: 'Оригинальный', exact: true })
  const compact = page.getByRole('radio', { name: 'Компактный', exact: true })
  const animation = page.getByRole('switch', { name: 'Анимация в Live', exact: true })
  await expect(original).toHaveAttribute('aria-checked', 'true')
  await expect(animation).toBeChecked()
  await compact.click()
  await expect(animation).toBeChecked()
  await animation.uncheck()
  await original.click()
  await expect(animation).not.toBeChecked()
  await page.reload()
  await expect(original).toHaveAttribute('aria-checked', 'true')
  await expect(animation).not.toBeChecked()
  await compact.click()
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.client-live-density-compact')).toBeVisible()
  await expect(page.locator('.live-set-input').first()).toHaveCSS('min-height', '48px')
  await expect(page.locator('.live-header-animation, .exercise-thumbnail')).toHaveCount(0)
})

test('another client cannot enter the pilot from settings or a direct Live link', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: 'c11e0000-6010-4000-8000-000000000002', clientLime: true, workouts: [coachGestureWorkout()] })
  await page.goto('/me/settings')
  await expect(page.getByRole('radiogroup', { name: 'Вид Live-тренировки' })).toHaveCount(0)
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-workout-page')).toBeVisible()
  await expect(page.locator('.client-workout-reference, .client-live-density')).toHaveCount(0)
})

test('a trainer in the client allowlist retains trainer presentation', async ({ page }) => {
  await mockPilot(page, { profileId: pilotId, fitLime: true, workouts: [coachGestureWorkout()] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-workout-page')).toBeVisible()
  await expect(page.locator('.client-workout-reference, .client-live-density')).toHaveCount(0)
})

// Each visual axis has a distinct risk: theme contrast, narrow wrapping and row density.
for (const theme of ['dark', 'light']) for (const width of [390, 430]) for (const density of ['original', 'compact']) {
  test(`client reference geometry ${theme} ${width} ${density}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    await page.addInitScript(({ id, theme, density }) => {
      localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
      localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    }, { id: pilotId, theme, density })
    const source = coachGestureWorkout()
    source.startedAt = new Date(Date.now() - 120000).toISOString()
    await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
    await page.goto('/me/settings')
    await expect(page.getByRole('switch', { name: 'Анимация в Live', exact: true })).toBeChecked()
    const options = page.getByRole('radiogroup', { name: 'Вид Live-тренировки' })
    await expect(options.getByRole('radio', { name: density === 'original' ? 'Оригинальный' : 'Компактный', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(options.getByRole('radio', { name: density === 'original' ? 'Оригинальный' : 'Компактный', exact: true })).toHaveCSS('background-color', 'rgb(182, 239, 77)')
    await page.screenshot({ path: info.outputPath('settings.png') })
    await page.goto(`/workouts/${workoutId}/live`)
    await expect(page.locator(`.client-live-density-${density}`)).toBeVisible()
    await expect(page.locator('.live-set-input').first()).toHaveCSS('min-height', density === 'original' ? '54px' : '48px')
    await expect(page.locator('.phone-frame')).toHaveCSS('background-color', theme === 'light' ? 'rgb(246, 247, 242)' : 'rgb(0, 0, 0)')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('live.png') })
  })
}
