import { expect, test } from '@playwright/test'

async function signInTrainer(page: import('@playwright/test').Page, role: 'trainer' | 'client' = 'trainer') {
  await page.goto('/auth')
  await page.getByLabel('Email').fill(role === 'trainer' ? 'trainer@fit.local' : 'client@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  const submit = page.getByRole('button', { name: 'Войти' })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = page.waitForResponse((candidate) => candidate.request().method() === 'POST' && candidate.url().includes('/auth/v1/token?grant_type=password'))
    await submit.click()
    const result = await response
    if (result.ok()) {
      const destination = role === 'trainer' ? /\/(today|clients)$/ : /\/(me|today)$/
      for (let recovery = 0; recovery < 5; recovery += 1) {
        if (destination.test(new URL(page.url()).pathname)) return
        await page.waitForTimeout(500 * (2 ** recovery))
        await page.goto(role === 'trainer' ? '/today' : '/me')
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
  test.setTimeout(60_000)
  const templateName = `Силовая · всё тело ${Date.now().toString(36)}`
  await signInTrainer(page)
  let templateListFails = true
  await page.route('**/rest/v1/workout_templates?*', async (route) => route.fulfill(templateListFails
    ? { status: 503, contentType: 'application/json', body: '{"message":"temporary"}' }
    : { status: 200, contentType: 'application/json', body: '[]' }))
  await page.goto('/workouts/new')
  await page.getByRole('button', { name: 'Завершённая' }).click()
  await expect(page.getByRole('button', { name: 'Добавить шаблон' })).toHaveCount(0)
  await page.getByRole('button', { name: 'План', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить шаблон' }).click()
  await expect(page.getByRole('dialog', { name: 'Добавить шаблон тренировки' })).toBeVisible()
  await expect(page.getByText('Не удалось загрузить данные')).toBeVisible({ timeout: 15_000 })
  templateListFails = false
  await page.getByRole('dialog', { name: 'Добавить шаблон тренировки' }).getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByText('Шаблонов пока нет')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('plan-template-empty-mobile.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('dialog', { name: 'Добавить шаблон тренировки' }).getByRole('button', { name: 'Закрыть' }).click()
  await page.unroute('**/rest/v1/workout_templates?*')
  await page.goto('/schedule/templates')
  await expect(page.getByRole('heading', { name: 'Шаблоны тренировок' })).toBeVisible()

  await page.getByRole('button', { name: 'Создать шаблон' }).click()
  await page.screenshot({ path: testInfo.outputPath('template-create-menu-mobile.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('menuitem', { name: 'Создать с нуля' }).click()
  await page.getByLabel('Название шаблона').fill(templateName)
  await page.getByLabel('Запись тренировки').fill('планка 3×45 секунд')
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()
  await page.getByRole('button', { name: /Добавить в план/ }).click()
  await expect(page.getByText('1 упражнение · 3 подхода').first()).toBeVisible()
  await resetScreenshotViewport(page)
  await page.screenshot({ path: testInfo.outputPath('template-editor-details-mobile.png'), fullPage: true, animations: 'disabled' })
  await resetScreenshotViewport(page)
  await page.screenshot({ path: testInfo.outputPath('template-editor-mobile.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Сохранить шаблон' }).click()

  await expect(page).toHaveURL('/schedule/templates')
  await expect(page.getByRole('heading', { name: templateName })).toBeVisible()
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

  await page.locator('.template-card').filter({ hasText: templateName }).getByRole('link', { name: 'Назначить' }).click()
  await expect(page).toHaveURL(/\/workouts\/new\?.*template=/)
  await expect(page.getByText(templateName)).toBeVisible()
  await expect(page.getByText('1 упражнение').first()).toBeVisible()
  await page.locator('.client-picker-trigger').click()
  await page.locator('.client-picker-item').filter({ hasText: 'Анна Смирнова' }).first().click()
  await page.getByLabel('Дата').fill('2026-10-05')
  await resetScreenshotViewport(page)
  await page.screenshot({ path: testInfo.outputPath('template-assign-mobile.png'), fullPage: true, animations: 'disabled' })
  await expect(page.getByRole('button', { name: 'Клиент: Анна Смирнова' })).toBeVisible()
  await page.getByRole('button', { name: 'Сохранить план' }).click()

  await expect(page.getByText('ТРЕНИРОВКА КЛИЕНТА')).toBeVisible()
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'Сохранить как шаблон' }).click()
  await expect(page).toHaveURL(/\/schedule\/templates\/new\/editor\?sourceWorkout=/)
  await expect(page.getByRole('heading', { name: 'Новый шаблон', level: 2 })).toBeVisible()
  await expect(page.getByLabel('Название шаблона')).toHaveValue('Новый шаблон')
  await expect(page.getByText('1 упражнение · 3 подхода').first()).toBeVisible()
  await expect(page.getByText('Анна Смирнова')).toHaveCount(0)

  await page.goto('/workouts/new')
  await page.locator('.client-picker-trigger').click()
  await page.locator('.client-picker-item').filter({ hasText: 'Анна Смирнова' }).first().click()
  await page.getByLabel('Дата').fill('2026-10-07')
  await page.getByLabel('Начало').fill('14:00')
  await page.getByText('Заметка для спортсмена').click()
  await page.getByLabel('Заметка').fill('Сохранить эту заметку')
  await page.getByRole('button', { name: 'Добавить шаблон' }).click()
  const templatePicker = page.getByRole('dialog', { name: 'Добавить шаблон тренировки' })
  await expect(templatePicker.locator('.workout-template-picker-item').filter({ hasText: templateName })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('plan-template-picker-mobile.png'), fullPage: true, animations: 'disabled' })
  await templatePicker.locator('.workout-template-picker-item').filter({ hasText: templateName }).click()
  await expect(page.getByText(`Добавлен шаблон «${templateName}»`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Клиент: Анна Смирнова' })).toBeVisible()
  await expect(page.getByLabel('Дата')).toHaveValue('2026-10-07')
  await expect(page.getByLabel('Начало')).toHaveValue('14:00')
  await expect(page.getByLabel('Заметка')).toHaveValue('Сохранить эту заметку')
  await expect(page.getByText('1 упражнение').first()).toBeVisible()
  await resetScreenshotViewport(page)
  await page.screenshot({ path: testInfo.outputPath('plan-template-applied-mobile.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/)
  await expect(page.getByText('ТРЕНИРОВКА КЛИЕНТА')).toBeVisible()
  await expect(page.getByText('Сохранить эту заметку')).toBeVisible()
  const savedWorkoutId = new URL(page.url()).pathname.split('/').at(-1)
  await page.goto(`/workouts/${savedWorkoutId}/edit`)
  await page.getByRole('button', { name: 'Добавить шаблон' }).click()
  await page.getByRole('dialog', { name: 'Добавить шаблон тренировки' }).locator('.workout-template-picker-item').filter({ hasText: templateName }).click()
  await expect(page.getByText('2 упражнения').first()).toBeVisible()
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/${savedWorkoutId}$`))
})

test('client workout form has no trainer template action', async ({ page }) => {
  await signInTrainer(page, 'client')
  await page.goto('/workouts/new')
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Добавить шаблон' })).toHaveCount(0)
})

test('template list stays readable in the trainer desktop shell', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signInTrainer(page)
  await page.goto('/schedule/templates')
  await expect(page.getByRole('heading', { name: 'Шаблоны тренировок' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('template-list-desktop.png'), fullPage: true, animations: 'disabled' })
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
