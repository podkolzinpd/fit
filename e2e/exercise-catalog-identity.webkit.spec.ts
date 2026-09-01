import { expect, test } from '@playwright/test'

test('exercise catalog search and technique detail work in the iOS shell', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/exercises')
  await expect(page.locator('.phone-frame')).toHaveClass(/exercise-catalog-identity/)
  await page.getByLabel('Поиск упражнения').fill('Присед со штангой')
  const result = page.locator('.catalog-media-card').first()
  await expect(result.locator('.exercise-image')).toBeVisible()
  const previewVideo = result.locator('.exercise-image-preview video')
  await expect(previewVideo).toBeVisible()
  await expect.poll(() => previewVideo.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  await result.click()
  const technique = page.getByRole('dialog').locator('.exercise-image-technique')
  await expect(technique).toBeVisible()
  const video = technique.locator('video')
  await expect(video).toBeVisible()
  await expect(video.evaluate((element: HTMLVideoElement) => ({
    autoplay: element.autoplay,
    loop: element.loop,
    muted: element.muted,
  }))).resolves.toEqual({ autoplay: true, loop: true, muted: true })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(previewVideo).toHaveCount(0)
  await expect(video).toHaveCount(0)
  await expect(technique.locator('.exercise-image-frame-start')).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
