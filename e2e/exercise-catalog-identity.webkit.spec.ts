import { expect, test } from '@playwright/test'

test('exercise catalog search and technique detail work in the iOS shell', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/exercises')
  await expect(page.locator('.phone-frame')).toHaveClass(/exercise-catalog-identity/)
  await page.getByLabel('Поиск упражнения').fill('лестница')
  const result = page.locator('.catalog-media-card').first()
  await expect(result.getByText('Лестничный тренажёр', { exact: true })).toBeVisible()
  await expect(result.locator('.exercise-image')).toBeVisible()
  await expect(result.locator('.exercise-image-preview video')).toHaveCount(0)
  await expect(result.locator('.catalog-media-card-play')).toBeVisible()
  await result.click()
  const technique = page.getByRole('dialog').locator('.exercise-image-technique')
  await expect(technique).toBeVisible()
  const video = technique.locator('video')
  await expect(video).toBeVisible()
  await expect(video.evaluate((element: HTMLVideoElement) => ({
    autoplay: element.autoplay,
    controls: element.controls,
    loop: element.loop,
    muted: element.muted,
  }))).resolves.toEqual({ autoplay: true, controls: true, loop: true, muted: true })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(video).toBeVisible()
  await expect(video).not.toHaveAttribute('autoplay', '')
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await page.getByRole('dialog').locator('button.secondary').click()

  await page.getByLabel('Поиск упражнения').fill('трэп гриф')
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  const photoResult = page.locator('.catalog-media-card').first()
  await expect(photoResult.getByText('Становая тяга с трэп-грифом')).toBeVisible()
  await photoResult.click()
  const photoTechnique = page.getByRole('dialog').locator('.exercise-image-technique')
  await expect(photoTechnique.locator('video')).toHaveCount(0)
  await expect(photoTechnique.locator('img')).toHaveCount(2)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
