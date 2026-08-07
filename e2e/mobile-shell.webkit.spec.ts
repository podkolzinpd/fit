import { expect, test } from '@playwright/test'

const mobileViewports = [
  { width: 390, height: 844 },
  { width: 375, height: 812 },
  { width: 360, height: 800 },
]

async function loginAsTrainer(page: import('@playwright/test').Page) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

async function openReviewWithFixture(page: import('@playwright/test').Page) {
  // Изолированная тестовая заглушка: не меняет LLM-клиент, промпт или обработку ошибок
  // в приложении, но стабильно создаёт самый плотный экран «Проверьте тренировку».
  await page.route('**/functions/v1/parse-workout', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          sourceText: 'Жим лёжа (Штанга) 3×8 — 80 кг',
          exerciseRef: 'bench-press',
          confidence: 1,
          sets: [
            { weightKg: 80, reps: 8 },
            { weightKg: 80, reps: 8 },
            { weightKg: 80, reps: 8 },
          ],
        }],
        unmatched: [],
      }),
    })
  })
  await page.goto('/today')
  await page.getByLabel('Тренировка').fill('Жим лёжа (Штанга) 3×8 — 80 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
}

for (const viewport of mobileViewports) {
  test(`iPhone: основной сценарий не выходит за ширину ${viewport.width} px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await loginAsTrainer(page)

    for (const screen of ['/today', '/clients', '/schedule']) {
      await page.goto(screen)
      await expect(page.locator('main')).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }

    await openReviewWithFixture(page)
    await expect(page.locator('.today-exercise')).toHaveCount(1)
    await expectNoHorizontalOverflow(page)
  })
}
