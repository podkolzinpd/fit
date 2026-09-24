import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const recoveryScript = readFileSync(
  new URL('../public/asset-recovery.js', import.meta.url),
  'utf8',
)

test('не оставляет белый экран, если основной модуль приложения не загрузился', async ({ page }) => {
  // Повторяем production-контракт: запрос удалённого hashed bundle получает
  // стабильный recovery-модуль, который один раз обновляет документ без кеша.
  await page.route('**/src/main.tsx', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: recoveryScript,
  }))
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'Не удалось открыть Fit' })).toBeVisible()
  await expect(page.getByText('Ваши данные и тренировки сохранены.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Обновить приложение' })).toBeVisible()
  await expect(page).toHaveURL(/fit-recover=\d+/)
})

test('убирает стартовый экран после успешного запуска приложения', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('#fit-startup-title')).toHaveCount(0)
})
