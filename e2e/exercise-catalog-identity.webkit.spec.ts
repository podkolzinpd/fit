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
  }))).resolves.toEqual({ autoplay: true, controls: false, loop: true, muted: true })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(video).toBeVisible()
  await expect(video).not.toHaveAttribute('autoplay', '')
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await page.getByRole('dialog').locator('button.secondary').click()

  await page.getByLabel('Поиск упражнения').fill('лежачий велотренажер')
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  const recumbentBikeResult = page.locator('.catalog-media-card').first()
  await expect(recumbentBikeResult.getByText('Горизонтальный велотренажёр')).toBeVisible()
  await expect(recumbentBikeResult.locator('.exercise-image')).toBeVisible()
  await expect(recumbentBikeResult.locator('.catalog-media-card-play')).toBeVisible()
  await recumbentBikeResult.click()
  await expect(page.getByRole('dialog').locator('.exercise-image-technique video')).toHaveAttribute('src', '/exercises/vital/stationary-bike.mp4')
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('narrow-grip pulldown keeps exact media separate from the wide-grip variant', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/exercises/vital-pro/vital-gym-pro-r407-1713*', async (route) => {
    if (route.request().url().endsWith('.mp4')) {
      await route.continue({ url: new URL('/exercises/vital/stationary-bike.mp4', route.request().url()).href })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'image/gif',
      body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
    })
  })
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/exercises')
  await page.getByLabel('Поиск упражнения').fill('тяга верхнего блока узким хватом')
  const narrowGrip = page.locator('.catalog-media-card').filter({ hasText: 'Тяга верхнего блока узким хватом' }).first()
  await expect(narrowGrip).toBeVisible()
  await expect(narrowGrip.locator('img')).toHaveAttribute('src', '/exercises/vital-pro/vital-gym-pro-r407-1713.jpg')
  await expect(narrowGrip.locator('video')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('narrow-grip-pulldown-search-mobile.png'), fullPage: true })
  await narrowGrip.click()

  const detail = page.getByRole('dialog')
  await expect(detail.getByRole('heading', { name: 'Тяга верхнего блока узким хватом' })).toBeVisible()
  const technique = detail.locator('.exercise-image-technique')
  await expect(technique.locator('img')).toHaveCount(1)
  await expect(technique.locator('img')).toHaveAttribute('src', '/exercises/vital-pro/vital-gym-pro-r407-1713.jpg')
  await expect(technique.locator('video')).toHaveAttribute('src', '/exercises/vital-pro/vital-gym-pro-r407-1713.mp4')
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.waitForTimeout(1_800)
  await page.screenshot({ path: testInfo.outputPath('narrow-grip-pulldown-technique-mobile.png'), fullPage: true })
})
