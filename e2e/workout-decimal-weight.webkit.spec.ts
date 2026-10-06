import { expect, test } from '@playwright/test'

test('saved and newly entered fractional weights do not block workout editing', async ({ page }, testInfo) => {
  await page.goto('/auth')
  await page.addStyleTag({ content: '#fit-startup-shell, #fit-startup-emergency { display: none !important; }' })
  await page.evaluate(async () => {
    const modulePath = '/e2e/workout-decimal-weight-harness.tsx'
    const harness = await import(modulePath) as typeof import('./workout-decimal-weight-harness')
    harness.mountWorkoutDecimalWeightHarness()
  })

  const weight = page.getByRole('spinbutton', { name: 'Вес, подход 1' })
  await expect(weight).toHaveValue('3.4')
  expect(await weight.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true)
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.getByRole('status', { name: 'Сохранённый вес' })).toHaveText('3.4')

  await weight.fill('4.3')
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.getByRole('status', { name: 'Сохранённый вес' })).toHaveText('4.3')

  for (const width of [390, 430, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`decimal-weight-${width}.png`) })
  }
})

test('walking lunges accept kilograms in the plan and Live on iPhone', async ({ page }, testInfo) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/today$/)

  const clientName = `Выпады ${Date.now().toString().slice(-6)}`
  await page.goto('/clients/new')
  await page.getByLabel('Имя').fill(clientName)
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: clientName })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать тренировку/ }).click()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByLabel('Поиск упражнения').fill('Выпады в ходьбе')
  await page.getByRole('button', { name: 'Выбрать: Выпады в ходьбе', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await expect(page.locator('.planned-set-table-head')).toContainText('Кг')
  await expect(page.locator('.planned-set-table-head')).not.toContainText('Время')
  await page.getByLabel('Вес, подход 1').fill('12.5')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByRole('button', { name: 'Начать' }).click()
  const hint = page.locator('.coachmark-bubble').getByRole('button', { name: 'Понятно' })
  if (await hint.isVisible()) await hint.click()

  await expect(page.locator('.live-set-table-head')).toContainText('Кг')
  await expect(page.locator('.live-set-table-head')).not.toContainText('Время')
  await expect(page.getByLabel('Фактический вес').first()).toHaveValue('12.5')
  await page.getByLabel('Фактический вес').first().fill('13.5')
  if (await hint.isVisible()) await hint.click()
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`walking-lunge-live-${width}.png`) })
  }
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByRole('button', { name: /Выпады в ходьбе 1 подход · 13\.5 кг × 10 повт\./ })).toBeVisible()
})
