import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

async function signInPreviewTrainer(page: import('@playwright/test').Page) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
}

test('global rollout gives a new trainer the monochrome exercise catalog', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('trainer')
  await page.getByLabel('Имя').fill('Exercise catalog flag off')
  await page.getByLabel('Email').fill(`exercise-catalog-flag-off-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/exercises')
  await expect(page.locator('.phone-frame')).toHaveClass(/exercise-catalog-identity/)
  await expect(page.locator('html')).toHaveClass(/ui-identity/)
  await expect(page.getByRole('heading', { name: 'Системные упражнения' })).toBeVisible()
  await expect(page.getByLabel('Поиск упражнения')).toBeVisible()
})

test('exercise catalog preview keeps search, media and detail transitions usable', async ({ page }) => {
  await signInPreviewTrainer(page)
  await page.goto('/exercises')

  await expect(page.locator('.phone-frame')).toHaveClass(/exercise-catalog-identity/)
  await expect(page.getByRole('heading', { name: 'Системные упражнения' })).toBeVisible()
  const search = page.getByLabel('Поиск упражнения')
  await search.fill('заведомо отсутствующее движение')
  await expect(page.getByText('Ничего не найдено')).toBeVisible()
  await page.getByRole('button', { name: 'Сбросить поиск' }).click()
  await search.fill('Присед со штангой')
  await expect(page.getByText(/Найдено: [1-9]/)).toBeVisible()

  const result = page.locator('.catalog-media-card').first()
  await expect(result.locator('.exercise-image')).toBeVisible()
  const exerciseName = await result.locator('strong').innerText()
  await result.click()
  const detail = page.getByRole('dialog')
  await expect(detail.getByRole('heading', { name: exerciseName })).toBeVisible()
  await expect(detail.locator('.exercise-image-technique')).toBeVisible()
  const techniqueVideo = detail.locator('.exercise-image-technique video')
  await expect(techniqueVideo).toBeVisible()
  await expect(techniqueVideo).toHaveAttribute('autoplay', '')
  await expect(techniqueVideo).toHaveAttribute('loop', '')
  await expect(techniqueVideo.evaluate((video: HTMLVideoElement) => video.muted)).resolves.toBe(true)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(techniqueVideo).toHaveCount(0)
  await expect(detail.locator('.exercise-image-frame-start')).toBeVisible()
  await expect(detail.getByText('Оборудование', { exact: true })).toBeVisible()
  await detail.locator('button.secondary').click()
  await expect(detail).toHaveCount(0)
  await expect(page.getByLabel('Название')).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
