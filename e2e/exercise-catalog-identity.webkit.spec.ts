import { expect, test } from '@playwright/test'

test('exercise catalog search and technique detail work in the iOS shell', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/, { timeout: 20_000 })

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
  await expect(page).toHaveURL(/\/(today|clients)$/, { timeout: 20_000 })

  await page.goto('/exercises')
  await page.getByLabel('Поиск упражнения').fill('тяга верхнего блока узким хватом')
  const narrowGrip = page.locator('.catalog-media-card').filter({ hasText: 'Тяга верхнего блока узким хватом' }).first()
  await expect(narrowGrip).toBeVisible()
  await expect(narrowGrip.locator('img')).toHaveAttribute('src', '/exercises/vital-pro/vital-gym-pro-r407-1713-end.jpg')
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

for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1440, height: 1000 }]) {
  test(`public exercise cover recovers from a stalled image request in the same picker at ${viewport.width}px`, async ({ page }, testInfo) => {
    test.setTimeout(45_000)
    await page.setViewportSize(viewport)
    let coverRequests = 0
    let releaseStalledRequest: (() => void) | undefined
    const stalledRequest = new Promise<void>((resolve) => { releaseStalledRequest = resolve })
    await page.route(/\/exercises\/vital\/stationary-bike-end\.jpg(?:\?.*)?$/, async (route) => {
      coverRequests += 1
      if (coverRequests === 1) {
        await stalledRequest
        await route.abort().catch(() => undefined)
        return
      }
      await route.fulfill({ contentType: 'image/jpeg', path: 'public/exercises/vital/stationary-bike-end.jpg' })
    })

    try {
      await page.goto('/auth')
      await page.getByLabel('Email').fill('trainer@fit.local')
      await page.getByLabel('Пароль').fill('FitLocal123!')
      await page.getByRole('button', { name: 'Войти', exact: true }).click()
      await expect(page).toHaveURL(/\/(today|clients)$/, { timeout: 20_000 })
      await page.evaluate(() => window.localStorage.setItem('fit.recent-exercises', JSON.stringify(['stationary-bike'])))
      await page.goto('/workouts/new')
      await page.locator('.client-picker-trigger').click()
      await page.locator('.client-picker-item').filter({ hasText: 'Анна Смирнова' }).first().click()
      await page.getByRole('button', { name: 'Выбрать упражнения', exact: true }).click()
      const card = page.locator('.picker-item').filter({ has: page.locator('[data-exercise-ref="stationary-bike"]') })
      await expect(card).toHaveCount(1)
      const image = card.locator('.exercise-image')
      const originalImage = await image.elementHandle()
      await expect.poll(() => coverRequests).toBe(1)
      await page.screenshot({ path: testInfo.outputPath('public-cover-pending-webkit.png'), fullPage: true })
      await expect.soft(image).toHaveClass(/exercise-image-loading/)
      await expect.soft(image.getByRole('status', { name: 'Загрузка изображения упражнения' })).toBeVisible()

      // The first response never arrives. Recovery must retry the real public
      // asset without closing the picker, searching again, or starting video.
      await expect.poll(() => coverRequests, { timeout: 15_000 }).toBe(2)
      await expect.poll(() => image.locator('img').evaluate((element: HTMLImageElement) => ({
        loaded: element.complete && element.naturalWidth === 540,
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      }))).toEqual({ loaded: true, width: 60, height: 60 })
      const foregroundPixels = await image.locator('img').evaluate((element: HTMLImageElement) => {
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 32
        const drawing = canvas.getContext('2d')!
        drawing.drawImage(element, 0, 0, 32, 32)
        const pixels = drawing.getImageData(0, 0, 32, 32).data
        let foreground = 0
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels.subarray(index, index + 3).some((channel) => channel < 180)) foreground += 1
        }
        return foreground
      })
      expect(foregroundPixels).toBeGreaterThan(30)
      expect(await image.evaluate((element, original) => element === original, originalImage)).toBe(true)
      await expect(image).not.toHaveClass(/exercise-image-loading/)
      await expect(card.locator('video')).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'Выберите упражнения' })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('public-cover-recovered-webkit.png'), fullPage: true })
      expect(coverRequests).toBe(2)
    } finally {
      releaseStalledRequest?.()
    }
  })
}

test('public exercise cover finishes loading with a visible fallback after both frames fail', async ({ page }, testInfo) => {
  let frameRequests = 0
  await page.route(/\/exercises\/vital\/leg-press-machine(?:-end)?\.jpg(?:\?.*)?$/, async (route) => {
    frameRequests += 1
    await route.abort('failed')
  })
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/, { timeout: 20_000 })
  await page.goto('/exercises')
  await page.getByLabel('Поиск упражнения').fill('жим ногами в тренажере')
  const card = page.locator('.catalog-media-card').filter({ has: page.getByText('Жим ногами в тренажёре', { exact: true }) })
  await expect(card).toHaveCount(1)
  const image = card.locator('.exercise-image')
  await expect(image).toHaveClass(/exercise-image-empty/, { timeout: 15_000 })
  await expect(image).not.toHaveClass(/exercise-image-loading/)
  await expect(image.getByRole('status')).toHaveCount(0)
  await expect(image.locator('img')).toHaveCount(0)
  await expect(image.locator('svg')).toBeVisible()
  await expect(card.locator('video')).toHaveCount(0)
  expect(frameRequests).toBeLessThanOrEqual(4)
  await page.screenshot({ path: testInfo.outputPath('public-cover-terminal-fallback-webkit.png'), fullPage: true })
})
