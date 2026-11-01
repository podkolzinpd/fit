import { nativeSignIn, nativeRegister } from './native-local-fixture'
import { expect, test } from './native-local-fixture'
import { randomUUID } from 'node:crypto'

async function signInPreviewTrainer(page: import('@playwright/test').Page) {
  await page.goto('/auth')
  await nativeSignIn(page, 'trainer@fit.local')
  await expect(page).toHaveURL(/\/(today|clients)$/)
}

test('global rollout gives a new trainer the monochrome exercise catalog', async ({ page }) => {
  await page.goto('/auth')
  await nativeRegister(page, { key: `exercise-catalog-flag-off-${randomUUID()}@fit.local`, firstName: 'Exercise catalog flag off', role: 'trainer' })
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
  await search.fill('лестница')
  await expect(page.getByText(/Найдено: [1-9]/)).toBeVisible()

  const result = page.locator('.catalog-media-card').first()
  await expect(result.locator('.exercise-image')).toBeVisible()
  await expect(result.locator('.exercise-image-preview video')).toHaveCount(0)
  await expect(result.locator('.catalog-media-card-play')).toBeVisible()
  const exerciseName = await result.locator('strong').innerText()
  expect(exerciseName).toContain('Лестничный тренажёр')
  await result.click()
  const detail = page.getByRole('dialog')
  await expect(detail.getByRole('heading', { name: exerciseName })).toBeVisible()
  await expect(detail.locator('.exercise-image-technique')).toBeVisible()
  const techniqueVideo = detail.locator('.exercise-image-technique video')
  await expect(techniqueVideo).toBeVisible()
  await expect(techniqueVideo).toHaveAttribute('autoplay', '')
  await expect(techniqueVideo).not.toHaveAttribute('controls', '')
  await expect(techniqueVideo).toHaveAttribute('loop', '')
  await expect(techniqueVideo.evaluate((video: HTMLVideoElement) => video.muted)).resolves.toBe(true)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(techniqueVideo).toBeVisible()
  await expect(techniqueVideo).toHaveAttribute('autoplay', '')
  await expect.poll(() => techniqueVideo.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false)
  await expect(detail.getByText('Оборудование', { exact: true })).toBeVisible()
  await detail.locator('button.secondary').filter({ hasText: /^Закрыть$/ }).click()
  await expect(detail).toHaveCount(0)

  await search.fill('лежачий велотренажер')
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  const recumbentBikeResult = page.locator('.catalog-media-card').first()
  await expect(recumbentBikeResult.getByText('Горизонтальный велотренажёр')).toBeVisible()
  await expect(recumbentBikeResult).toHaveClass(/without-media/)
  await expect(recumbentBikeResult.locator('.catalog-media-card-play')).toHaveCount(0)
  await recumbentBikeResult.click()
  const recumbentBikeDetail = page.getByRole('dialog')
  await expect(recumbentBikeDetail).toBeVisible()
  await expect(recumbentBikeDetail.locator('video')).toHaveCount(0)
  await expect(recumbentBikeDetail.getByText('Расстояние', { exact: true })).toBeVisible()
  await recumbentBikeDetail.locator('button.secondary').filter({ hasText: /^Закрыть$/ }).click()
  await expect(page.getByLabel('Название')).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
