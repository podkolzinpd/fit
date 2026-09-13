import { expect, test } from '@playwright/test'

test('iPhone catalog keeps search and filter sheet usable', async ({ page }) => {
  const published = {
    displayName: 'Александра Константинопольская-Романова',
    bio: 'Помогаю встроить тренировки в обычную жизнь.',
    specialties: ['Силовые тренировки', 'Мобильность'], city: 'Санкт-Петербург',
    trainingModes: ['online'], experienceStartYear: 2018, education: '', formats: '', price: '',
    acceptingClients: true, avatarDataUrl: null, certificates: [],
  }
  await page.route('**/rest/v1/rpc/list_public_trainer_profiles_page', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ items: [{
      publicId: '92000000-0000-4000-8000-000000000001', draft: published, published,
      listedInCatalog: true, publishedAt: '2026-09-12T10:00:00Z', updatedAt: '2026-09-12T10:00:00Z', version: 1,
    }], totalCount: 1, nextOffset: null }),
  }))

  await page.goto('/auth')
  await page.getByLabel('Email').fill('client@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await page.evaluate(() => sessionStorage.removeItem('fit.trainer-catalog.view.v1'))
  await page.goto('/me/trainers')

  await expect(page.getByRole('heading', { name: published.displayName })).toBeVisible()
  await page.getByLabel('Имя тренера').fill('Александра')
  await page.getByRole('button', { name: 'Очистить имя тренера' }).click()
  await expect(page.getByLabel('Имя тренера')).toHaveValue('')
  await page.getByRole('button', { name: 'Фильтры' }).click()
  const sheet = page.getByRole('dialog', { name: 'Фильтры тренеров' })
  await expect(sheet).toBeVisible()
  await sheet.getByLabel('Город').fill('Казань')
  await sheet.getByRole('button', { name: 'Показать тренеров' }).click()
  await expect(page.getByRole('button', { name: 'Фильтры · 1' })).toBeVisible()

  const geometry = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    actions: Array.from(document.querySelectorAll<HTMLElement>('.trainer-catalog-search-actions button')).map((button) => button.getBoundingClientRect().height),
  }))
  expect(geometry.overflow).toBeLessThanOrEqual(0)
  expect(geometry.actions.every((height) => height >= 44)).toBe(true)
})
