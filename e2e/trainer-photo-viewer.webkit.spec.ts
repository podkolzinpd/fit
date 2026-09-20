import { expect, test } from '@playwright/test'

const publicId = '91000000-0000-4000-8000-000000000001'
const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test('athlete opens and closes a trainer photo inside the iPhone viewport', async ({ page }) => {
  const profile = {
    publicId,
    draft: { displayName: 'Анна Иванова', bio: '', specialties: [], city: '', metroStationIds: [], customLocations: [], trainingModes: [], experienceStartYear: null,
      education: '', formats: '', price: '', acceptingClients: true, avatarDataUrl: avatar, certificates: [] },
    published: { displayName: 'Анна Иванова', bio: '', specialties: [], city: '', metroStationIds: [], customLocations: [], trainingModes: [], experienceStartYear: null,
      education: '', formats: '', price: '', acceptingClients: true, avatarDataUrl: avatar, certificates: [] },
    listedInCatalog: true, publishedAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-20T10:00:00.000Z', version: 1, isBrandTrainer: false,
  }
  await page.route('**/rest/v1/rpc/get_public_trainer_profile', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(profile) }))
  await page.goto(`/trainers/${publicId}`)

  await page.getByRole('button', { name: 'Открыть фото тренера Анна Иванова' }).click()
  const viewer = page.getByRole('dialog', { name: 'Фото тренера' })
  await expect(viewer).toBeVisible()
  const geometry = await viewer.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return { top: box.top, left: box.left, right: box.right, bottom: box.bottom, width: window.innerWidth, height: window.innerHeight }
  })
  expect(geometry.top).toBe(0)
  expect(geometry.left).toBe(0)
  expect(geometry.right).toBe(geometry.width)
  expect(geometry.bottom).toBe(geometry.height)

  await page.goBack()
  await expect(viewer).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/trainers/${publicId}$`))

  await page.getByRole('button', { name: 'Открыть фото тренера Анна Иванова' }).click()
  const stage = viewer.locator('.fullscreen-image-stage')
  await stage.evaluate((element) => {
    const start = new Event('touchstart', { bubbles: true })
    Object.defineProperty(start, 'touches', { value: [{ clientX: 12, clientY: 120 }] })
    element.dispatchEvent(start)
    const end = new Event('touchend', { bubbles: true })
    Object.defineProperty(end, 'changedTouches', { value: [{ clientX: 120, clientY: 124 }] })
    element.dispatchEvent(end)
  })
  await expect(viewer).toHaveCount(0)
})
