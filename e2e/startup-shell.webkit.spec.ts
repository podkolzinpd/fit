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

test('не оставляет белый экран, если модуль запустился, а интерфейс не отрисовался', async ({ page }) => {
  await page.route('**/src/main.tsx', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: [
      "document.getElementById('root').replaceChildren()",
      'window.__fitMarkAppStarted?.()',
    ].join(';'),
  }))
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('#root')).toBeEmpty()
  await expect(page.getByRole('heading', { name: 'Открываем Fit…' })).toBeVisible()
})

test('показывает восстановление, если таблица стилей зависла до запуска приложения', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Window & { __fitStartupTimeoutMs?: number }).__fitStartupTimeoutMs = 100
  })
  await page.route('**/src/styles.css*', () => undefined)

  await page.goto('/', { waitUntil: 'commit' })

  await expect(page.getByRole('heading', { name: 'Не удалось открыть Fit' })).toBeVisible()
  await expect(page.getByText('Ваши данные и тренировки сохранены.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Обновить приложение' })).toBeVisible()
})
