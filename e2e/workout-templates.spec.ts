import { expect, test } from '@playwright/test'

async function signInTrainer(page: import('@playwright/test').Page) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  const submit = page.getByRole('button', { name: 'Войти' })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = page.waitForResponse((candidate) => candidate.request().method() === 'POST' && candidate.url().includes('/auth/v1/token?grant_type=password'))
    await submit.click()
    const result = await response
    if (result.ok()) {
      const destination = /\/(today|clients)$/
      for (let recovery = 0; recovery < 5; recovery += 1) {
        if (destination.test(new URL(page.url()).pathname)) return
        await page.waitForTimeout(500 * (2 ** recovery))
        await page.goto('/today')
      }
      await expect(page).toHaveURL(destination, { timeout: 15_000 })
      return
    }
    if (![502, 503, 504].includes(result.status()) || attempt === 4) {
      throw new Error(`Sign-in returned HTTP ${result.status()}`)
    }
    await expect(submit).toBeEnabled()
    await page.waitForTimeout(500 * (2 ** attempt))
  }
}

async function resetScreenshotViewport(page: import('@playwright/test').Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.waitForTimeout(250)
  await page.locator('.content').evaluate((element) => element.scrollTo(0, 0))
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(100)
  await expect.poll(() => page.locator('.content').evaluate((element) => element.scrollTop)).toBe(0)
}

test('trainer creates, sees and assigns a reusable workout template', async ({ page }, testInfo) => {
  await signInTrainer(page)
  await page.goto('/schedule/templates')
  await expect(page.getByRole('heading', { name: 'Шаблоны тренировок' })).toBeVisible()
  await expect(page.getByText('Создайте первый шаблон')).toBeVisible()

  await page.getByRole('link', { name: 'Создать', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('template-create-mobile.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('link', { name: 'Создать с нуля' }).click()
  await page.getByLabel('Название').fill('Силовая · всё тело')
  await page.getByLabel('Запись тренировки').fill('планка 3×45 секунд')
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()
  await page.getByRole('button', { name: /Добавить в план/ }).click()
  await expect(page.getByText('1 упражнение · 3 подхода')).toBeVisible()
  await resetScreenshotViewport(page)
  await page.screenshot({ path: testInfo.outputPath('template-editor-details-mobile.png'), fullPage: true, animations: 'disabled' })
  await resetScreenshotViewport(page)
  await page.screenshot({ path: testInfo.outputPath('template-editor-mobile.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Сохранить шаблон' }).click()

  await expect(page).toHaveURL('/schedule/templates')
  await expect(page.getByRole('heading', { name: 'Силовая · всё тело' })).toBeVisible()
  await expect.poll(() => page.locator('.content').evaluate((element) => element.scrollTop)).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('template-list-mobile.png'), fullPage: true, animations: 'disabled' })

  await page.evaluate(() => {
    window.localStorage.setItem('fit.appTheme', 'dark')
    window.dispatchEvent(new Event('fit-theme-change'))
  })
  await expect(page.locator('html')).not.toHaveClass(/theme-light/)
  await page.screenshot({ path: testInfo.outputPath('template-list-mobile-dark.png'), fullPage: true, animations: 'disabled' })
  await page.evaluate(() => {
    window.localStorage.setItem('fit.appTheme', 'light')
    window.dispatchEvent(new Event('fit-theme-change'))
  })
  await expect(page.locator('html')).toHaveClass(/theme-light/)

  await page.getByRole('link', { name: 'Назначить' }).click()
  await page.getByLabel('Клиент').selectOption({ label: 'Анна Смирнова' })
  await page.getByLabel('Дата').fill('2026-10-05')
  await resetScreenshotViewport(page)
  await page.screenshot({ path: testInfo.outputPath('template-assign-mobile.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Продолжить к тренировке' }).click()

  await expect(page).toHaveURL(/\/workouts\/new\?.*template=/)
  await expect(page.getByText(/Силовая · всё тело/)).toBeVisible()
  await expect(page.getByText('Анна Смирнова')).toBeVisible()
  await expect(page.getByText('1 упражнение')).toBeVisible()
  await page.getByRole('button', { name: 'Сохранить план' }).click()

  await expect(page.getByText('ТРЕНИРОВКА КЛИЕНТА')).toBeVisible()
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'Сохранить как шаблон' }).click()
  await expect(page).toHaveURL(/\/schedule\/templates\/new\/editor\?sourceWorkout=/)
  await expect(page.getByRole('heading', { name: 'Новый шаблон' })).toBeVisible()
  await expect(page.getByLabel('Название')).toHaveValue('Новый шаблон')
  await expect(page.getByText('1 упражнение · 3 подхода')).toBeVisible()
  await expect(page.getByText('Анна Смирнова')).toHaveCount(0)
})

test('template list stays readable in the trainer desktop shell', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signInTrainer(page)
  await page.goto('/schedule/templates')
  await expect(page.getByRole('heading', { name: 'Шаблоны тренировок' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('template-list-desktop.png'), fullPage: true, animations: 'disabled' })
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
